import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FlowControl, HIGH_WATERMARK, LOW_WATERMARK } from '../../main/flow-control.js';

describe('controle de fluxo do output', () => {
  it('pausa uma vez ao passar do limite e retoma abaixo do minimo', () => {
    const flow = new FlowControl();
    assert.equal(flow.sent('a', HIGH_WATERMARK - 1), false);
    assert.equal(flow.sent('a', 1), true);
    assert.equal(flow.sent('a', 1000), false, 'ja pausado: nao pausa de novo');
    assert.equal(flow.isPaused('a'), true);
    assert.equal(flow.acked('a', HIGH_WATERMARK - LOW_WATERMARK), false, 'ainda acima do minimo');
    assert.equal(flow.acked('a', 1000), true);
    assert.equal(flow.isPaused('a'), false);
  });

  it('cada terminal tem a sua conta', () => {
    const flow = new FlowControl();
    flow.sent('a', HIGH_WATERMARK);
    assert.equal(flow.sent('b', 10), false);
    assert.equal(flow.isPaused('b'), false);
  });

  it('confirmacao a mais nao deixa saldo negativo', () => {
    const flow = new FlowControl();
    flow.acked('a', 5000);
    assert.equal(flow.sent('a', HIGH_WATERMARK - 1), false);
  });

  it('reset devolve os pausados e zera tudo', () => {
    const flow = new FlowControl();
    flow.sent('a', HIGH_WATERMARK);
    flow.sent('b', 10);
    assert.deepEqual(flow.reset(), ['a']);
    assert.equal(flow.isPaused('a'), false);
    assert.equal(flow.sent('a', HIGH_WATERMARK - 1), false);
  });
});
