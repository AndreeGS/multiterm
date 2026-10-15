import { basename, dirname, join } from 'node:path';

// Separado de worktree.ts: aquele modulo tambem descreve tipos que o renderer
// usa, e o renderer nao tem `node:path`.

/**
 * Pasta do worktree: irma do repo, `<pai>/<repo>.worktrees/<branch>`. Fica
 * fora do repo (nada para por no .gitignore) e agrupada (facil de achar e limpar).
 * Barras da branch viram hifen: `feat/x` -> `feat-x`.
 */
export function worktreePath(repo: string, branch: string): string {
  return join(dirname(repo), `${basename(repo)}.worktrees`, branch.replace(/\//g, '-'));
}
