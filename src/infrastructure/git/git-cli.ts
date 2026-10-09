import { execFile } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { parseWorktreeList, type Git, type GitInfo, type WorktreeEntry } from '../../domain/git/worktree.js';

const TIMEOUT_MS = 20_000;

interface Result {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * O dialogo consulta o git em qualquer diretorio digitado. `core.fsmonitor`
 * de um repo executa um comando a cada `status`; aqui ele fica desligado.
 */
const SAFE_CONFIG = ['-c', 'core.fsmonitor=false'];

/**
 * Executa o `git` da maquina. Sempre com argumentos em lista (`execFile`, sem
 * shell): nome de branch ou caminho nunca vira comando.
 */
function git(args: string[], cwd: string): Promise<Result> {
  return new Promise((resolve) => {
    execFile('git', [...SAFE_CONFIG, ...args], { cwd, timeout: TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr) }));
  });
}

async function run(args: string[], cwd: string): Promise<string> {
  const result = await git(args, cwd);
  if (!result.ok) throw new Error(result.stderr.trim() || `git ${args[0]} falhou`);
  return result.stdout;
}

export class GitCli implements Git {
  async info(cwd: string): Promise<GitInfo> {
    // O diretorio comum (.git da copia principal) identifica o repo mesmo
    // quando o cwd ja e um worktree.
    const common = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
    if (!common.ok) return { repo: null, branch: null };
    const commonDir = common.stdout.trim();
    const repo = basename(commonDir) === '.git' ? dirname(commonDir) : null;
    const branch = await git(['branch', '--show-current'], cwd);
    return { repo, branch: branch.ok && branch.stdout.trim() ? branch.stdout.trim() : null };
  }

  async branchExists(repo: string, branch: string): Promise<boolean> {
    return (await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repo)).ok;
  }

  async listWorktrees(repo: string): Promise<WorktreeEntry[]> {
    return parseWorktreeList(await run(['worktree', 'list', '--porcelain'], repo));
  }

  async addWorktree(repo: string, path: string, branch: string, create: boolean): Promise<void> {
    await run(create ? ['worktree', 'add', '-b', branch, '--', path] : ['worktree', 'add', '--', path, branch], repo);
  }

  async removeWorktree(repo: string, path: string, force: boolean): Promise<void> {
    await run(['worktree', 'remove', ...(force ? ['--force'] : []), '--', path], repo);
  }

  async isDirty(path: string): Promise<boolean> {
    return (await run(['status', '--porcelain'], path)).trim().length > 0;
  }
}
