import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isValidBranchName } from '../../domain/git/branch.js';
import type { Git, GitInfo, WorktreeDiff, WorktreeInfo, WorktreeStatus } from '../../domain/git/worktree.js';
import { worktreePath } from '../../domain/git/worktree-path.js';

/**
 * Caso de uso: worktrees por terminal. Cria a pasta isolada antes do terminal
 * abrir e remove quando voce decide, sem nunca apagar a branch.
 */
export class WorktreeService {
  /** Criacao em andamento por repo: dois pedidos juntos (duplo submit) nao disputam a mesma branch. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly git: Git) {}

  info(cwd: string): Promise<GitInfo> {
    return this.git.info(cwd);
  }

  /**
   * Worktree para `branch` no repo de `cwd`. A branch nova sai do HEAD atual;
   * se ja existe, e usada. Se essa branch ja tem um worktree, ele e reaproveitado.
   */
  async create(cwd: string, branch: string): Promise<WorktreeInfo> {
    if (!isValidBranchName(branch)) throw new Error(`Nome de branch invalido: "${branch}"`);
    const { repo } = await this.git.info(cwd);
    if (!repo) throw new Error('O diretorio nao esta num repositorio git.');
    return this.serialized(repo, () => this.createIn(repo, branch));
  }

  private async createIn(repo: string, branch: string): Promise<WorktreeInfo> {
    // A branch em que a copia principal esta agora e de onde a nova sai: e
    // contra ela que o cabecalho conta commits e o diff compara.
    const mainBranch = (await this.git.info(repo)).branch;
    const base = mainBranch && mainBranch !== branch ? { base: mainBranch } : {};
    let existing = (await this.git.listWorktrees(repo)).find((entry) => entry.branch === branch);
    if (existing && !existsSync(existing.path)) {
      // Pasta apagada por fora: o git ainda a lista ate um prune, e reaproveita-la
      // abriria o terminal no home com um worktree que nao existe.
      await this.git.pruneWorktrees(repo);
      existing = undefined;
    }
    if (existing) {
      // A copia principal nao e "um worktree do terminal": remover depois a apagaria.
      if (resolve(existing.path) === resolve(repo)) {
        throw new Error(`A branch "${branch}" esta em uso na copia principal do repositorio.`);
      }
      return { repo, path: existing.path, branch, ...base };
    }

    const path = worktreePath(repo, branch);
    await this.git.addWorktree(repo, path, branch, !(await this.git.branchExists(repo, branch)));
    return { repo, path, branch, ...base };
  }

  private serialized<T>(repo: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(repo) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.queues.set(repo, next);
    const cleanup = () => {
      if (this.queues.get(repo) === next) this.queues.delete(repo);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  async isDirty(worktree: WorktreeInfo): Promise<boolean> {
    return this.git.isDirty(worktree.path);
  }

  /**
   * Base para comparar: a gravada na criacao ou, em worktrees de versoes
   * anteriores, a branch atual da copia principal.
   */
  private async baseOf(worktree: WorktreeInfo): Promise<string | null> {
    if (worktree.base) return worktree.base;
    const branch = (await this.git.info(worktree.repo)).branch;
    return branch && branch !== worktree.branch ? branch : null;
  }

  async status(worktree: WorktreeInfo): Promise<WorktreeStatus> {
    const [changes, base] = await Promise.all([this.git.status(worktree.path), this.baseOf(worktree)]);
    const counts = base ? await this.git.aheadBehind(worktree.path, base) : null;
    return { ...changes, base: counts ? base : null, ahead: counts?.ahead ?? 0, behind: counts?.behind ?? 0 };
  }

  async diff(worktree: WorktreeInfo): Promise<WorktreeDiff> {
    return this.git.diff(worktree.path, await this.baseOf(worktree));
  }

  /**
   * Remove a pasta do worktree (a branch fica). So aceita um worktree que o git
   * conhece e que nao seja a copia principal — o pedido vem do renderer.
   */
  async remove(worktree: WorktreeInfo, force: boolean): Promise<void> {
    const entries = await this.git.listWorktrees(worktree.repo);
    const target = resolve(worktree.path);
    if (target === resolve(worktree.repo) || !entries.some((entry) => resolve(entry.path) === target)) {
      throw new Error('Esse diretorio nao e um worktree deste repositorio.');
    }
    await this.git.removeWorktree(worktree.repo, worktree.path, force);
  }
}
