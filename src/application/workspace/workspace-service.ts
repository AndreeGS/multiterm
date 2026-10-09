import { randomUUID } from 'node:crypto';
import { type AppConfig, withRecentCommand, withRecentDir } from '../../domain/workspace/config.js';
import type { CanvasView, GridLayoutId, LayoutId, TrackSizes } from '../../domain/workspace/layout.js';
import type { SavedTerminal, WindowBounds } from '../../domain/workspace/config.js';
import type { Settings } from '../../domain/workspace/settings.js';
import { withTemplate, type TerminalTemplate } from '../../domain/workspace/template.js';
import {
  cleanWorkspaceName,
  createWorkspace,
  MAX_WORKSPACES,
  type Workspace,
} from '../../domain/workspace/workspace.js';
import type { JsonConfigStore } from '../../infrastructure/persistence/json-config-store.js';

const SAVE_DEBOUNCE_MS = 400;

/**
 * Caso de uso: preferencias do app (janela, recentes, templates, aparencia,
 * terminais abertos) e os workspaces, cada um com seu layout e sua vista.
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

  /** O workspace em uso; o config garante que ele existe. */
  active(): Workspace {
    return this.config.workspaces.find((w) => w.id === this.config.activeWorkspace) ?? this.config.workspaces[0]!;
  }

  has(id: string): boolean {
    return this.config.workspaces.some((w) => w.id === id);
  }

  /** Troca o workspace em uso; devolve ele (layout e vista para a UI aplicar). */
  activate(id: string): Workspace {
    if (this.has(id) && id !== this.config.activeWorkspace) {
      this.config = { ...this.config, activeWorkspace: id };
      this.scheduleSave();
    }
    return this.active();
  }

  /** `null` quando ja ha o maximo de workspaces. */
  createWorkspace(name: string): Workspace | null {
    if (this.config.workspaces.length >= MAX_WORKSPACES) return null;
    const workspace = createWorkspace(randomUUID(), name);
    this.config = { ...this.config, workspaces: [...this.config.workspaces, workspace] };
    this.scheduleSave();
    return workspace;
  }

  renameWorkspace(id: string, name: string): void {
    const clean = cleanWorkspaceName(name);
    if (clean) this.patchWorkspace(id, { name: clean });
  }

  /**
   * Remove um workspace e os terminais salvos dele. O ultimo nao sai: sempre
   * ha onde trabalhar. Se era o ativo, passa a ser o primeiro que sobrou.
   */
  removeWorkspace(id: string): boolean {
    if (this.config.workspaces.length <= 1 || !this.has(id)) return false;
    const workspaces = this.config.workspaces.filter((w) => w.id !== id);
    this.config = {
      ...this.config,
      workspaces,
      activeWorkspace: this.config.activeWorkspace === id ? workspaces[0]!.id : this.config.activeWorkspace,
      terminals: this.config.terminals.filter((t) => t.workspaceId !== id),
    };
    this.scheduleSave();
    return true;
  }

  setLayout(layout: LayoutId): void {
    this.patchWorkspace(this.config.activeWorkspace, { layout });
  }

  setLayoutSizes(layout: GridLayoutId, sizes: TrackSizes): void {
    const active = this.active();
    this.patchWorkspace(active.id, { layoutSizes: { ...active.layoutSizes, [layout]: sizes } });
  }

  setCanvasView(canvasView: CanvasView): void {
    this.patchWorkspace(this.config.activeWorkspace, { canvasView });
  }

  setWindowBounds(window: WindowBounds): void {
    this.config = { ...this.config, window };
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

  private patchWorkspace(id: string, patch: Partial<Omit<Workspace, 'id'>>): void {
    this.config = {
      ...this.config,
      workspaces: this.config.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    };
    this.scheduleSave();
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
