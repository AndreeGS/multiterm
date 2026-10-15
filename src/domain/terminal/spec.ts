import { parsePaneColor } from '../workspace/colors.js';
import type { TerminalSize, TerminalSpec } from './types.js';

const MAX_NAME = 200;
const MAX_PATH = 4096;
const MAX_COMMAND = 4096;
const MAX_SESSION_ID = 64;
const MAX_TERMINAL_DIMENSION = 1000;

/**
 * Spec vindo do renderer. So os campos que o renderer escolhe: worktree e
 * workspace quem decide e o main. `null` se faltar o essencial ou algum campo
 * tiver tipo errado.
 */
export function parseTerminalSpec(raw: unknown): TerminalSpec | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const name = input.name ?? '';
  const { cwd, shell, command, claudeSession } = input;
  if (typeof name !== 'string' || name.length > MAX_NAME) return null;
  if (typeof cwd !== 'string' || cwd.length > MAX_PATH) return null;
  if (shell !== undefined && (typeof shell !== 'string' || shell.length > MAX_PATH)) return null;
  if (command !== undefined && (typeof command !== 'string' || command.length > MAX_COMMAND)) return null;
  if (claudeSession != null && (typeof claudeSession !== 'string' || claudeSession.length > MAX_SESSION_ID)) {
    return null;
  }
  return {
    name,
    cwd,
    ...(shell !== undefined ? { shell } : {}),
    ...(command !== undefined ? { command } : {}),
    color: parsePaneColor(input.color),
    claudeSession: claudeSession ?? null,
  };
}

/** Tamanho pedido pelo renderer: inteiros entre 1 e 1000, senao `null`. */
export function parseTerminalSize(cols: unknown, rows: unknown): TerminalSize | null {
  const valid = (value: unknown): value is number =>
    Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_TERMINAL_DIMENSION;
  return valid(cols) && valid(rows) ? { cols, rows } : null;
}
