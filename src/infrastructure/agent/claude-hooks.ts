import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASK_TIMEOUT_MS,
  hookSettings,
  parseAgentEvent,
  permissionDecisionOutput,
  shellQuote,
  type AgentEvent,
  type PermissionAnswer,
} from '../../domain/terminal/agent.js';
import type { HookConfig } from '../../application/terminal/terminal-service.js';

/** Uma linha de evento e pequena; mais que isto e lixo (ou abuso) e a conexao cai. */
const MAX_LINE = 16 * 1024;
const CONNECTION_TIMEOUT_MS = 5000;

/**
 * Script que o Claude Code roda em cada hook: le o JSON do stdin, fica so com
 * o que o app usa e manda uma linha para o socket do MultiTerm. Sai com 0 e
 * sem stdout: um hook nunca pode atrapalhar o agente.
 *
 * A excecao e o PermissionRequest: ai o script espera uma linha de volta
 * (`allow`, `deny` ou `release`) e, para as duas primeiras, imprime a decisao.
 * Sem resposta (app fechado, expirou, `release`), sai sem nada e o dialogo do
 * proprio Claude, que ja esta no terminal, continua valendo.
 *
 * Roda com o proprio binario do app em modo Node (ELECTRON_RUN_AS_NODE), sem
 * depender de um `node` instalado. Gravado em disco a cada abertura (fora do
 * asar, que o modo Node nao precisa saber ler).
 */
const HOOK_SCRIPT = `'use strict';
const net = require('node:net');
const socket = process.env.MULTITERM_HOOK_SOCKET;
const token = process.env.MULTITERM_HOOK_TOKEN;
if (!socket || !token) process.exit(0);
const OUTPUT = ${JSON.stringify({ allow: permissionDecisionOutput('allow'), deny: permissionDecisionOutput('deny') })};
let timer = setTimeout(() => process.exit(0), 5000);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { if (input.length < 1e6) input += chunk; });
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(input); } catch { process.exit(0); }
  const ask = data.hook_event_name === 'PermissionRequest';
  clearTimeout(timer);
  timer = setTimeout(() => process.exit(0), ask ? ${ASK_TIMEOUT_MS + 10_000} : 3000);
  let toolInput = data.tool_input;
  try { if (JSON.stringify(toolInput).length > 8000) toolInput = undefined; } catch { toolInput = undefined; }
  const line = JSON.stringify({
    token,
    event: data.hook_event_name,
    sessionId: data.session_id,
    notificationType: data.notification_type,
    reason: data.reason,
    message: typeof data.message === 'string' ? data.message.slice(0, 500) : undefined,
    toolName: ask && typeof data.tool_name === 'string' ? data.tool_name.slice(0, 200) : undefined,
    toolInput: ask ? toolInput : undefined,
  }) + '\\n';
  const client = net.connect(socket, () => (ask ? client.write(line) : client.end(line)));
  let reply = '';
  client.setEncoding('utf8');
  client.on('data', (chunk) => {
    reply += chunk;
    const end = reply.indexOf('\\n');
    if (end < 0) return;
    const answer = OUTPUT[reply.slice(0, end).trim()];
    if (answer) process.stdout.write(answer + '\\n', () => process.exit(0));
    else process.exit(0);
  });
  client.on('error', () => process.exit(0));
  client.on('close', () => process.exit(0));
});
`;

export interface ClaudeHooks {
  readonly config: HookConfig;
  /** Responde (ou solta) o hook de permissao que espera com este id. */
  answer(askId: string, answer: PermissionAnswer): void;
  stop(): void;
}

export interface HookListeners {
  /** `false` = nenhum terminal com este token aceitou o evento. */
  onEvent(token: string, event: AgentEvent): boolean;
  /** O hook de permissao desistiu de esperar (expirou, o Claude o matou). */
  onAskGone(askId: string): void;
}

/**
 * Sobe o socket que recebe os hooks e grava o script e o arquivo de
 * `--settings` em `dataDir`. `null` onde nao ha suporte (Windows, por ora) ou
 * se algo falhar: o app segue so com a heuristica do fluxo de bytes.
 */
