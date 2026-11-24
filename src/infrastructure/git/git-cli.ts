import { execFile } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { truncateDiff } from '../../domain/git/diff.js';
import {
  parseAheadBehind,
  parseStatus,
  parseWorktreeList,
  type Git,
  type GitInfo,
  type MergeResult,
  type WorktreeChanges,
  type WorktreeDiff,
  type WorktreeEntry,
} from '../../domain/git/worktree.js';

const TIMEOUT_MS = 20_000;
/** Commit e merge rodam hooks do repo e podem pedir a senha da chave GPG. */
const COMMIT_TIMEOUT_MS = 3 * 60_000;
const PUSH_TIMEOUT_MS = 2 * 60_000;
/** Checkout de repo grande (ou com LFS, hooks) passa facil de 20s; matar no meio deixa um worktree pela metade. */
const ADD_TIMEOUT_MS = 5 * 60_000;
/** Diff maior que isto e cortado: a janela nao precisa de megabytes de lockfile. */
const MAX_DIFF_CHARS = 4_000_000;
/** Arquivos novos entram no diff um a um; acima disto, ficam de fora (e o diff e marcado como cortado). */
const MAX_UNTRACKED_IN_DIFF = 50;
/**
 * Opcoes do `git diff`: sem programa externo de diff nem textconv (configs do
 * repo que executariam comandos) e com prefixos fixos, qualquer que seja a
 * config do usuario (`diff.noprefix`), porque o parser conta com eles.
 */
const DIFF_ARGS = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/'];

interface Result {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  /** Saida passou de `maxBuffer`: `stdout` e so o comeco. */
  readonly overflow: boolean;
}

interface Options {
  readonly timeout?: number;
  readonly maxBuffer?: number;
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
function git(args: string[], cwd: string, { timeout = TIMEOUT_MS, maxBuffer }: Options = {}): Promise<Result> {
  return new Promise((resolve) => {
    execFile('git', [...SAFE_CONFIG, ...args], { cwd, timeout, maxBuffer, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout, stderr) => resolve({
        ok: !error,
        stdout: String(stdout),
        stderr: String(stderr),
        overflow: (error as NodeJS.ErrnoException | null)?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      }));
  });
}

async function run(args: string[], cwd: string, timeout = TIMEOUT_MS): Promise<string> {
  const result = await git(args, cwd, { timeout });
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
    const args = create ? ['worktree', 'add', '-b', branch, '--', path] : ['worktree', 'add', '--', path, branch];
    await run(args, repo, ADD_TIMEOUT_MS);
  }

  async pruneWorktrees(repo: string): Promise<void> {
    await run(['worktree', 'prune'], repo);
  }

  async removeWorktree(repo: string, path: string, force: boolean): Promise<void> {
    await run(['worktree', 'remove', ...(force ? ['--force'] : []), '--', path], repo);
  }

  async isDirty(path: string): Promise<boolean> {
    return (await run(['status', '--porcelain'], path)).trim().length > 0;
  }

  async status(path: string): Promise<WorktreeChanges> {
    // Consulta periodica: sem lock opcional, para nao disputar o index com o agente.
    return parseStatus(await run(['--no-optional-locks', 'status', '--porcelain=v2'], path));
  }

  async aheadBehind(path: string, base: string): Promise<{ ahead: number; behind: number } | null> {
    const result = await git(['rev-list', '--left-right', '--count', `refs/heads/${base}...HEAD`], path);
    return result.ok ? parseAheadBehind(result.stdout) : null;
  }

