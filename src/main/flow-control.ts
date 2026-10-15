/** Output enviado e ainda nao desenhado pelo xterm acima do qual o pty pausa. */
export const HIGH_WATERMARK = 1024 * 1024;
/** Abaixo disto o pty volta a ler. */
export const LOW_WATERMARK = 256 * 1024;

/**
 * Controle de fluxo do output: o renderer confirma o que o xterm ja desenhou.
 * Um `cat` de um arquivo enorme, ou um agente muito verboso, enchia o IPC e a
 * fila do xterm sem limite e travava a janela; com isto o pty pausa (o
 * programa bloqueia na escrita, como num terminal comum) ate a tela alcancar.
 *
 * Logica pura: quem chama decide o que fazer com `pause`/`resume`.
 */
export class FlowControl {
  private readonly inFlight = new Map<string, number>();
  private readonly paused = new Set<string>();

  /** Saiu um lote para o renderer. `true` = acabou de passar do limite: pausar. */
  sent(id: string, bytes: number): boolean {
    const total = (this.inFlight.get(id) ?? 0) + bytes;
    this.inFlight.set(id, total);
    if (total < HIGH_WATERMARK || this.paused.has(id)) return false;
    this.paused.add(id);
    return true;
  }

  /** O renderer desenhou `bytes`. `true` = estava pausado e ja pode voltar. */
  acked(id: string, bytes: number): boolean {
    const total = Math.max(0, (this.inFlight.get(id) ?? 0) - bytes);
    this.inFlight.set(id, total);
    if (total > LOW_WATERMARK || !this.paused.has(id)) return false;
    this.paused.delete(id);
    return true;
  }

  isPaused(id: string): boolean {
    return this.paused.has(id);
  }

  /**
   * Esquece tudo (renderer recarregou: o que estava em voo nunca sera
   * confirmado). Devolve os que estavam pausados, para retomar.
   */
  reset(): string[] {
    const paused = [...this.paused];
    this.paused.clear();
    this.inFlight.clear();
    return paused;
  }

  forget(id: string): void {
    this.paused.delete(id);
    this.inFlight.delete(id);
  }
}
