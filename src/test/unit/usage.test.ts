import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateCost, normalizeModel, priceOf } from '../../domain/usage/pricing.js';
import { addTotals, emptyTotals, totalTokens } from '../../domain/usage/types.js';

const zero = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };

describe('precos', () => {
  it('normalizeModel tira variante e snapshot datado', () => {
    assert.equal(normalizeModel('claude-opus-5-5[1m]'), 'claude-opus-5-5');
    assert.equal(normalizeModel('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
  });

  it('modelo desconhecido nao tem preco e custa 0', () => {
    assert.equal(priceOf('gpt-qualquer'), null);
    assert.equal(estimateCost('gpt-qualquer', { ...zero, input: 1_000_000 }), 0);
  });

  it('custo soma cada tipo de token pela sua taxa', () => {
    const rate = priceOf('claude-sonnet-4-6')!;
    const cost = estimateCost('claude-sonnet-4-6', {
      input: 1_000_000,
      output: 1_000_000,
      cacheWrite5m: 1_000_000,
      cacheWrite1h: 1_000_000,
      cacheRead: 1_000_000,
    });
    const expected = rate.input + rate.output + rate.cacheWrite5m + rate.cacheWrite1h + rate.cacheRead;
    assert.ok(Math.abs(cost - expected) < 1e-9);
  });
});

describe('totais', () => {
  it('addTotals acumula e totalTokens soma os quatro tipos', () => {
    const total = emptyTotals();
    addTotals(total, { inputTokens: 1, outputTokens: 2, cacheWriteTokens: 3, cacheReadTokens: 4, costUsd: 0.5, requests: 1 });
    addTotals(total, { inputTokens: 1, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0.25, requests: 1 });
    assert.equal(total.requests, 2);
    assert.equal(total.costUsd, 0.75);
    assert.equal(totalTokens(total), 11);
  });
});
