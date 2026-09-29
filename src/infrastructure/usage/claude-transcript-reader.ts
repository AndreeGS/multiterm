import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { estimateCost, normalizeModel, priceOf } from '../../domain/usage/pricing.js';
import { addTotals, emptyTotals, type UsageTotals } from '../../domain/usage/types.js';

/** Totais de um dia (chave local YYYY-MM-DD), por modelo. */
export type DailyUsage = Map<string, Map<string, UsageTotals>>;

interface FileCursor {
  /** Byte lido ate agora; transcricoes so crescem no fim. */
  offset: number;
}

const DAYS_KEPT = 8;

/**
 * Le as transcricoes locais do Claude Code (`~/.claude/projects/**\/*.jsonl`) e
 * agrega tokens e custo estimado por dia e por modelo.
 *
 * Leitura incremental: cada arquivo e lido apenas a partir do ponto onde parou
 * na ultima passada, e arquivos sem escrita recente sao ignorados. Tudo em
 * streaming, para nao travar o processo principal do Electron.
 */
export class ClaudeTranscriptReader {
  private readonly cursors = new Map<string, FileCursor>();
  private readonly seen = new Set<string>();
  private readonly daily: DailyUsage = new Map();
  private readonly unpriced = new Set<string>();

  constructor(private readonly projectsDir = defaultProjectsDir()) {}

  get unpricedModels(): string[] {
    return [...this.unpriced];
  }

  async exists(): Promise<boolean> {
    try {
      return (await stat(this.projectsDir)).isDirectory();
    } catch {
      return false;
    }
  }

  /** Incorpora o que surgiu desde a ultima chamada e devolve o mapa por dia. */
  async refresh(): Promise<DailyUsage> {
    const cutoff = Date.now() - DAYS_KEPT * 24 * 60 * 60 * 1000;
    for (const file of await this.listTranscripts()) {
      try {
        const info = await stat(file);
        // Arquivo sem escrita na janela de interesse nao tem nada novo e util.
        if (info.mtimeMs < cutoff) continue;
        const cursor = this.cursors.get(file) ?? { offset: 0 };
        if (info.size < cursor.offset) cursor.offset = 0; // arquivo rotacionado
        if (info.size === cursor.offset) continue;
        await this.ingest(file, cursor, info.size);
        this.cursors.set(file, cursor);
      } catch {
        // arquivo removido ou ilegivel entre o listar e o ler
      }
    }
    this.prune(cutoff);
    return this.daily;
  }

  private async listTranscripts(): Promise<string[]> {
    const found: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 4) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.name.endsWith('.jsonl')) found.push(full);
      }
    };
    await walk(this.projectsDir, 0);
    return found;
  }

  private async ingest(file: string, cursor: FileCursor, size: number): Promise<void> {
    const stream = createReadStream(file, { start: cursor.offset, encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.length > 0) this.accept(line);
    }
    cursor.offset = size;
  }

  private accept(line: string): void {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // linha truncada na borda da leitura anterior
    }
    if (record.type !== 'assistant') return;

    const message = record.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (!usage) return;

    // A mesma resposta pode aparecer em mais de um arquivo (retomadas, sidechains).
    const key = `${String(message?.id ?? '')}:${String(record.requestId ?? '')}`;
    if (key !== ':' && this.seen.has(key)) return;
    if (key !== ':') this.seen.add(key);

    const day = dayKey(String(record.timestamp ?? ''));
    if (!day) return;

    const model = normalizeModel(String(message?.model ?? 'desconhecido'));
    if (!priceOf(model)) this.unpriced.add(model);

    const cacheDetail = usage.cache_creation as Record<string, unknown> | undefined;
    const write1h = num(cacheDetail?.ephemeral_1h_input_tokens);
    const writeTotal = num(usage.cache_creation_input_tokens);
    const write5m = Math.max(0, writeTotal - write1h);
    const cacheRead = num(usage.cache_read_input_tokens);
    const input = num(usage.input_tokens);
    const output = num(usage.output_tokens);

    const totals: UsageTotals = {
      inputTokens: input,
      outputTokens: output,
      cacheWriteTokens: writeTotal,
      cacheReadTokens: cacheRead,
      costUsd: estimateCost(model, {
        input,
        output,
        cacheWrite5m: write5m,
        cacheWrite1h: write1h,
        cacheRead,
      }),
      requests: 1,
    };

    const byModel = this.daily.get(day) ?? new Map<string, UsageTotals>();
    const current = byModel.get(model) ?? emptyTotals();
    addTotals(current, totals);
    byModel.set(model, current);
    this.daily.set(day, byModel);
  }

  private prune(cutoff: number): void {
    const oldest = dayKeyFromDate(new Date(cutoff));
    for (const day of this.daily.keys()) {
      if (day < oldest) this.daily.delete(day);
    }
  }
}

function defaultProjectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  return join(base, 'projects');
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
