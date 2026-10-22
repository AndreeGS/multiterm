import type { WorktreeInfo, WorktreeStatus } from '../../domain/git/worktree.js';
import type { TerminalSnapshot, TerminalStatus } from '../../domain/terminal/types.js';

const REFRESH_INTERVAL_MS = 60_000;
/** Varias atualizacoes seguidas (o agente para, volta, para) viram uma consulta so. */
const DEBOUNCE_MS = 400;

interface Tracked {
  worktree: WorktreeInfo;
  status: TerminalStatus;
  timer: NodeJS.Timeout | null;
  /** Ultimo status enviado, serializado: so manda de novo se mudou. */
  sent: string | null;
}

export interface StatusSource {
  status(worktree: WorktreeInfo): Promise<WorktreeStatus>;
}

/**
 * Caso de uso: manter o `+novos ~alterados ↑frente` dos terminais com
 * worktree. Consulta o git quando o terminal nasce, quando ele para de
 * produzir output (o agente terminou uma volta, provavelmente mexeu em
 * arquivos), quando voce pede (foco no terminal) e, por garantia, a cada minuto.
 */
export class WorktreeStatusService {
  private readonly tracked = new Map<string, Tracked>();
  /** Consulta em andamento por pasta: dois terminais no mesmo worktree dividem uma. */
  private readonly inFlight = new Map<string, Promise<WorktreeStatus | null>>();
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly source: StatusSource,
    private readonly onStatus: (id: string, status: WorktreeStatus | null) => void,
    private readonly timing = { intervalMs: REFRESH_INTERVAL_MS, debounceMs: DEBOUNCE_MS },
  ) {}

  start(): void {
    this.interval = setInterval(() => {
      for (const id of this.tracked.keys()) void this.refresh(id);
    }, this.timing.intervalMs);
    this.interval.unref?.();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const entry of this.tracked.values()) if (entry.timer) clearTimeout(entry.timer);
  }

  /** Cada update de terminal passa por aqui. */
  observe(snapshot: TerminalSnapshot): void {
    if (!snapshot.worktree) {
      this.forget(snapshot.id);
      return;
    }
    const entry = this.tracked.get(snapshot.id);
    if (!entry) {
      this.tracked.set(snapshot.id, { worktree: snapshot.worktree, status: snapshot.status, timer: null, sent: null });
      this.schedule(snapshot.id);
      return;
    }
    const stopped = entry.status === 'running' && snapshot.status !== 'running';
    entry.worktree = snapshot.worktree;
    entry.status = snapshot.status;
    if (stopped) this.schedule(snapshot.id);
  }

  forget(id: string): void {
    const entry = this.tracked.get(id);
    if (entry?.timer) clearTimeout(entry.timer);
    this.tracked.delete(id);
  }

  /** Pedido da interface (foco no terminal, janela recarregada): manda mesmo sem mudanca. */
  request(id: string): void {
    const entry = this.tracked.get(id);
    if (!entry) return;
    entry.sent = null;
    this.schedule(id);
  }

  private schedule(id: string): void {
    const entry = this.tracked.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.refresh(id);
    }, this.timing.debounceMs);
  }

  private async refresh(id: string): Promise<void> {
    const entry = this.tracked.get(id);
    if (!entry) return;
    const status = await this.query(entry.worktree);
    // Fechado (ou trocado) enquanto o git rodava.
    if (this.tracked.get(id) !== entry) return;
    const serialized = JSON.stringify(status);
    if (serialized === entry.sent) return;
    entry.sent = serialized;
    this.onStatus(id, status);
  }

  private query(worktree: WorktreeInfo): Promise<WorktreeStatus | null> {
    const running = this.inFlight.get(worktree.path);
    if (running) return running;
    // Pasta apagada por fora, git ausente...: sem status, o cabecalho so nao mostra nada.
    const next = this.source.status(worktree).catch(() => null);
    this.inFlight.set(worktree.path, next);
    void next.finally(() => {
      if (this.inFlight.get(worktree.path) === next) this.inFlight.delete(worktree.path);
    });
    return next;
  }
}
