import { estimateCost, normalizeModel } from './pricing.js';
import type { UsageTotals } from './types.js';

/** Uma resposta do modelo registrada numa transcricao do Claude Code. */
export interface UsageRecord {
  /** Identifica a resposta para nao contar duas vezes (`message.id:requestId`); `null` se faltar. */
  readonly key: string | null;
  /** Dia local, YYYY-MM-DD. */
  readonly day: string;
  readonly model: string;
  /** Conversa a que pertence (subagentes trazem a da conversa principal). */
  readonly sessionId: string | null;
  readonly totals: UsageTotals;
}

/**
 * Le uma linha `.jsonl` de transcricao. So linhas `assistant` com `usage`
 * contam; qualquer outra coisa (ou JSON quebrado) devolve `null`.
 */
export function parseUsageLine(line: string): UsageRecord | null {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof record !== 'object' || record === null || record.type !== 'assistant') return null;

  const message = record.message as Record<string, unknown> | undefined;
  const usage = message?.usage as Record<string, unknown> | undefined;
  if (!usage) return null;

  const day = dayKey(String(record.timestamp ?? ''));
  if (!day) return null;

  const messageId = String(message?.id ?? '');
  const requestId = String(record.requestId ?? '');
  const model = normalizeModel(String(message?.model ?? 'desconhecido'));

  const cacheDetail = usage.cache_creation as Record<string, unknown> | undefined;
  const write1h = num(cacheDetail?.ephemeral_1h_input_tokens);
  const writeTotal = num(usage.cache_creation_input_tokens);
  const write5m = Math.max(0, writeTotal - write1h);
  const cacheRead = num(usage.cache_read_input_tokens);
  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);

  return {
    key: messageId || requestId ? `${messageId}:${requestId}` : null,
    day,
    model,
    sessionId: typeof record.sessionId === 'string' && record.sessionId ? record.sessionId : null,
    totals: {
      inputTokens: input,
      outputTokens: output,
      cacheWriteTokens: writeTotal,
      cacheReadTokens: cacheRead,
      costUsd: estimateCost(model, { input, output, cacheWrite5m: write5m, cacheWrite1h: write1h, cacheRead }),
      requests: 1,
    },
  };
}

/** Dia local (nao UTC): "hoje" deve bater com o relogio de quem olha a barra. */
export function dayKeyFromDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayKey(timestamp: string): string | null {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : dayKeyFromDate(date);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
