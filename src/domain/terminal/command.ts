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
  if (!isClaudeCommand(command) || SESSION_FLAGS.test(command)) return command;
  const trimmed = command.trim();
  const space = trimmed.search(/\s/);
  return space < 0 ? `${trimmed} --continue` : `${trimmed.slice(0, space)} --continue${trimmed.slice(space)}`;
}

/** Nome da pasta em `~/.claude/projects` onde ficam as conversas de um cwd. */
export function claudeProjectKey(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}
