import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { priceOf } from '../../domain/usage/pricing.js';
import { dayKeyFromDate, parseUsageLine } from '../../domain/usage/transcript.js';
import { addTotals, emptyTotals, type UsageTotals } from '../../domain/usage/types.js';
import { claudeProjectsDir } from './claude-paths.js';

/** Totais de um dia (chave local YYYY-MM-DD), por modelo. */
export type DailyUsage = Map<string, Map<string, UsageTotals>>;

interface FileCursor {
  /** Byte lido ate agora; transcricoes so crescem no fim. */
  offset: number;
}

const DAYS_KEPT = 8;

/**
 * Le as transcricoes locais do Claude Code (`~/.claude/projects/**\/*.jsonl`) e
 * agrega tokens e custo estimado por dia e por modelo, e por conversa.
 *
 * Leitura incremental: cada arquivo e lido apenas a partir do ponto onde parou
 * na ultima passada, e arquivos sem escrita recente sao ignorados. Tudo em
 * streaming, para nao travar o processo principal do Electron.
 */
export class ClaudeTranscriptReader {
  private readonly cursors = new Map<string, FileCursor>();
  private readonly seen = new Set<string>();
  private readonly daily: DailyUsage = new Map();
  /** Totais de cada conversa, desde o inicio do arquivo (nao so a janela de dias). */
  private readonly sessions = new Map<string, UsageTotals>();
  private readonly unpriced = new Set<string>();

  constructor(private readonly projectsDir = claudeProjectsDir()) {}

  get unpricedModels(): string[] {
    return [...this.unpriced];
  }

  /** Consumo por conversa (sessionId do Claude Code). */
  get bySession(): ReadonlyMap<string, UsageTotals> {
    return this.sessions;
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

  /**
   * Le do ponto onde parou ate o fim, mas so avanca o cursor ate a ultima
   * quebra de linha: uma linha ainda sendo escrita fica para a proxima passada
   * em vez de ser descartada como JSON quebrado.
   */
  private async ingest(file: string, cursor: FileCursor, size: number): Promise<void> {
    const stream = createReadStream(file, { start: cursor.offset, end: size - 1 });
    let pending: Buffer = Buffer.alloc(0);
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let newline = pending.indexOf(NEWLINE);
      while (newline >= 0) {
        const line = pending.toString('utf8', 0, newline);
        cursor.offset += newline + 1;
        if (line.length > 0) this.accept(line, file);
        pending = pending.subarray(newline + 1);
        newline = pending.indexOf(NEWLINE);
      }
    }
  }

  private accept(line: string, file: string): void {
    const record = parseUsageLine(line);
    if (!record) return;

    // A mesma resposta pode aparecer em mais de um arquivo (retomadas, sidechains).
    if (record.key !== null) {
      if (this.seen.has(record.key)) return;
      this.seen.add(record.key);
    }

    if (!priceOf(record.model)) this.unpriced.add(record.model);

    const byModel = this.daily.get(record.day) ?? new Map<string, UsageTotals>();
    const current = byModel.get(record.model) ?? emptyTotals();
    addTotals(current, record.totals);
    byModel.set(record.model, current);
    this.daily.set(record.day, byModel);

    const sessionId = record.sessionId ?? basename(file, '.jsonl');
    const session = this.sessions.get(sessionId) ?? emptyTotals();
    addTotals(session, record.totals);
    this.sessions.set(sessionId, session);
  }

  private prune(cutoff: number): void {
    const oldest = dayKeyFromDate(new Date(cutoff));
    for (const day of this.daily.keys()) {
      if (day < oldest) this.daily.delete(day);
    }
  }
}

const NEWLINE = 0x0a;
