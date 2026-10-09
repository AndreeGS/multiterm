import { basename, dirname, join } from 'node:path';
import { isValidBranchName } from './branch.js';

/**
 * Worktree criado pelo app para isolar um terminal: o agente trabalha numa
 * branch propria, numa pasta propria, sem mexer na copia principal do repo.
 */
export interface WorktreeInfo {
  /** Raiz da copia principal do repositorio. */
  readonly repo: string;
  /** Pasta do worktree; e o cwd do terminal. */
  readonly path: string;
  readonly branch: string;
}

/** O que o dialogo de novo terminal precisa saber de um diretorio. */
export interface GitInfo {
  /** Raiz da copia principal; `null` = nao e um repositorio git. */
  readonly repo: string | null;
  /** Branch atual do diretorio; `null` = HEAD solto ou fora de repo. */
  readonly branch: string | null;
}

/** Uma entrada de `git worktree list --porcelain`. */
export interface WorktreeEntry {
  readonly path: string;
  /** `null` = HEAD solto. */
  readonly branch: string | null;
}

/**
 * Porta para o git. O dominio nao executa processos: a infraestrutura
 * implementa isto com o `git` da maquina.
 */
export interface Git {
  info(cwd: string): Promise<GitInfo>;
  branchExists(repo: string, branch: string): Promise<boolean>;
  listWorktrees(repo: string): Promise<WorktreeEntry[]>;
  /** `create` = cria a branch a partir do HEAD; senao faz checkout da existente. */
  addWorktree(repo: string, path: string, branch: string, create: boolean): Promise<void>;
  removeWorktree(repo: string, path: string, force: boolean): Promise<void>;
  /** Ha mudancas nao commitadas (inclusive arquivos novos)? */
  isDirty(path: string): Promise<boolean>;
}

/**
 * Pasta do worktree: irma do repo, `<pai>/<repo>.worktrees/<branch>`. Fica
 * fora do repo (nada para por no .gitignore) e agrupada (facil de achar e limpar).
 * Barras da branch viram hifen: `feat/x` -> `feat-x`.
 */
export function worktreePath(repo: string, branch: string): string {
  return join(dirname(repo), `${basename(repo)}.worktrees`, branch.replace(/\//g, '-'));
}

/** Le a saida de `git worktree list --porcelain`. */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of output.split(/\n\s*\n/)) {
    let path: string | null = null;
    let branch: string | null = null;
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
      else if (line.startsWith('branch refs/heads/')) branch = line.slice('branch refs/heads/'.length);
    }
    if (path) entries.push({ path, branch });
  }
  return entries;
}

/** Valor vindo do disco ou do IPC. */
export function parseWorktreeInfo(raw: unknown): WorktreeInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { repo, path, branch } = raw as Record<string, unknown>;
  if (typeof repo !== 'string' || !repo || typeof path !== 'string' || !path) return null;
  if (typeof branch !== 'string' || !isValidBranchName(branch)) return null;
  return { repo, path, branch };
}
