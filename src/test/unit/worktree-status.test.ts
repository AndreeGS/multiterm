import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WorktreeStatusService } from '../../application/git/worktree-status-service.js';
import type { WorktreeInfo, WorktreeStatus } from '../../domain/git/worktree.js';
import type { TerminalSnapshot, TerminalStatus } from '../../domain/terminal/types.js';

const WORKTREE: WorktreeInfo = { repo: '/r', path: '/r.worktrees/x', branch: 'x', base: 'main' };
const CLEAN: WorktreeStatus = { changed: 0, untracked: 0, conflicts: 0, base: 'main', ahead: 0, behind: 0 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function snapshot(id: string, status: TerminalStatus, worktree: WorktreeInfo | null = WORKTREE): TerminalSnapshot {
  return {
    id, name: id, cwd: worktree?.path ?? '/', shell: 'bash', command: null, color: null, claudeSession: null,
    worktree, workspaceId: 'w', status, exitCode: null, createdAt: 0, needsAttention: false, notice: null,
  };
}

function setup(results: Array<WorktreeStatus | Error> = []) {
  let calls = 0;
  const sent: Array<[string, WorktreeStatus | null]> = [];
  const service = new WorktreeStatusService(
    {
      status: async () => {
        calls++;
        await sleep(5); // o git real leva um tempo: consultas juntas se sobrepoem
        const next = results.shift() ?? CLEAN;
        if (next instanceof Error) throw next;
        return next;
      },
    },
    (id, status) => sent.push([id, status]),
    { intervalMs: 60_000, debounceMs: 10 },
  );
  return { service, sent, calls: () => calls };
}

describe('status dos worktrees', () => {
  it('consulta ao ver o terminal e ao ele parar de rodar; so manda o que mudou', async () => {
    const { service, sent, calls } = setup([CLEAN, CLEAN, { ...CLEAN, changed: 2 }]);
    service.observe(snapshot('t', 'starting'));
    await sleep(30);
    assert.deepEqual(sent, [['t', CLEAN]]);

    service.observe(snapshot('t', 'running'));
    service.observe(snapshot('t', 'idle'));
    await sleep(30);
    assert.equal(calls(), 2);
    assert.equal(sent.length, 1, 'igual ao anterior: nao manda de novo');

    service.observe(snapshot('t', 'running'));
    service.observe(snapshot('t', 'idle'));
    await sleep(30);
    assert.deepEqual(sent[1], ['t', { ...CLEAN, changed: 2 }]);
  });

  it('idle -> idle (so atencao mudando) nao consulta', async () => {
    const { service, calls } = setup();
    service.observe(snapshot('t', 'idle'));
    await sleep(30);
    service.observe(snapshot('t', 'idle'));
    service.observe(snapshot('t', 'idle'));
    await sleep(30);
    assert.equal(calls(), 1);
  });

  it('request manda mesmo sem mudanca (janela recarregada)', async () => {
    const { service, sent } = setup();
    service.observe(snapshot('t', 'idle'));
    await sleep(30);
    service.request('t');
    await sleep(30);
    assert.equal(sent.length, 2);
  });

  it('erro do git vira null; terminal sem worktree ou fechado nao consulta', async () => {
    const { service, sent, calls } = setup([new Error('pasta sumiu')]);
    service.observe(snapshot('t', 'idle'));
    service.observe(snapshot('sem', 'idle', null));
    await sleep(30);
    assert.deepEqual(sent, [['t', null]]);
    service.observe(snapshot('u', 'idle'));
    service.forget('u');
    await sleep(30);
    assert.equal(calls(), 1);
  });

  it('dois terminais no mesmo worktree dividem a consulta', async () => {
    const { service, sent, calls } = setup();
    service.observe(snapshot('a', 'idle'));
    service.observe(snapshot('b', 'idle'));
    await sleep(30);
    assert.equal(calls(), 1);
    assert.deepEqual(sent.map(([id]) => id).sort(), ['a', 'b']);
  });
});
