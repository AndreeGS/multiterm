import { execFile } from 'node:child_process';
import type { PullRequests } from '../../domain/git/worktree.js';

const TIMEOUT_MS = 60_000;

/**
 * Abre PRs com o `gh` da maquina (ja autenticado pelo usuario). Sem shell, com
 * `--fill`: titulo e corpo saem dos commits da branch.
 */
export class GhCli implements PullRequests {
  create(cwd: string, base: string, branch: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('gh', ['pr', 'create', '--base', base, '--head', branch, '--fill'], {
        cwd,
        timeout: TIMEOUT_MS,
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
      }, (error, stdout, stderr) => {
        const out = `${String(stdout)}\n${String(stderr)}`;
        const url = /https:\/\/\S+\/pull\/\d+/.exec(out)?.[0];
        // PR que ja existe: o gh falha, mas diz qual e.
        if (url && (!error || /already exists/i.test(out))) {
          resolve(url);
          return;
        }
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          reject(new Error('O "gh" (GitHub CLI) nao foi encontrado no PATH. Instale e rode "gh auth login".'));
          return;
        }
        reject(new Error(String(stderr).trim() || String(stdout).trim() || 'gh pr create falhou'));
      });
    });
  }
}
