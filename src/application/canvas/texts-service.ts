import { randomUUID } from 'node:crypto';
import { applyTextPatch, createCanvasText, type CanvasText, type CanvasTextPatch } from '../../domain/canvas/text.js';
import type { JsonTextsStore } from '../../infrastructure/persistence/json-texts-store.js';

const SAVE_DEBOUNCE_MS = 600;

/**
 * Caso de uso: textos soltos da area livre. Mesmo esquema das notas: o
 * renderer manda cada tecla e o disco so e escrito depois de uma pausa.
 */
export class TextsService {
  private readonly texts = new Map<string, CanvasText>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly store: JsonTextsStore) {
    for (const text of store.load()) this.texts.set(text.id, text);
  }

  list(): CanvasText[] {
    return [...this.texts.values()];
  }

  create(x: number, y: number): CanvasText {
    const text = createCanvasText(randomUUID(), x, y, Date.now());
    this.texts.set(text.id, text);
    this.scheduleSave();
    return text;
  }

  update(id: string, patch: CanvasTextPatch): void {
    const text = this.texts.get(id);
    if (!text) return;
    this.texts.set(id, applyTextPatch(text, patch, Date.now()));
    this.scheduleSave();
  }

  remove(id: string): void {
    if (this.texts.delete(id)) this.scheduleSave();
  }

  /** Grava imediatamente (usado no encerramento do app). */
  flush(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.store.save(this.list());
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.store.save(this.list());
    }, SAVE_DEBOUNCE_MS);
    this.timer.unref?.();
  }
}
