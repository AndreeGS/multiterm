/**
 * Marcas de prompt OSC 133 ("FinalTerm"/semantic prompts), que o shell emite
 * em volta de cada comando:
 *
 * - `A`: o prompt vai ser desenhado;
 * - `C`: o comando digitado comecou a rodar;
 * - `D;<codigo>`: o comando terminou, com o exit code.
 *
 * O fish 4 emite sozinho; no zsh, quem configurou (starship, p10k, a mao). No
 * bash o MultiTerm injeta pelo ambiente (`PROMPT_COMMAND` e `PS0`), sem
 * arquivo de rc proprio: se o seu rc redefinir essas variaveis, so ficam sem
 * as marcas.
 */

export type ShellMark =
  | { readonly kind: 'prompt' }
  | { readonly kind: 'command-start' }
  | { readonly kind: 'command-end'; readonly exitCode: number | null };

/** O corpo de um OSC 133 (sem o `133;`) vira uma marca; o resto (`B`, `P`...) e ignorado. */
export function parseShellMark(body: string): ShellMark | null {
  const [kind, code] = body.split(';');
  if (kind === 'A') return { kind: 'prompt' };
  if (kind === 'C') return { kind: 'command-start' };
  if (kind === 'D') {
    const exitCode = code !== undefined && /^\d{1,3}$/.test(code) ? Number(code) : null;
    return { kind: 'command-end', exitCode };
  }
  return null;
}

/** Ultimo comando terminado no shell do terminal. */
export interface CommandResult {
  /** `null` = o shell nao informou. */
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly endedAt: number;
}

/**
 * `PROMPT_COMMAND` emite o fim do comando anterior (com o `$?`), o diretorio
 * atual (OSC 7) e o inicio do prompt, e devolve o `$?` para quem vier depois
 * (PS1 que mostra o codigo).
 * `PS0` sai depois do Enter, antes do comando rodar.
 */
const BASH_PROMPT_COMMAND =
  '__mt_s=$?;__mt_p=${PWD//%/%25};' +
  'printf "\\e]133;D;%s\\a\\e]7;file://%s%s\\a\\e]133;A\\a" "$__mt_s" "$HOSTNAME" "${__mt_p// /%20}";(exit $__mt_s)';
const BASH_PS0 = '\\e]133;C\\a';

/** Variaveis de ambiente que ligam as marcas no bash; `{}` para outros shells. */
type Env = Readonly<Record<string, string | undefined>>;

export function shellIntegrationEnv(shell: string, base: Env): Record<string, string> {
  const name = (shell.split(/[\\/]/).pop() ?? shell).replace(/^-/, '');
  if (name !== 'bash') return {};
  const previous = base.PROMPT_COMMAND?.trim();
  return {
    PROMPT_COMMAND: previous ? `${BASH_PROMPT_COMMAND};${previous}` : BASH_PROMPT_COMMAND,
    ...(base.PS0 ? {} : { PS0: BASH_PS0 }),
  };
}

/** `4s`, `2m 3s`, `1h 5m`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** `ha 5 min`, `ha 2 h`; menos de um minuto nao vale mostrar (`null`). */
export function formatWaiting(ms: number): string | null {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return `ha ${minutes} min`;
  return `ha ${Math.floor(minutes / 60)} h`;
}

/**
 * Diretorio de um OSC 7 (`file://host/caminho`, com `%XX`). So vale se o host
 * for esta maquina (ou vazio/localhost): dentro de um `ssh`, o shell remoto
 * manda caminhos que aqui nao existem. `null` = ignorar.
 */
export function parseOsc7(body: string, hostname: string): string | null {
  const match = /^file:\/\/([^/]*)(\/.*)$/.exec(body);
  if (!match) return null;
  const host = match[1]!.toLowerCase();
  const local = hostname.toLowerCase();
  if (host && host !== 'localhost' && host !== local && host !== local.split('.')[0]) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[2]!);
  } catch {
    return null;
  }
  return path.startsWith('/') && !/[\x00-\x1f]/.test(path) ? path : null;
}
