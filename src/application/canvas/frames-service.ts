import { randomUUID } from 'node:crypto';
import { applyFramePatch, createFrame, type CanvasFrame, type CanvasFramePatch } from '../../domain/canvas/frame.js';
import type { CanvasRect } from '../../domain/workspace/layout.js';
import type { JsonFramesStore } from '../../infrastructure/persistence/json-frames-store.js';

const SAVE_DEBOUNCE_MS = 600;

/** Caso de uso: molduras da area livre. Mesmo esquema dos textos soltos. */
export class FramesService {
  private readonly frames = new Map<string, CanvasFrame>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly store: JsonFramesStore) {
    for (const frame of store.load()) this.frames.set(frame.id, frame);
  }

  list(): CanvasFrame[] {
    return [...this.frames.values()];
  }

  create(rect: CanvasRect): CanvasFrame {
    const frame = createFrame(randomUUID(), rect, Date.now());
    this.frames.set(frame.id, frame);
    this.scheduleSave();
    return frame;
  }

  update(id: string, patch: CanvasFramePatch): void {
    const frame = this.frames.get(id);
    if (!frame) return;
    this.frames.set(id, applyFramePatch(frame, patch, Date.now()));
    this.scheduleSave();
  }

  remove(id: string): void {
    if (this.frames.delete(id)) this.scheduleSave();
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
