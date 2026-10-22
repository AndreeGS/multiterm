import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { WorktreeService } from '../../application/git/worktree-service.js';
import { isValidBranchName, suggestBranch } from '../../domain/git/branch.js';
import { parseUnifiedDiff, truncateDiff } from '../../domain/git/diff.js';
import {
  describeStatus,
  formatStatus,
  parseAheadBehind,
  parseStatus,
  parseWorktreeInfo,
  parseWorktreeList,
} from '../../domain/git/worktree.js';
import { worktreePath } from '../../domain/git/worktree-path.js';
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

  it('parseWorktreeInfo guarda a base; base invalida (ou igual a branch) e ignorada', () => {
    assert.deepEqual(parseWorktreeInfo({ repo: '/r', path: '/p', branch: 'x', base: 'main' }), { repo: '/r', path: '/p', branch: 'x', base: 'main' });
    assert.deepEqual(parseWorktreeInfo({ repo: '/r', path: '/p', branch: 'x', base: 'a b' }), { repo: '/r', path: '/p', branch: 'x' });
    assert.deepEqual(parseWorktreeInfo({ repo: '/r', path: '/p', branch: 'x', base: 'x' }), { repo: '/r', path: '/p', branch: 'x' });
  });

  it('parseStatus conta alterados, novos e conflitos do --porcelain=v2', () => {
    const output = [
      '# branch.oid abc',
      '1 .M N... 100644 100644 100644 a a src/a.ts',
      '1 M. N... 100644 100644 100644 b b src/b.ts',
      '2 R. N... 100644 100644 100644 c c R100 novo.ts\tvelho.ts',
      'u UU N... 100644 100644 100644 100644 d d d src/c.ts',
      '? notas.md',
      '? tmp/',
      '',
    ].join('\n');
    assert.deepEqual(parseStatus(output), { changed: 3, untracked: 2, conflicts: 1 });
    assert.deepEqual(parseStatus(''), { changed: 0, untracked: 0, conflicts: 0 });
  });

  it('parseAheadBehind le "atras<tab>frente"', () => {
    assert.deepEqual(parseAheadBehind('2\t5\n'), { behind: 2, ahead: 5 });
    assert.equal(parseAheadBehind('fatal: x'), null);
  });

  it('formatStatus e describeStatus', () => {
    const status = { changed: 3, untracked: 2, conflicts: 0, base: 'main', ahead: 1, behind: 0 };
    assert.equal(formatStatus(status), '+2 ~3 ↑1');
    assert.equal(formatStatus({ ...status, changed: 0, untracked: 0, ahead: 0 }), '');
    assert.equal(describeStatus(status), '3 arquivos alterados\n2 arquivos novos\n1 commit a frente de main');
    assert.equal(describeStatus({ ...status, changed: 0, untracked: 0, ahead: 0 }), 'Nada por commitar\nIgual a main');
  });
});

