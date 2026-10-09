import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { BATCH_INTERVAL_MS, OutputBatcher } from '../../main/output-batcher.js';
import type { TerminalOutput } from '../../shared/contract.js';

describe('OutputBatcher', () => {
  let delivered: TerminalOutput[][];
  let batcher: OutputBatcher;

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
    delivered = [];
    batcher = new OutputBatcher((batch) => delivered.push(batch));
  });
  afterEach(() => {
    batcher.dispose();
    mock.timers.reset();
  });

  it('agrupa os chunks da janela numa entrega so, um item por terminal', () => {
    batcher.push('a', 'x', 1);
    batcher.push('b', 'y', 1);
    batcher.push('a', 'z', 2);
    assert.equal(delivered.length, 0);
    mock.timers.tick(BATCH_INTERVAL_MS);
    assert.deepEqual(delivered, [[['a', 'xz', 2], ['b', 'y', 1]]]);
  });

  it('a janela seguinte comeca vazia', () => {
    batcher.push('a', 'x', 1);
    mock.timers.tick(BATCH_INTERVAL_MS);
    batcher.push('a', 'y', 2);
    mock.timers.tick(BATCH_INTERVAL_MS);
    assert.deepEqual(delivered, [[['a', 'x', 1]], [['a', 'y', 2]]]);
  });

  it('flush entrega na hora e cancela o timer', () => {
    batcher.push('a', 'x', 1);
    batcher.flush();
    mock.timers.tick(BATCH_INTERVAL_MS);
    assert.deepEqual(delivered, [[['a', 'x', 1]]]);
  });

  it('flush sem nada pendente nao entrega lote vazio', () => {
    batcher.flush();
    assert.deepEqual(delivered, []);
  });

  it('dispose descarta o pendente', () => {
    batcher.push('a', 'x', 1);
    batcher.dispose();
    mock.timers.tick(BATCH_INTERVAL_MS);
    assert.deepEqual(delivered, []);
  });
});
