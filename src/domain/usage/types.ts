export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** Custo estimado em USD a partir da tabela de precos publica. */
  costUsd: number;
  requests: number;
}

export interface ModelBreakdown {
  readonly model: string;
  readonly totals: UsageTotals;
}

export interface UsageSummary {
  readonly today: UsageTotals;
  /** Ultimos 7 dias, incluindo hoje. */
  readonly week: UsageTotals;
  readonly todayByModel: ModelBreakdown[];
  readonly weekByModel: ModelBreakdown[];
  /** Modelos sem preco na tabela — contam tokens, mas nao custo. */
  readonly unpricedModels: string[];
  readonly updatedAt: number;
  /** false quando nao ha transcricoes do Claude Code nesta maquina. */
  readonly available: boolean;
}

export function emptyTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    requests: 0,
  };
}

export function addTotals(target: UsageTotals, delta: UsageTotals): void {
  target.inputTokens += delta.inputTokens;
  target.outputTokens += delta.outputTokens;
  target.cacheWriteTokens += delta.cacheWriteTokens;
  target.cacheReadTokens += delta.cacheReadTokens;
  target.costUsd += delta.costUsd;
  target.requests += delta.requests;
}

/** Soma de tudo que passou pelo modelo, para exibir "tokens" em um numero so. */
export function totalTokens(totals: UsageTotals): number {
  return (
    totals.inputTokens + totals.outputTokens + totals.cacheWriteTokens + totals.cacheReadTokens
  );
}

export function emptySummary(available = false): UsageSummary {
  return {
    today: emptyTotals(),
    week: emptyTotals(),
    todayByModel: [],
    weekByModel: [],
    unpricedModels: [],
    updatedAt: Date.now(),
    available,
  };
}
