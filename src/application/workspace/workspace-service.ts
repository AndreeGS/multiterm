import { type AppConfig, withRecentDir } from '../../domain/workspace/config.js';
import type { GridLayoutId, LayoutId, TrackSizes } from '../../domain/workspace/layout.js';
import type { WindowBounds } from '../../domain/workspace/config.js';
import type { JsonConfigStore } from '../../infrastructure/persistence/json-config-store.js';

const SAVE_DEBOUNCE_MS = 400;

/**
 * Caso de uso: preferencias do workspace (layout, janela, diretorios recentes).
 * Mantem o estado em memoria e persiste com debounce para nao escrever no disco
 * a cada pixel de resize.
 */
export class WorkspaceService {
  private config: AppConfig;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly store: JsonConfigStore) {
    this.config = store.load();
  }

  current(): AppConfig {
    return this.config;
  }

  setLayout(layout: LayoutId): void {
    this.config = { ...this.config, layout };
    this.scheduleSave();
  }

  setLayoutSizes(layout: GridLayoutId, sizes: TrackSizes): void {
    this.config = { ...this.config, layoutSizes: { ...this.config.layoutSizes, [layout]: sizes } };
    this.scheduleSave();
  }

  setWindowBounds(window: WindowBounds): void {
    this.config = { ...this.config, window };
    this.scheduleSave();
  }

  rememberDir(dir: string): void {
    this.config = withRecentDir(this.config, dir);
    this.scheduleSave();
  }

  /** Grava imediatamente (usado no encerramento do app). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.store.save(this.config);
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.store.save(this.config);
    }, SAVE_DEBOUNCE_MS);
    this.timer.unref?.();
  }
}
