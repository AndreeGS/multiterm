/**
 * Grava depois de uma pausa nas mudancas, e de novo enquanto a gravacao
 * falhar: o estado so deixa de estar "sujo" quando `save` devolve `true`.
 * Uma falha (disco cheio, permissao) e retentada na proxima mudanca e no
 * `flush` do encerramento, em vez de se perder em silencio.
 */
export class DebouncedSave {
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(
    private readonly delayMs: number,
    private readonly save: () => boolean,
  ) {}

  schedule(): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.run();
    }, this.delayMs);
    this.timer.unref?.();
  }

  /** Grava agora o que estiver pendente (usado no encerramento do app). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty) this.run();
  }

  private run(): void {
    this.dirty = !this.save();
  }
}
