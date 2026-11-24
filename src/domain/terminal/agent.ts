/**
 * Estado do agente (Claude Code) de um terminal, informado pelos hooks dele
 * em vez de deduzido do fluxo de bytes.
 *
 * O MultiTerm abre o `claude` com `--settings <arquivo>`, que liga hooks em
 * SessionStart, UserPromptSubmit, Stop, Notification e SessionEnd. Cada hook
 * roda um script do app que repassa o evento ao main por um socket local,
 * identificado pelo token do terminal (variavel de ambiente do pty).
 */
import { parseSessionId } from './command.js';

/**
 * - `working`: recebeu um prompt e esta trabalhando;
 * - `waiting`: terminou a volta (ou acabou de abrir) e espera voce;
 * - `permission`: parou no meio, pedindo permissao ou uma resposta.
 */
export type AgentPhase = 'working' | 'waiting' | 'permission';

export interface AgentState {
  readonly phase: AgentPhase;
  /** Voltas terminadas (hooks Stop) desde que o agente abriu: a fila de tarefas anda por aqui. */
  readonly turns: number;
}

export type AgentEventKind = 'start' | 'prompt' | 'stop' | 'permission' | 'ask' | 'end';

export interface AgentEvent {
  readonly kind: AgentEventKind;
  /** Conversa em que o evento aconteceu; muda com `/clear` e `/resume`. */
  readonly sessionId: string | null;
  /** Texto do pedido (so em `permission`). */
  readonly message: string | null;
  /** Pedido de permissao que o app pode responder (so em `ask`). */
  readonly ask?: PermissionAsk;
}

/**
 * Pedido de permissao vindo do hook PermissionRequest. O script de hook fica
 * esperando a resposta pelo socket; o dialogo do Claude aparece no terminal ao
 * mesmo tempo, e vale quem responder primeiro.
 */
export interface PermissionAsk {
  /** Id da conexao que espera a resposta (dado pelo servidor do socket). */
  readonly id: string;
  /** Ferramenta (`Bash`, `Edit`, `mcp__servidor__acao`...). */
  readonly tool: string;
  /** O que ela vai fazer: o comando, o arquivo... uma linha, ja limpa. */
  readonly summary: string;
}

/** Resposta do app a um pedido; `release` solta o hook sem decidir (fica o dialogo do terminal). */
export type PermissionAnswer = 'allow' | 'deny' | 'release';

export function isPermissionAnswer(value: unknown): value is PermissionAnswer {
  return value === 'allow' || value === 'deny' || value === 'release';
}

const MAX_SUMMARY = 300;

/**
 * Uma linha que diz o que a ferramenta vai fazer: o comando do Bash, o arquivo
 * do Edit/Write/Read, a URL do WebFetch... O resto vira um JSON curto.
 */
export function summarizeToolInput(tool: string, input: unknown): string {
  const fields = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = fields[key];
      if (typeof value === 'string' && value) return value;
    }
    return null;
  };
  const main = pick('command', 'file_path', 'notebook_path', 'url', 'pattern', 'query', 'path', 'prompt', 'description');
  let text = main;
  if (text === null) {
    try {
      text = JSON.stringify(input) ?? '';
    } catch {
      text = '';
    }
  }
  return cleanMessage(text, MAX_SUMMARY) || tool;
}

/** Saida do hook PermissionRequest para permitir ou negar. */
export function permissionDecisionOutput(answer: 'allow' | 'deny'): string {
  const decision = answer === 'allow'
    ? { behavior: 'allow' }
    : { behavior: 'deny', message: 'Negado pelo usuario no MultiTerm.' };
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
}

/** O que chega do script de hook (ja reduzido por ele), validado aqui. */
export function parseAgentEvent(raw: unknown): AgentEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const kind = eventKind(input.event, input.notificationType, input.message);
  if (!kind) return null;
  // O `/clear` encerra a conversa e abre outra no mesmo agente: nao saiu nada.
  if (kind === 'end' && input.reason === 'clear') return null;
  if (kind === 'ask') {
    const tool = typeof input.toolName === 'string' ? cleanMessage(input.toolName, 100) : '';
    if (typeof input.askId !== 'string' || !input.askId || !tool) return null;
    const ask = { id: input.askId, tool, summary: summarizeToolInput(tool, input.toolInput) };
    return { kind, sessionId: parseSessionId(input.sessionId), message: null, ask };
  }
  const message = kind === 'permission' && typeof input.message === 'string' ? cleanMessage(input.message) : null;
  return { kind, sessionId: parseSessionId(input.sessionId), message: message || null };
}

/**
 * Nome do hook -> evento. Das notificacoes, so as que pedem uma decisao sua
 * contam (`permission_prompt`, `elicitation_dialog`): a `idle_prompt` chega um
 * minuto depois do Stop, que ja avisou.
 */
function eventKind(event: unknown, type: unknown, message: unknown): AgentEventKind | null {
  switch (event) {
    case 'SessionStart': return 'start';
    case 'UserPromptSubmit': return 'prompt';
    case 'Stop': return 'stop';
    case 'SessionEnd': return 'end';
    case 'PermissionRequest': return 'ask';
    case 'Notification':
      if (type === 'permission_prompt' || type === 'elicitation_dialog') return 'permission';
      // Versoes sem `notification_type`: o texto diz se e um pedido de permissao.
      if (type === undefined && typeof message === 'string' && /permission/i.test(message)) return 'permission';
      return null;
    default:
      return null;
  }
}

function cleanMessage(text: string, max = 200): string {
  return text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Texto mostrado quando o pedido de permissao chega sem mensagem. */
export const PERMISSION_NOTICE = 'pediu permissao';

/** Eventos de hook que o MultiTerm escuta. */
export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification', 'SessionEnd', 'PermissionRequest'] as const;

/** O hook de permissao espera voce: o limite dele e maior que o tempo que o app espera. */
export const ASK_TIMEOUT_MS = 120_000;
const ASK_HOOK_TIMEOUT_S = 150;

/**
 * Conteudo do arquivo passado em `--settings`: os hooks somam com os do
 * usuario (nada no `~/.claude` e tocado). `command` e a linha que roda o
 * script de hook.
 */
export function hookSettings(command: string): object {
  const entry = (timeout: number) => [{ hooks: [{ type: 'command', command, timeout }] }];
  return {
    hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, entry(event === 'PermissionRequest' ? ASK_HOOK_TIMEOUT_S : 10)])),
  };
}

/** Aspas simples de shell POSIX. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}
