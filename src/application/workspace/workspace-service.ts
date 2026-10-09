import { type AppConfig, withRecentCommand, withRecentDir } from '../../domain/workspace/config.js';
import type { CanvasView, GridLayoutId, LayoutId, TrackSizes } from '../../domain/workspace/layout.js';
import type { SavedTerminal, WindowBounds } from '../../domain/workspace/config.js';
import type { Settings } from '../../domain/workspace/settings.js';
import { withTemplate, type TerminalTemplate } from '../../domain/workspace/template.js';
import type { JsonConfigStore } from '../../infrastructure/persistence/json-config-store.js';

const SAVE_DEBOUNCE_MS = 400;

/**
 * Caso de uso: preferencias do workspace (layout, janela, diretorios recentes,
 * terminais abertos, vista da area livre e aparencia).
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

  setCanvasView(canvasView: CanvasView): void {
    this.config = { ...this.config, canvasView };
    this.scheduleSave();
  }

  setSettings(settings: Settings): void {
    this.config = { ...this.config, settings };
    this.scheduleSave();
  }

  saveTemplate(template: TerminalTemplate): void {
    this.config = { ...this.config, templates: withTemplate(this.config.templates, template) };
    this.scheduleSave();
  }

  removeTemplate(id: string): void {
    this.config = { ...this.config, templates: this.config.templates.filter((t) => t.id !== id) };
    this.scheduleSave();
  }

  /** Chamado a cada update de terminal; so grava se algo relevante mudou. */
  setTerminals(terminals: SavedTerminal[]): void {
    if (JSON.stringify(terminals) === JSON.stringify(this.config.terminals)) return;
    this.config = { ...this.config, terminals };
    this.scheduleSave();
  }

  rememberDir(dir: string): void {
    this.config = withRecentDir(this.config, dir);
    this.scheduleSave();
  }

  rememberCommand(command: string): void {
    if (!command) return;
    this.config = withRecentCommand(this.config, command);
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
