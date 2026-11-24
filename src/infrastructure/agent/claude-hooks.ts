import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hookSettings, parseAgentEvent, shellQuote, type AgentEvent } from '../../domain/terminal/agent.js';
import type { HookConfig } from '../../application/terminal/terminal-service.js';

/** Uma linha de evento e pequena; mais que isto e lixo (ou abuso) e a conexao cai. */
const MAX_LINE = 16 * 1024;
const CONNECTION_TIMEOUT_MS = 5000;

/**
 * Script que o Claude Code roda em cada hook: le o JSON do stdin, fica so com
 * o que o app usa e manda uma linha para o socket do MultiTerm. Sempre sai
 * com 0 e sem stdout: um hook nunca pode atrapalhar o agente.
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
setTimeout(() => process.exit(0), 3000).unref();
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { if (input.length < 1e6) input += chunk; });
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(input); } catch { process.exit(0); }
  const line = JSON.stringify({
    token,
    event: data.hook_event_name,
    sessionId: data.session_id,
    notificationType: data.notification_type,
    reason: data.reason,
    message: typeof data.message === 'string' ? data.message.slice(0, 500) : undefined,
  }) + '\\n';
  const client = net.connect(socket, () => client.end(line));
  client.on('error', () => process.exit(0));
  client.on('close', () => process.exit(0));
});
`;

export interface ClaudeHooks {
  readonly config: HookConfig;
  stop(): void;
}

/**
 * Sobe o socket que recebe os hooks e grava o script e o arquivo de
 * `--settings` em `dataDir`. `null` onde nao ha suporte (Windows, por ora) ou
 * se algo falhar: o app segue so com a heuristica do fluxo de bytes.
 */
export function startClaudeHooks(
  dataDir: string,
  execPath: string,
  onEvent: (token: string, event: AgentEvent) => void,
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
    const server = listen(socketPath, onEvent);
    return {
      config: { settingsArg: shellQuote(settingsPath), env: { MULTITERM_HOOK_SOCKET: socketPath } },
      stop: () => {
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

function listen(socketPath: string, onEvent: (token: string, event: AgentEvent) => void): Server {
  const server = createServer((connection) => {
    connection.setEncoding('utf8');
    connection.setTimeout(CONNECTION_TIMEOUT_MS, () => connection.destroy());
    let buffer = '';
    connection.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        handleLine(buffer.slice(0, newline), onEvent);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
      if (buffer.length > MAX_LINE) connection.destroy();
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

export function handleLine(line: string, onEvent: (token: string, event: AgentEvent) => void): void {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return;
  }
  const token = (raw as { token?: unknown } | null)?.token;
  if (typeof token !== 'string' || token.length > 64) return;
  const event = parseAgentEvent(raw);
  if (event) onEvent(token, event);
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
