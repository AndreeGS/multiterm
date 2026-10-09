import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { WorktreeService } from '../../application/git/worktree-service.js';
import { isValidBranchName, suggestBranch } from '../../domain/git/branch.js';
import { parseWorktreeInfo, parseWorktreeList, worktreePath } from '../../domain/git/worktree.js';
import { parseConfig } from '../../domain/workspace/config.js';
import { GitCli } from '../../infrastructure/git/git-cli.js';

describe('branch', () => {
  it('isValidBranchName barra o que o git recusaria', () => {
    for (const ok of ['feat/x', 'fix-123', 'a.b', 'user/feat/y']) assert.ok(isValidBranchName(ok), ok);
    for (const bad of ['', '-x', 'a..b', 'a b', 'a~1', 'x.lock', 'x/', '/x', 'a//b', '.x', 'a/.b', 'a@{b', 'a:b', 'x.']) {
      assert.ok(!isValidBranchName(bad), bad);
    }
  });

  it('suggestBranch faz um slug valido do nome', () => {
    assert.equal(suggestBranch('Agente Pagamentos'), 'agente-pagamentos');
    assert.equal(suggestBranch('  Ação: refatorar!! '), 'acao-refatorar');
    assert.equal(suggestBranch('feat/Login'), 'feat/login');
    assert.equal(suggestBranch('***'), '');
  });
});

describe('worktree: funcoes puras', () => {
  it('worktreePath fica ao lado do repo, com / virando -', () => {
    assert.equal(worktreePath('/home/ana/api', 'feat/x'), '/home/ana/api.worktrees/feat-x');
  });

  it('parseWorktreeList le o --porcelain', () => {
    const output = 'worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r.worktrees/x\nHEAD def\ndetached\n\n';
    assert.deepEqual(parseWorktreeList(output), [
      { path: '/r', branch: 'main' },
      { path: '/r.worktrees/x', branch: null },
    ]);
  });

  it('parseWorktreeInfo valida os tres campos', () => {
    assert.deepEqual(parseWorktreeInfo({ repo: '/r', path: '/p', branch: 'x' }), { repo: '/r', path: '/p', branch: 'x' });
    assert.equal(parseWorktreeInfo({ repo: '/r', path: '/p', branch: 'a b' }), null);
    assert.equal(parseWorktreeInfo({ repo: '/r', branch: 'x' }), null);
  });

  it('config guarda o worktree do terminal', () => {
    const config = parseConfig({ terminals: [{ cwd: '/p', worktree: { repo: '/r', path: '/p', branch: 'x' } }] });
    assert.equal(config.terminals[0]?.worktree?.branch, 'x');
  });
});

describe('WorktreeService com git de verdade', () => {
  let root: string;
  let repo: string;
  const service = new WorktreeService(new GitCli());
  const sh = (args: string[], cwd: string) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'multiterm-git-')));
    repo = join(root, 'api');
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    sh(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'inicio'], repo);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('info: repo e branch; fora de repo, nulos', async () => {
    assert.deepEqual(await service.info(repo), { repo, branch: 'main' });
    assert.deepEqual(await service.info(root), { repo: null, branch: null });
  });

  it('cria branch nova num worktree irmao; info de dentro aponta o repo principal', async () => {
    const worktree = await service.create(repo, 'feat/x');
    assert.deepEqual(worktree, { repo, path: join(root, 'api.worktrees', 'feat-x'), branch: 'feat/x' });
    assert.ok(existsSync(worktree.path));
    assert.deepEqual(await service.info(worktree.path), { repo, branch: 'feat/x' });
  });

  it('mesma branch de novo reaproveita o worktree', async () => {
    const again = await service.create(repo, 'feat/x');
    assert.equal(again.path, join(root, 'api.worktrees', 'feat-x'));
  });

  it('branch existente sem worktree e usada, nao recriada', async () => {
    sh(['branch', 'existente'], repo);
    const worktree = await service.create(repo, 'existente');
    assert.equal(sh(['branch', '--show-current'], worktree.path).trim(), 'existente');
  });

  it('recusa a branch da copia principal e nome invalido', async () => {
    await assert.rejects(service.create(repo, 'main'), /copia principal/);
    await assert.rejects(service.create(repo, 'a b'), /invalido/);
    await assert.rejects(service.create(root, 'x'), /repositorio git/);
  });

  it('remove: sujo exige force; a branch fica', async () => {
    const worktree = await service.create(repo, 'feat/y');
    writeFileSync(join(worktree.path, 'novo.txt'), 'x');
    assert.equal(await service.isDirty(worktree), true);
    await assert.rejects(service.remove(worktree, false));
    await service.remove(worktree, true);
    assert.ok(!existsSync(worktree.path));
    assert.match(sh(['branch', '--list', 'feat/y'], repo), /feat\/y/);
  });

  it('remove recusa a copia principal e pastas que nao sao worktree', async () => {
    await assert.rejects(service.remove({ repo, path: repo, branch: 'main' }, true), /nao e um worktree/);
    await assert.rejects(service.remove({ repo, path: root, branch: 'x' }, true), /nao e um worktree/);
    assert.ok(existsSync(repo));
  });
});
