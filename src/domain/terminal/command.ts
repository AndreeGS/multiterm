/**
 * Comando inicial de um terminal: digitado no shell assim que ele fica pronto
 * (ex.: `claude`, `npm run dev`). E texto puro — o shell e quem executa, com o
 * mesmo PATH e aliases de quando voce digita.
 */

export const MAX_COMMAND_LENGTH = 500;

/** Uma linha so: quebras viraram varios comandos sem voce perceber. */
export function cleanCommand(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_COMMAND_LENGTH);
}

/** O comando sobe o Claude Code (`claude`, `claude --model x`, `~/bin/claude`...). */
export function isClaudeCommand(command: string): boolean {
  const first = command.trim().split(/\s+/)[0] ?? '';
  return first === 'claude' || first.endsWith('/claude');
}

/** Flags que ja escolhem a conversa (ou nao abrem uma interativa). */
const SESSION_FLAGS = /(^|\s)(-c|--continue|-r|--resume|-p|--print|--session-id)(\s|=|$)/;

/**
 * Versao do comando que retoma a ultima conversa do diretorio. Usado ao
 * restaurar a sessao: o terminal volta para o ponto onde o agente estava.
 * Comandos que nao sao do Claude, ou que ja escolhem a conversa, ficam iguais.
 */
export function withContinue(command: string): string {
  return wantsOwnSession(command) ? withFlags(command, '--continue') : command;
}

/** Nome da pasta em `~/.claude/projects` onde ficam as conversas de um cwd. */
export function claudeProjectKey(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/* ---------- conversa do Claude por terminal ---------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id de conversa do Claude Code (um UUID); qualquer outra coisa vira `null`. */
export function parseSessionId(raw: unknown): string | null {
  return typeof raw === 'string' && UUID.test(raw) ? raw.toLowerCase() : null;
}

/**
 * Conversa que o comando ja escolhe por id (`--session-id X`, `--resume X`,
 * `-r X`). `null` quando nao escolhe ou escolhe sem id (`--continue`, `-r` sozinho).
 */
export function sessionIdOf(command: string): string | null {
  const match = /(?:^|\s)(?:--session-id|--resume|-r)(?:=|\s+)(\S+)/.exec(command);
  return match ? parseSessionId(match[1]) : null;
}

/**
 * O app deve escolher a conversa deste comando? So para um `claude`
 * interativo que nao escolhe nenhuma por conta propria.
 */
export function wantsOwnSession(command: string): boolean {
  return isClaudeCommand(command) && !SESSION_FLAGS.test(command);
}

/** Insere `flags` logo depois do executavel (`claude <flags> --model x`). */
function withFlags(command: string, flags: string): string {
  const trimmed = command.trim();
  const space = trimmed.search(/\s/);
  return space < 0 ? `${trimmed} ${flags}` : `${trimmed.slice(0, space)} ${flags}${trimmed.slice(space)}`;
}

/**
 * Comando realmente digitado no shell para um terminal com conversa propria:
 * a primeira vez abre a conversa com o id do terminal; depois que ela existe
 * (reiniciar, restaurar a sessao), retoma a mesma — o Claude recusa um
 * `--session-id` que ja esta em uso.
 */
export function claudeLaunchCommand(command: string, sessionId: string, exists: boolean): string {
  return withFlags(command, exists ? `--resume ${sessionId}` : `--session-id ${sessionId}`);
}
