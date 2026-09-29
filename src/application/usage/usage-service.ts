import {
  addTotals,
  emptySummary,
  emptyTotals,
  type ModelBreakdown,
  type UsageSummary,
  type UsageTotals,
} from '../../domain/usage/types.js';
import {
  ClaudeTranscriptReader,
  dayKeyFromDate,
  type DailyUsage,
} from '../../infrastructure/usage/claude-transcript-reader.js';

const REFRESH_INTERVAL_MS = 60_000;
const WEEK_DAYS = 7;

/**
 * Caso de uso: manter um resumo atualizado do consumo local de tokens.
 *
 * Importante: isto e *consumo*, nao percentual do limite do plano. O limite
 * semanal/diario nao existe em nenhum arquivo local — vem do servidor.
 */
export class UsageService {
  private summary: UsageSummary = emptySummary();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly reader = new ClaudeTranscriptReader(),
    private readonly onUpdate: (summary: UsageSummary) => void = () => {},
  ) {}

  current(): UsageSummary {
    return this.summary;
  }

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<UsageSummary> {
    if (this.running) return this.summary;
    this.running = true;
    try {
      if (!(await this.reader.exists())) {
        this.summary = emptySummary(false);
      } else {
        const daily = await this.reader.refresh();
        this.summary = summarize(daily, this.reader.unpricedModels);
      }
      this.onUpdate(this.summary);
    } catch (error) {
      console.error('[usage] falha ao ler transcricoes:', error);
    } finally {
      this.running = false;
    }
    return this.summary;
  }
}

function summarize(daily: DailyUsage, unpricedModels: string[]): UsageSummary {
  const today = dayKeyFromDate(new Date());
  const weekDays = new Set<string>();
  for (let i = 0; i < WEEK_DAYS; i += 1) {
    weekDays.add(dayKeyFromDate(new Date(Date.now() - i * 24 * 60 * 60 * 1000)));
  }

  const todayByModel = new Map<string, UsageTotals>();
  const weekByModel = new Map<string, UsageTotals>();

  for (const [day, models] of daily) {
    if (!weekDays.has(day)) continue;
    for (const [model, totals] of models) {
      accumulate(weekByModel, model, totals);
      if (day === today) accumulate(todayByModel, model, totals);
    }
  }

  return {
    today: sum(todayByModel),
    week: sum(weekByModel),
    todayByModel: rank(todayByModel),
    weekByModel: rank(weekByModel),
    unpricedModels,
    updatedAt: Date.now(),
    available: true,
  };
}

function accumulate(target: Map<string, UsageTotals>, model: string, delta: UsageTotals): void {
  const current = target.get(model) ?? emptyTotals();
  addTotals(current, delta);
  target.set(model, current);
}

function sum(byModel: Map<string, UsageTotals>): UsageTotals {
  const totals = emptyTotals();
  for (const value of byModel.values()) addTotals(totals, value);
  return totals;
}

/** Mais caro primeiro — e o que interessa ler primeiro no tooltip. */
function rank(byModel: Map<string, UsageTotals>): ModelBreakdown[] {
  return [...byModel.entries()]
    .map(([model, totals]) => ({ model, totals }))
    .sort((a, b) => b.totals.costUsd - a.totals.costUsd);
}
