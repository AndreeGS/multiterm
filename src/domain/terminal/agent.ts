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

export type AgentEventKind = 'start' | 'prompt' | 'stop' | 'permission' | 'end';

export interface AgentEvent {
  readonly kind: AgentEventKind;
  /** Conversa em que o evento aconteceu; muda com `/clear` e `/resume`. */
  readonly sessionId: string | null;
  /** Texto do pedido (so em `permission`). */
  readonly message: string | null;
}

/** O que chega do script de hook (ja reduzido por ele), validado aqui. */
export function parseAgentEvent(raw: unknown): AgentEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const kind = eventKind(input.event, input.notificationType, input.message);
  if (!kind) return null;
  // O `/clear` encerra a conversa e abre outra no mesmo agente: nao saiu nada.
  if (kind === 'end' && input.reason === 'clear') return null;
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
    case 'Notification':
      if (type === 'permission_prompt' || type === 'elicitation_dialog') return 'permission';
      // Versoes sem `notification_type`: o texto diz se e um pedido de permissao.
      if (type === undefined && typeof message === 'string' && /permission/i.test(message)) return 'permission';
      return null;
    default:
      return null;
  }
}

function cleanMessage(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Texto mostrado quando o pedido de permissao chega sem mensagem. */
export const PERMISSION_NOTICE = 'pediu permissao';

/** Eventos de hook que o MultiTerm escuta. */
export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification', 'SessionEnd'] as const;

/**
 * Conteudo do arquivo passado em `--settings`: os hooks somam com os do
 * usuario (nada no `~/.claude` e tocado). `command` e a linha que roda o
 * script de hook.
 */
export function hookSettings(command: string): object {
  const entry = [{ hooks: [{ type: 'command', command, timeout: 10 }] }];
  return { hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, entry])) };
}

/** Aspas simples de shell POSIX. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}
