import type { TerminalOutput } from '../shared/contract.js';

/** Uma janela de ~1 frame: agrupa sem atraso perceptivel ao digitar. */
export const BATCH_INTERVAL_MS = 16;

/**
 * Agrupa o output dos ptys antes de cruzar o IPC. Um agente redesenhando a
 * TUI gera centenas de chunks pequenos por segundo; com varios terminais isso
 * vira milhares de mensagens. Aqui cada terminal ganha uma entrada por janela,
 * com os chunks concatenados, e o lote inteiro vai numa mensagem so.
 */
export class OutputBatcher {
  private readonly pending = new Map<string, { data: string; seq: number }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly deliver: (batch: TerminalOutput[]) => void,
    private readonly intervalMs = BATCH_INTERVAL_MS,
  ) {}

  push(id: string, chunk: string, seq: number): void {
    const entry = this.pending.get(id);
    if (entry) {
      entry.data += chunk;
      entry.seq = seq;
    } else {
      this.pending.set(id, { data: chunk, seq });
    }
    this.timer ??= setTimeout(() => this.flush(), this.intervalMs);
  }

  /**
   * Entrega ja o que esta acumulado. Chamado antes de eventos que precisam
   * chegar depois do output: o replay (senao um lote misturaria chunks de
   * antes e depois dele) e o fechamento do terminal.
   */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    const batch: TerminalOutput[] = [...this.pending].map(([id, { data, seq }]) => [id, data, seq]);
    this.pending.clear();
    this.deliver(batch);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}