  async diff(path: string, base: string | null): Promise<WorktreeDiff> {
    // Desde o ponto em que a branch saiu da base: os commits do worktree mais o
    // que ainda nao foi commitado, sem o que a base andou depois.
    let from = 'HEAD';
    if (base) {
      const mergeBase = await git(['merge-base', `refs/heads/${base}`, 'HEAD'], path);
      if (mergeBase.ok && mergeBase.stdout.trim()) from = mergeBase.stdout.trim();
      else base = null;
    }
    const tracked = await git([...DIFF_ARGS, '-M', from, '--'], path, { maxBuffer: MAX_DIFF_CHARS * 2 });
    if (!tracked.ok && !tracked.overflow) throw new Error(tracked.stderr.trim() || 'git diff falhou');
    let text = tracked.stdout;
    let truncated = tracked.overflow;

    // `git diff` nao mostra arquivos novos; cada um vira um diff contra o vazio.
    const untracked = (await run(['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z'], path))
      .split('\0').filter(Boolean);
    if (untracked.length > MAX_UNTRACKED_IN_DIFF) truncated = true;
    for (const file of untracked.slice(0, MAX_UNTRACKED_IN_DIFF)) {
      if (text.length > MAX_DIFF_CHARS) break;
      // Sai com 1 quando ha diferenca, que e sempre: vale o stdout.
      const added = await git([...DIFF_ARGS, '--no-index', '--', '/dev/null', file], path, { maxBuffer: MAX_DIFF_CHARS });
      text += added.stdout;
      if (added.overflow) truncated = true;
    }

    const cut = truncateDiff(text, MAX_DIFF_CHARS);
    return { text: cut.text, base, truncated: truncated || cut.truncated };
  }

  async commitAll(path: string, message: string): Promise<void> {
    await run(['add', '-A'], path);
    const result = await git(['commit', '-m', message], path, { timeout: COMMIT_TIMEOUT_MS });
    if (result.ok) return;
    const output = `${result.stdout}\n${result.stderr}`;
    if (/nothing (added )?to commit|nada (adicionado )?para (submeter|commit)/i.test(output)) throw new Error('Nada para commitar.');
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'git commit falhou');
  }

  async merge(repo: string, branch: string, base: string): Promise<MergeResult> {
    const current = (await git(['branch', '--show-current'], repo)).stdout.trim();
    if (current !== base) {
      throw new Error(`A copia principal esta em "${current || 'HEAD solto'}", nao em "${base}". Troque para "${base}" e tente de novo.`);
    }
    // Arquivos novos soltos nao impedem (o git recusa sozinho se um seria sobrescrito).
    if ((await run(['status', '--porcelain', '--untracked-files=no'], repo)).trim()) {
      throw new Error(`A copia principal tem mudancas nao commitadas em "${base}". Commite ou guarde (stash) antes de mesclar.`);
    }
    const before = (await run(['rev-parse', 'HEAD'], repo)).trim();
    const result = await git(['merge', '--no-edit', `refs/heads/${branch}`], repo, { timeout: COMMIT_TIMEOUT_MS });
    if (!result.ok) {
      // Conflito (ou hook que recusou): a copia principal volta como estava.
      await git(['merge', '--abort'], repo);
      const conflict = /conflict|conflito/i.test(`${result.stdout}\n${result.stderr}`);
      throw new Error(conflict
        ? `"${branch}" conflita com "${base}". Nada foi mesclado: resolva no worktree (ex.: git merge ${base}) e tente de novo.`
        : result.stderr.trim() || result.stdout.trim() || 'git merge falhou');
    }
    const head = (await run(['rev-parse', 'HEAD'], repo)).trim();
    if (head === before) return 'up-to-date';
    const parents = (await run(['rev-list', '--parents', '-n', '1', 'HEAD'], repo)).trim().split(/\s+/).length - 1;
    return parents > 1 ? 'merge' : 'fast-forward';
  }

  async push(path: string, branch: string): Promise<void> {
    const remotes = (await run(['remote'], path)).split('\n').map((line) => line.trim());
    if (!remotes.includes('origin')) throw new Error('O repositorio nao tem um remote "origin".');
    await run(['push', '-u', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], path, PUSH_TIMEOUT_MS);
  }
}
