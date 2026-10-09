import { resolve } from 'node:path';
import { isValidBranchName } from '../../domain/git/branch.js';
import { worktreePath, type Git, type GitInfo, type WorktreeInfo } from '../../domain/git/worktree.js';

/**
 * Caso de uso: worktrees por terminal. Cria a pasta isolada antes do terminal
 * abrir e remove quando voce decide, sem nunca apagar a branch.
 */
export class WorktreeService {
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

    const existing = (await this.git.listWorktrees(repo)).find((entry) => entry.branch === branch);
    if (existing) {
      // A copia principal nao e "um worktree do terminal": remover depois a apagaria.
      if (resolve(existing.path) === resolve(repo)) {
        throw new Error(`A branch "${branch}" esta em uso na copia principal do repositorio.`);
      }
      return { repo, path: existing.path, branch };
    }

    const path = worktreePath(repo, branch);
    await this.git.addWorktree(repo, path, branch, !(await this.git.branchExists(repo, branch)));
    return { repo, path, branch };
  }

  async isDirty(worktree: WorktreeInfo): Promise<boolean> {
    return this.git.isDirty(worktree.path);
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