describe('diff unificado', () => {
  const raw = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 1..2 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,3 +1,3 @@',
    ' linha',
    '--- comecava com dois tracos',
    '+nova',
    '\\ No newline at end of file',
    'diff --git a/novo arquivo.md b/novo arquivo.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/novo arquivo.md',
    '@@ -0,0 +1 @@',
    '+ola',
    'diff --git a/velho.ts b/novo.ts',
    'similarity index 100%',
    'rename from velho.ts',
    'rename to novo.ts',
    'diff --git a/apagado.ts b/apagado.ts',
    'deleted file mode 100644',
    '--- a/apagado.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-tchau',
    'diff --git a/logo.png b/logo.png',
    'Binary files a/logo.png and b/logo.png differ',
    '',
  ].join('\n');

  it('separa arquivos, tipo de mudanca e linhas', () => {
    const files = parseUnifiedDiff(raw);
    assert.deepEqual(files.map((f) => [f.path, f.change, f.additions, f.deletions, f.binary]), [
      ['src/app.ts', 'modified', 1, 1, false],
      ['novo arquivo.md', 'added', 1, 0, false],
      ['novo.ts', 'renamed', 0, 0, false],
      ['apagado.ts', 'deleted', 0, 1, false],
      ['logo.png', 'modified', 0, 0, true],
    ]);
    assert.equal(files[2]?.oldPath, 'velho.ts');
    assert.deepEqual(files[0]?.lines.map((l) => l.kind), ['hunk', 'ctx', 'del', 'add', 'note']);
    assert.equal(files[0]?.lines[2]?.text, '-- comecava com dois tracos');
  });

  it('caminho entre aspas (caracteres especiais)', () => {
    const files = parseUnifiedDiff('diff --git "a/tab\\there" "b/tab\\there"\n--- "a/tab\\there"\n+++ "b/tab\\there"\n@@ -1 +1 @@\n-a\n+b\n');
    assert.equal(files[0]?.path, 'tab\there');
  });

  it('truncateDiff corta numa quebra de linha', () => {
    assert.deepEqual(truncateDiff('aaa\nbbb\nccc', 6), { text: 'aaa', truncated: true });
    assert.deepEqual(truncateDiff('curto', 10), { text: 'curto', truncated: false });
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
    sh(['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'inicio'], repo);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('info: repo e branch; fora de repo, nulos', async () => {
    assert.deepEqual(await service.info(repo), { repo, branch: 'main' });
    assert.deepEqual(await service.info(root), { repo: null, branch: null });
  });

  it('cria branch nova num worktree irmao; info de dentro aponta o repo principal', async () => {
    const worktree = await service.create(repo, 'feat/x');
    assert.deepEqual(worktree, { repo, path: join(root, 'api.worktrees', 'feat-x'), branch: 'feat/x', base: 'main' });
    assert.ok(existsSync(worktree.path));
    assert.deepEqual(await service.info(worktree.path), { repo, branch: 'feat/x' });
  });

  it('mesma branch de novo reaproveita o worktree', async () => {
    const again = await service.create(repo, 'feat/x');
    assert.equal(again.path, join(root, 'api.worktrees', 'feat-x'));
  });

  it('worktree apagado por fora e recriado, nao reaproveitado', async () => {
    const worktree = await service.create(repo, 'feat/sumiu');
    rmSync(worktree.path, { recursive: true, force: true });
    const again = await service.create(repo, 'feat/sumiu');
    assert.equal(again.path, worktree.path);
    assert.ok(existsSync(again.path));
    assert.equal(sh(['branch', '--show-current'], again.path).trim(), 'feat/sumiu');
  });

  it('dois pedidos juntos para a mesma branch nova chegam no mesmo worktree', async () => {
    const [a, b] = await Promise.all([service.create(repo, 'feat/duplo'), service.create(repo, 'feat/duplo')]);
    assert.equal(a.path, b.path);
    assert.ok(existsSync(a.path));
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

  it('status: novos, alterados e commits a frente da base', async () => {
    const worktree = await service.create(repo, 'feat/status');
    assert.equal(worktree.base, 'main');
    assert.deepEqual(await service.status(worktree), { changed: 0, untracked: 0, conflicts: 0, base: 'main', ahead: 0, behind: 0 });
    writeFileSync(join(worktree.path, 'a.txt'), 'um\n');
    sh(['add', 'a.txt'], worktree.path);
    sh(['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'a'], worktree.path);
    writeFileSync(join(worktree.path, 'a.txt'), 'um\ndois\n');
    writeFileSync(join(worktree.path, 'b.txt'), 'novo\n');
    assert.deepEqual(await service.status(worktree), { changed: 1, untracked: 1, conflicts: 0, base: 'main', ahead: 1, behind: 0 });
    // Worktree salvo antes da base existir: compara com a branch atual da copia principal.
    const { base: _base, ...legacy } = worktree;
    assert.equal((await service.status(legacy)).base, 'main');
  });

  it('diff: commits desde a base, o nao commitado e os arquivos novos', async () => {
    const worktree = await service.create(repo, 'feat/status');
    const diff = await service.diff(worktree);
    assert.equal(diff.base, 'main');
    assert.equal(diff.truncated, false);
    const files = parseUnifiedDiff(diff.text);
    assert.deepEqual(files.map((f) => [f.path, f.change, f.additions]), [['a.txt', 'added', 2], ['b.txt', 'added', 1]]);
    unlinkSync(join(worktree.path, 'b.txt'));
  });

  it('diff sem base: so o nao commitado', async () => {
    const worktree = await service.create(repo, 'feat/status');
    writeFileSync(join(worktree.path, 'a.txt'), 'um\ndois\ntres\n');
    const diff = await service.diff({ ...worktree, base: 'nao-existe' });
    assert.equal(diff.base, null);
    assert.deepEqual(parseUnifiedDiff(diff.text).map((f) => [f.path, f.change, f.additions, f.deletions]), [['a.txt', 'modified', 2, 0]]);
  });

  it('remove recusa a copia principal e pastas que nao sao worktree', async () => {
    await assert.rejects(service.remove({ repo, path: repo, branch: 'main' }, true), /nao e um worktree/);
    await assert.rejects(service.remove({ repo, path: root, branch: 'x' }, true), /nao e um worktree/);
    assert.ok(existsSync(repo));
  });
});
