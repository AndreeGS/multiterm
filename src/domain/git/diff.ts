/**
 * Leitura de um diff unificado (`git diff`), sem dependencia de Node: quem
 * desenha e o renderer.
 */

export type DiffLineKind = 'hunk' | 'add' | 'del' | 'ctx' | 'note';

export interface DiffLine {
  readonly kind: DiffLineKind;
  /** Sem o `+`/`-`/espaco do comeco (o cabecalho `@@` fica inteiro). */
  readonly text: string;
}

export type DiffChange = 'added' | 'deleted' | 'renamed' | 'modified';

export interface DiffFile {
  readonly path: string;
  /** Nome antigo, quando foi renomeado. */
  readonly oldPath: string | null;
  readonly change: DiffChange;
  readonly binary: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly lines: readonly DiffLine[];
}

interface Draft {
  path: string;
  oldPath: string | null;
  change: DiffChange;
  binary: boolean;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: Draft[] = [];
  let current: Draft | null = null;
  let inHunk = false;

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { path: headerPath(line.slice('diff --git '.length)), oldPath: null, change: 'modified', binary: false, additions: 0, deletions: 0, lines: [] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('@@')) {
      inHunk = true;
      current.lines.push({ kind: 'hunk', text: line });
      continue;
    }
    if (inHunk) {
      // Dentro de um trecho, `--- x` e uma linha removida que comecava com `-- x`.
      const mark = line[0];
      if (mark === '+') {
        current.additions++;
        current.lines.push({ kind: 'add', text: line.slice(1) });
      } else if (mark === '-') {
        current.deletions++;
        current.lines.push({ kind: 'del', text: line.slice(1) });
      } else if (mark === ' ') {
        current.lines.push({ kind: 'ctx', text: line.slice(1) });
      } else if (mark === '\\') {
        current.lines.push({ kind: 'note', text: line });
      }
      continue;
    }
    // Metadados entre o `diff --git` e o primeiro `@@`.
    if (line.startsWith('new file mode')) current.change = 'added';
    else if (line.startsWith('deleted file mode')) current.change = 'deleted';
    else if (line.startsWith('rename from ')) {
      current.change = 'renamed';
      current.oldPath = unquote(line.slice('rename from '.length));
    } else if (line.startsWith('rename to ')) current.path = unquote(line.slice('rename to '.length));
    else if (line.startsWith('Binary files ') || line === 'GIT binary patch') current.binary = true;
    else if (line.startsWith('+++ ') && line !== '+++ /dev/null') current.path = stripPrefix(unquote(line.slice(4)));
    else if (line.startsWith('--- ') && line !== '--- /dev/null' && current.change === 'deleted') {
      current.path = stripPrefix(unquote(line.slice(4)));
    }
  }
  return files;
}

/** `a/x b/x` -> `x`. So acerta quando os dois lados sao iguais; os outros casos vem do `+++`/`rename to`. */
function headerPath(rest: string): string {
  if (rest.startsWith('"')) {
    const end = rest.indexOf('" ');
    return stripPrefix(unquote(end > 0 ? rest.slice(0, end + 1) : rest));
  }
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === ' ' && rest.slice(2, half) === rest.slice(half + 3)) return rest.slice(2, half);
  const space = rest.indexOf(' b/');
  return stripPrefix(space > 0 ? rest.slice(0, space) : rest);
}

function stripPrefix(path: string): string {
  return /^[ab]\//.test(path) ? path.slice(2) : path;
}

/** Caminho entre aspas, como o git escreve nomes com caracteres especiais. */
function unquote(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"') || path.length < 2) return path;
  const escapes: Record<string, string> = { n: '\n', t: '\t', '"': '"', '\\': '\\' };
  return path.slice(1, -1).replace(/\\(.)/g, (_match, char: string) => escapes[char] ?? char);
}

/**
 * Corta um diff grande numa quebra de linha, para nao travar a janela com
 * megabytes de texto (um lockfile regenerado, por exemplo).
 */
export function truncateDiff(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const cut = text.lastIndexOf('\n', maxChars);
  return { text: text.slice(0, cut > 0 ? cut : maxChars), truncated: true };
}
