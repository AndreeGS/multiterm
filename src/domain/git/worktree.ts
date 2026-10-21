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
  /**
   * Branch da copia principal quando o worktree foi criado: e contra ela que
   * o cabecalho conta os commits e o diff compara. Ausente em worktrees
   * salvos por versoes anteriores (ai vale a branch atual da copia principal).
   */
  readonly base?: string;
}

/** Contagens de `git status` de um worktree. */
export interface WorktreeChanges {
  /** Arquivos rastreados com mudanca (no index ou na pasta). */
  readonly changed: number;
  /** Arquivos novos, ainda fora do git. */
  readonly untracked: number;
  /** Arquivos em conflito de merge/rebase. */
  readonly conflicts: number;
}

/** O que o cabecalho mostra de um worktree: `+novos ~alterados ↑frente ↓atras`. */
export interface WorktreeStatus extends WorktreeChanges {
  /** Branch contra a qual `ahead`/`behind` sao contados; `null` = sem base conhecida. */
  readonly base: string | null;
  /** Commits da branch do worktree que a base nao tem. */
  readonly ahead: number;
  /** Commits da base que a branch do worktree nao tem. */
  readonly behind: number;
}

/** Diff cru de um worktree, como o git imprimiu. */
export interface WorktreeDiff {
  readonly text: string;
  /** Contra o que foi comparado (a base) ou `null` = so o que nao foi commitado. */
  readonly base: string | null;
  /** Grande demais: o texto foi cortado. */
  readonly truncated: boolean;
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
  /** Esquece worktrees cuja pasta foi apagada por fora (`git worktree prune`). */
  pruneWorktrees(repo: string): Promise<void>;
  /** Ha mudancas nao commitadas (inclusive arquivos novos)? */
  isDirty(path: string): Promise<boolean>;
  status(path: string): Promise<WorktreeChanges>;
  /** Commits a frente/atras de `base`; `null` = a base nao existe (mais). */
  aheadBehind(path: string, base: string): Promise<{ ahead: number; behind: number } | null>;
  /**
   * Tudo o que o worktree mudou desde que saiu de `base` (commits e o que nao
   * foi commitado, inclusive arquivos novos); sem base, so o nao commitado.
   */
  diff(path: string, base: string | null): Promise<WorktreeDiff>;
}

/** Le a saida de `git status --porcelain=v2`. */
export function parseStatus(output: string): WorktreeChanges {
  let changed = 0;
  let untracked = 0;
  let conflicts = 0;
  for (const line of output.split('\n')) {
    if (line.startsWith('1 ') || line.startsWith('2 ')) changed++;
    else if (line.startsWith('u ')) conflicts++;
    else if (line.startsWith('? ')) untracked++;
  }
  return { changed, untracked, conflicts };
}

/** Le `git rev-list --left-right --count <base>...HEAD` (atras, tab, a frente). */
export function parseAheadBehind(output: string): { ahead: number; behind: number } | null {
  const match = /^(\d+)\s+(\d+)\s*$/.exec(output.trim());
  return match ? { behind: Number(match[1]), ahead: Number(match[2]) } : null;
}

/** Texto curto do cabecalho, ex.: `+2 ~3 ↑1`; vazio quando nao ha nada a mostrar. */
export function formatStatus(status: WorktreeStatus): string {
  const parts: string[] = [];
  if (status.conflicts) parts.push(`!${status.conflicts}`);
  if (status.untracked) parts.push(`+${status.untracked}`);
  if (status.changed) parts.push(`~${status.changed}`);
  if (status.ahead) parts.push(`↑${status.ahead}`);
  if (status.behind) parts.push(`↓${status.behind}`);
  return parts.join(' ');
}

/** Tooltip do status, por extenso. */
export function describeStatus(status: WorktreeStatus): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const lines: string[] = [];
  if (status.conflicts) lines.push(plural(status.conflicts, 'arquivo em conflito', 'arquivos em conflito'));
  if (status.changed) lines.push(plural(status.changed, 'arquivo alterado', 'arquivos alterados'));
  if (status.untracked) lines.push(plural(status.untracked, 'arquivo novo', 'arquivos novos'));
  if (lines.length === 0) lines.push('Nada por commitar');
  if (status.base) {
    if (status.ahead) lines.push(`${plural(status.ahead, 'commit', 'commits')} a frente de ${status.base}`);
    if (status.behind) lines.push(`${plural(status.behind, 'commit', 'commits')} atras de ${status.base}`);
    if (!status.ahead && !status.behind) lines.push(`Igual a ${status.base}`);
  }
  return lines.join('\n');
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
  const { repo, path, branch, base } = raw as Record<string, unknown>;
  if (typeof repo !== 'string' || !repo || typeof path !== 'string' || !path) return null;
  if (typeof branch !== 'string' || !isValidBranchName(branch)) return null;
  // Base invalida nao derruba o worktree: so deixa de ser usada.
  const validBase = typeof base === 'string' && isValidBranchName(base) && base !== branch;
  return validBase ? { repo, path, branch, base } : { repo, path, branch };
}