export function startClaudeHooks(
  dataDir: string,
  execPath: string,
  listeners: HookListeners,
): ClaudeHooks | null {
  if (process.platform === 'win32') return null;
  try {
    const scriptPath = join(dataDir, 'claude-hook.cjs');
    const settingsPath = join(dataDir, 'claude-hooks.json');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(scriptPath, HOOK_SCRIPT, { mode: 0o600 });
    const command = `ELECTRON_RUN_AS_NODE=1 ${shellQuote(execPath)} ${shellQuote(scriptPath)}`;
    writeFileSync(settingsPath, `${JSON.stringify(hookSettings(command), null, 2)}\n`, { mode: 0o600 });

    const { socketPath, cleanup } = socketLocation();
    const asks = new Map<string, Socket>();
    const server = listen(socketPath, listeners, asks);
    return {
      config: { settingsArg: shellQuote(settingsPath), env: { MULTITERM_HOOK_SOCKET: socketPath } },
      answer: (askId, answer) => {
        const connection = asks.get(askId);
        if (!connection) return;
        asks.delete(askId);
        connection.end(`${answer}\n`);
      },
      stop: () => {
        for (const connection of asks.values()) connection.destroy();
        asks.clear();
        server.close();
        cleanup();
      },
    };
  } catch (error) {
    console.error('[hooks] desligados:', error);
    return null;
  }
}

/**
 * Socket num diretorio so do usuario: o `XDG_RUNTIME_DIR` (0700) ou uma
 * pasta temporaria criada com 0700. Um por processo, para um app que caiu nao
 * deixar o caminho ocupado.
 */
function socketLocation(): { socketPath: string; cleanup: () => void } {
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (runtime) {
    const socketPath = join(runtime, `multiterm-${process.pid}.sock`);
    // Caminho de socket tem limite (~108 bytes): longo demais, vai para o tmp.
    if (socketPath.length < 100) {
      removeStaleSockets(runtime);
      removeQuietly(socketPath);
      return { socketPath, cleanup: () => removeQuietly(socketPath) };
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'multiterm-'));
  chmodSync(dir, 0o700);
  return { socketPath: join(dir, 'hooks.sock'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function listen(socketPath: string, listeners: HookListeners, asks: Map<string, Socket>): Server {
  const server = createServer((connection) => {
    connection.setEncoding('utf8');
    connection.setTimeout(CONNECTION_TIMEOUT_MS, () => connection.destroy());
    let askId: string | null = null;
    let buffer = '';
    connection.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        // Uma conexao, um pedido: o que vier depois e ignorado.
        if (askId) continue;
        askId = handleLine(line, listeners.onEvent, randomUUID);
        if (!askId) continue;
        asks.set(askId, connection);
        // O app espera ate ASK_TIMEOUT_MS; depois o pedido fica so no terminal.
        connection.setTimeout(ASK_TIMEOUT_MS, () => {
          connection.end('release\n');
        });
      }
      if (buffer.length > MAX_LINE) connection.destroy();
    });
    connection.on('close', () => {
      if (askId && asks.get(askId) === connection) {
        asks.delete(askId);
        listeners.onAskGone(askId);
      }
    });
    connection.on('error', () => connection.destroy());
  });
  server.on('error', (error) => console.error('[hooks] socket:', error));
  server.listen(socketPath, () => {
    try {
      chmodSync(socketPath, 0o600);
    } catch {
      // o diretorio ja e so do usuario
    }
  });
  return server;
}

/**
 * Uma linha do script de hook. Devolve o id do pedido quando e um
 * PermissionRequest (a conexao fica aberta esperando a resposta).
 */
export function handleLine(
  line: string,
  onEvent: (token: string, event: AgentEvent) => boolean,
  newAskId: () => string,
): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const token = input.token;
  if (typeof token !== 'string' || token.length > 64) return null;
  const askId = input.event === 'PermissionRequest' ? newAskId() : null;
  const event = parseAgentEvent(askId ? { ...input, askId } : input);
  if (!event) return null;
  // Pedido que nenhum terminal aceitou: a conexao cai pelo timeout curto e o
  // dialogo do terminal decide.
  const accepted = onEvent(token, event);
  return event.kind === 'ask' && accepted ? askId : null;
}

/** Sockets de instancias que morreram sem fechar (kill -9, queda de energia). */
function removeStaleSockets(dir: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const pid = /^multiterm-(\d+)\.sock$/.exec(name)?.[1];
    if (pid && !isAlive(Number(pid))) removeQuietly(join(dir, name));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: existe, so nao e nosso.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // nao existia
  }
}
