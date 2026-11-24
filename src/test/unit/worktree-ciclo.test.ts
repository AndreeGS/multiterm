import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { WorktreeService } from '../../application/git/worktree-service.js';
import { cleanCommitMessage, suggestCommitMessage, type PullRequests } from '../../domain/git/worktree.js';
import { GitCli } from '../../infrastructure/git/git-cli.js';

describe('mensagem de commit', () => {
  it('sugestao a partir da branch', () => {
    assert.equal(suggestCommitMessage('feat/login-oauth'), 'feat: login oauth');
    assert.equal(suggestCommitMessage('corrige_bug'), 'corrige bug');
    assert.equal(suggestCommitMessage('Equipe/x-y'), 'x y');
  });
  it('limpeza: sem vazio, sem controle, CRLF vira LF', () => {
    assert.equal(cleanCommitMessage('  ola\r\n\r\ncorpo  '), 'ola\n\ncorpo');
    assert.equal(cleanCommitMessage('   '), null);
    assert.equal(cleanCommitMessage('a\x1b[31m'), null);
    assert.equal(cleanCommitMessage(42), null);
  });
});

describe('fechar o ciclo do worktree (git de verdade)', () => {
  let root: string;
  let repo: string;
  const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM };
  const prs: Array<[string, string, string]> = [];
  const pulls: PullRequests = { create: async (cwd, base, branch) => (prs.push([cwd, base, branch]), 'https://example.test/pull/1') };
  const service = new WorktreeService(new GitCli(), pulls);
  const sh = (args: string[], cwd: string) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'multiterm-ciclo-')));
    // Config propria: sem assinatura GPG nem hooks do usuario, com identidade.
    const config = join(root, 'gitconfig');
    writeFileSync(config, '[user]\n\temail = t@t\n\tname = t\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n');
    process.env.GIT_CONFIG_GLOBAL = config;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    repo = join(root, 'api');
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    writeFileSync(join(repo, 'a.txt'), 'um\n');
    sh(['add', '.'], repo);
    sh(['commit', '-q', '-m', 'inicio'], repo);
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
    if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved.global;
    if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem;
  });

  it('commita tudo (inclusive arquivo novo); sem nada, avisa', async () => {
    const wt = await service.create(repo, 'feat/um');
    writeFileSync(join(wt.path, 'novo.txt'), 'x\n');
    await service.commit(wt, 'feat: novo');
    assert.equal(sh(['log', '-1', '--format=%s'], wt.path), 'feat: novo');
    assert.equal(sh(['status', '--porcelain'], wt.path), '');
    await assert.rejects(service.commit(wt, 'de novo'), /Nada para commitar/);
  });

  it('mescla na base: fast-forward, depois "ja tinha tudo"', async () => {
    const wt = await service.create(repo, 'feat/um');
    assert.deepEqual(await service.mergeIntoBase(wt), { base: 'main', result: 'fast-forward' });
    assert.equal(sh(['log', '-1', '--format=%s'], repo), 'feat: novo');
    assert.deepEqual(await service.mergeIntoBase(wt), { base: 'main', result: 'up-to-date' });
  });

  it('base que andou: commit de merge', async () => {
    const wt = await service.create(repo, 'feat/dois');
    writeFileSync(join(wt.path, 'b.txt'), 'b\n');
    await service.commit(wt, 'b');
    writeFileSync(join(repo, 'c.txt'), 'c\n');
    sh(['add', '.'], repo);
    sh(['commit', '-q', '-m', 'c na main'], repo);
    assert.deepEqual(await service.mergeIntoBase(wt), { base: 'main', result: 'merge' });
  });

  it('conflito: nada muda na copia principal', async () => {
    const wt = await service.create(repo, 'feat/conflito');
    writeFileSync(join(wt.path, 'a.txt'), 'do worktree\n');
    await service.commit(wt, 'muda a');
    writeFileSync(join(repo, 'a.txt'), 'da main\n');
    sh(['commit', '-q', '-am', 'muda a na main'], repo);
    const head = sh(['rev-parse', 'HEAD'], repo);
    await assert.rejects(service.mergeIntoBase(wt), /conflita com "main"/);
    assert.equal(sh(['rev-parse', 'HEAD'], repo), head);
    assert.equal(sh(['status', '--porcelain'], repo), '');
  });

  it('recusa: worktree sujo, copia principal suja ou em outra branch', async () => {
    const wt = await service.create(repo, 'feat/tres');
    writeFileSync(join(wt.path, 'sujo.txt'), 'x\n');
    await assert.rejects(service.mergeIntoBase(wt), /nao commitadas: commite antes de mesclar/);
    await assert.rejects(service.openPullRequest(wt), /commite antes de abrir o PR/);
    await service.commit(wt, 'tres');
    writeFileSync(join(repo, 'a.txt'), 'mexido\n');
    await assert.rejects(service.mergeIntoBase(wt), /copia principal tem mudancas/);
    sh(['checkout', '-q', '--', 'a.txt'], repo);
    sh(['checkout', '-q', '-b', 'outra'], repo);
    await assert.rejects(service.mergeIntoBase(wt), /esta em "outra", nao em "main"/);
    sh(['checkout', '-q', 'main'], repo);
  });

  it('PR: envia a branch ao origin e abre contra a base', async () => {
    const wt = await service.create(repo, 'feat/tres');
    await assert.rejects(service.openPullRequest(wt), /remote "origin"/);
    const remote = join(root, 'remoto.git');
    execFileSync('git', ['init', '-q', '--bare', remote]);
    sh(['remote', 'add', 'origin', remote], repo);
    assert.equal(await service.openPullRequest(wt), 'https://example.test/pull/1');
    assert.deepEqual(prs, [[wt.path, 'main', 'feat/tres']]);
    assert.ok(sh(['branch', '--list', 'feat/tres'], remote).includes('feat/tres'));
  });
});
