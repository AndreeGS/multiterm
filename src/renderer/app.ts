import type { Note } from '../domain/notes/note.js';
import type { TaskList } from '../domain/tasks/task-list.js';
import type { TerminalSnapshot } from '../domain/terminal/types.js';
import { capacity, isGridLayout, layoutFor, type CanvasRect, type LayoutId } from '../domain/workspace/layout.js';
import { defaultSettings, type Settings } from '../domain/workspace/settings.js';
import type { MultiTermApi } from '../shared/contract.js';
import { CanvasBoard } from './components/canvas.js';
import { TerminalGrid } from './components/grid.js';
import { openNewTerminalDialog } from './components/new-terminal-dialog.js';
import { NotePane } from './components/note-pane.js';
import { openSettingsDialog } from './components/settings-dialog.js';
import type { Board, Panel } from './components/panel.js';
import { TaskPane } from './components/task-pane.js';
import { TerminalPane } from './components/terminal-pane.js';
import { Toolbar } from './components/toolbar.js';
import { setHomeDir } from './paths.js';
import { applyDocumentSettings } from './theme.js';

/**
 * Orquestra a UI: mantem a lista de paineis (terminais, notas e tarefas) em sincronia
 * com o main e repassa acoes do usuario para a API exposta pelo preload.
 */
export class App {
  private readonly panes = new Map<string, Panel>();
  private readonly order: string[] = [];
  private readonly toolbar: Toolbar;
  private readonly grid: TerminalGrid;
  private readonly canvas: CanvasBoard;
  private readonly emptyState = document.createElement('div');
  private layout: LayoutId;
  private recentDirs: string[] = [];
  private defaultDir = '';
  private focusedId: string | null = null;
  private readonly attention = new Set<string>();
  private dialogOpen = false;
  private settings: Settings = defaultSettings();

  constructor(
    private readonly root: HTMLElement,
    private readonly api: MultiTermApi,
    layout: LayoutId,
  ) {
    this.layout = layout;
    this.canvas = new CanvasBoard((view) => this.api.setCanvasView(view), {
      create: (x, y) => this.api.createText(x, y),
      update: (id, patch) => this.api.updateText(id, patch),
      remove: (id) => void this.api.deleteText(id),
    });
    this.toolbar = new Toolbar({
      onNewTerminal: () => void this.promptNewTerminal(),
      onNewNote: () => void this.createNote(),
      onNewTaskList: () => void this.createTaskList(),
      onLayout: (next) => this.setLayout(next),
      onPage: (delta) => this.board.setPage(this.board.currentPage + delta),
      onNextAttention: () => this.goToNextAttention(),
      onRestoreSession: () => void this.restoreSession(),
      onDiscardSession: () => void this.discardSession(),
      onSettings: () => void this.openSettings(),
    }, api);

    this.grid = new TerminalGrid(
      isGridLayout(layout) ? layout : '4',
      () => this.updatePaging(),
      (gridLayout, sizes) => this.api.setLayoutSizes(gridLayout, sizes),
    );

    const wrap = document.createElement('div');
    wrap.className = 'grid-wrap';
    this.emptyState.className = 'empty';
    this.emptyState.innerHTML =
      '<div>Nada aberto ainda.</div>' +
      '<div><kbd>Ctrl</kbd>+<kbd>T</kbd> novo terminal · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> nova nota · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> nova lista de tarefas</div>';
    wrap.append(this.emptyState, this.grid.element, this.canvas.element);

    this.root.append(this.toolbar.element, wrap);
    this.toolbar.setLayout(layout);

    this.bindGlobalEvents();
  }

  /** A grade ou a area livre, conforme o layout escolhido. */
  private get board(): Board {
    return this.layout === 'free' ? this.canvas : this.grid;
  }

  async start(): Promise<void> {
    const state = await this.api.bootstrap();
    this.settings = state.settings;
    applyDocumentSettings(this.settings);
    this.recentDirs = state.recentDirs;
    this.defaultDir = state.defaultDir;
    setHomeDir(state.homeDir);
    this.grid.setSizes(state.layoutSizes);
    if (state.canvasView) this.canvas.restoreView(state.canvasView);
    this.canvas.setTexts(state.texts);
    for (const note of state.notes) this.addNote(note);
    for (const list of state.taskLists) this.addTaskList(list);
    for (const snapshot of state.terminals) {
      this.addTerminal(snapshot, state.terminalRects[snapshot.id] ?? null);
      this.trackAttention(snapshot);
    }
    this.toolbar.setPendingSession(state.pendingSession.map((t) => t.name || t.cwd));
    this.applyLayout(state.layout);
  }

  private async restoreSession(): Promise<void> {
    this.toolbar.setPendingSession([]);
    const { terminals, terminalRects } = await this.api.restoreSession();
    if (terminals.length === 0) return;
    for (const snapshot of terminals) this.addTerminal(snapshot, terminalRects[snapshot.id] ?? null);
    const needed = layoutFor(this.order.length);
    if (isGridLayout(this.layout) && capacity(needed) > capacity(this.layout)) this.setLayout(needed);
    this.sync();
    this.focus(terminals[0]!.id);
  }

  private async discardSession(): Promise<void> {
    this.toolbar.setPendingSession([]);
    await this.api.discardSession();
  }

  private bindGlobalEvents(): void {
    this.api.onTerminalUpdate((snapshot) => {
      const pane = this.panes.get(snapshot.id);
      if (pane instanceof TerminalPane) pane.update(snapshot);
      this.trackAttention(snapshot);
    });
    this.api.onTerminalClose((id) => this.removePane(id));

    // Voltar para a janela ja conta como "vi o terminal em foco".
    window.addEventListener('focus', () => {
      if (this.focusedId) this.acknowledge(this.focusedId);
    });

    window.addEventListener('resize', () => {
      for (const pane of this.board.visiblePanes()) pane.refit();
    });

    window.addEventListener('keydown', (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();

      if (event.shiftKey && key === 't') {
        event.preventDefault();
        void this.promptNewTerminal();
        return;
      }
      if (!event.shiftKey && key === 't' && !this.isTypingInTerminal(event)) {
        event.preventDefault();
        void this.promptNewTerminal();
        return;
      }
      if (!event.shiftKey && key === ',') {
        event.preventDefault();
        void this.openSettings();
        return;
      }
      if (event.shiftKey && key === 'n') {
        event.preventDefault();
        void this.createNote();
        return;
      }
      if (event.shiftKey && key === 'l') {
        event.preventDefault();
        void this.createTaskList();
        return;
      }
      if (event.shiftKey && key === 'w' && this.focusedId) {
        event.preventDefault();
        void this.closePane(this.focusedId);
        return;
      }
      if (event.shiftKey && key === 'm' && this.focusedId) {
        event.preventDefault();
        this.board.toggleMaximize(this.focusedId);
      }
    });
  }

  /**
   * Ctrl+T dentro do xterm pertence ao shell/agente; so intercepta quando o
   * foco nao esta em um terminal.
   */
  private isTypingInTerminal(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return Boolean(target?.closest('.pane-body:not(.note-body):not(.tasks-body)'));
  }

  private async promptNewTerminal(): Promise<void> {
    if (this.dialogOpen) return;
    this.dialogOpen = true;
    try {
      const spec = await openNewTerminalDialog(this.api, this.recentDirs, this.defaultDir);
      if (!spec) return;
      const snapshot = await this.api.createTerminal(spec);
      this.rememberDir(snapshot.cwd);
      this.addTerminal(snapshot);
      this.showNew(snapshot.id);
    } finally {
      this.dialogOpen = false;
    }
  }

  private async openSettings(): Promise<void> {
    if (this.dialogOpen) return;
    this.dialogOpen = true;
    try {
      await openSettingsDialog(this.settings, (settings) => this.applySettings(settings));
    } finally {
      this.dialogOpen = false;
      if (this.focusedId) this.panes.get(this.focusedId)?.focus();
    }
  }

  private applySettings(settings: Settings): void {
    this.settings = settings;
    applyDocumentSettings(settings);
    // Cabecalhos mudam de altura com a escala; o ResizeObserver de cada terminal refaz o fit.
    for (const pane of this.panes.values()) pane.setAppearance(settings);
    this.api.setSettings(settings);
  }

  private async createNote(): Promise<void> {
    const note = await this.api.createNote();
    this.addNote(note);
    this.showNew(note.id);
  }

  private async createTaskList(): Promise<void> {
    const list = await this.api.createTaskList();
    this.addTaskList(list);
    this.showNew(list.id);
  }

  /** Exibe um painel recem-criado e da foco a ele. */
  private showNew(id: string): void {
    // Cresce a grade automaticamente ate caber, sem passar do escolhido.
    const needed = layoutFor(this.order.length);
    if (isGridLayout(this.layout) && capacity(needed) > capacity(this.layout)) this.setLayout(needed);
    this.sync();
    this.board.revealPane(id);
    this.focus(id);
  }

  /** Nota ou lista com conteudo pede confirmacao: fechar apaga de vez. */
  private async closePane(id: string): Promise<void> {
    const pane = this.panes.get(id);
    if (pane instanceof NotePane) {
      if (!pane.isEmpty && !window.confirm('Fechar esta nota apaga o conteudo dela. Continuar?')) return;
      await this.api.deleteNote(id);
      this.removePane(id);
      return;
    }
    if (pane instanceof TaskPane) {
      if (!pane.isEmpty && !window.confirm('Fechar esta lista apaga todas as tarefas dela. Continuar?')) return;
      await this.api.deleteTaskList(id);
      this.removePane(id);
      return;
    }
    await this.api.closeTerminal(id);
  }

  /**
   * Um terminal em foco, com a janela ativa, ja esta sendo visto — nesse caso
   * o pedido de atencao se resolve sozinho.
   */
  private trackAttention(snapshot: TerminalSnapshot): void {
    // Update de um terminal que ja saiu da tela nao pode ressuscitar o contador.
    if (!this.panes.has(snapshot.id)) {
      this.attention.delete(snapshot.id);
      this.toolbar.setAttention(this.attention.size);
      return;
    }
    if (snapshot.needsAttention && snapshot.id === this.focusedId && document.hasFocus()) {
      this.acknowledge(snapshot.id);
      return;
    }
    if (snapshot.needsAttention) this.attention.add(snapshot.id);
    else this.attention.delete(snapshot.id);
    this.toolbar.setAttention(this.attention.size);
  }

  private acknowledge(id: string): void {
    if (!(this.panes.get(id) instanceof TerminalPane)) return;
    // Sempre avisa o main: o contador da UI e o estado da sessao podem estar
    // dessincronizados, e do lado de la o acknowledge e no-op quando nao ha nada.
    this.api.acknowledgeTerminal(id);
    if (this.attention.delete(id)) this.toolbar.setAttention(this.attention.size);
  }

  private goToNextAttention(): void {
    // Percorre na ordem de criacao, comecando depois do terminal em foco.
    const start = this.focusedId ? this.order.indexOf(this.focusedId) + 1 : 0;
    for (let i = 0; i < this.order.length; i += 1) {
      const id = this.order[(start + i) % this.order.length]!;
      if (!this.attention.has(id)) continue;
      this.board.revealPane(id);
      this.focus(id);
      return;
    }
  }

  private addTerminal(snapshot: TerminalSnapshot, rect: CanvasRect | null = null): void {
    this.addPane(new TerminalPane(snapshot, this.api, this.paneCallbacks(), this.settings, rect));
  }

  private addNote(note: Note): void {
    this.addPane(new NotePane(note, this.api, this.paneCallbacks(), this.settings));
  }

  private addTaskList(list: TaskList): void {
    this.addPane(new TaskPane(list, this.api, this.paneCallbacks(), this.settings));
  }

  private paneCallbacks() {
    return {
      onFocus: (id: string) => this.focus(id),
      onClose: (id: string) => void this.closePane(id),
      onMaximize: (id: string) => {
        this.board.toggleMaximize(id);
        this.focus(id);
      },
    };
  }

  private addPane(pane: Panel): void {
    this.panes.set(pane.id, pane);
    this.order.push(pane.id);
  }

  private removePane(id: string): void {
    const pane = this.panes.get(id);
    if (!pane) return;
    this.panes.delete(id);
    this.attention.delete(id);
    this.toolbar.setAttention(this.attention.size);
    const position = this.order.indexOf(id);
    // splice(-1, 1) removeria o ultimo item; so mexe se o id realmente estiver la.
    if (position >= 0) this.order.splice(position, 1);
    pane.dispose();
    if (this.focusedId === id) this.focusedId = null;
    this.sync();
  }

  /** Muda o layout por acao do usuario: reflete na UI e persiste. */
  private setLayout(layout: LayoutId): void {
    this.applyLayout(layout);
    this.api.setLayout(layout);
  }

  private applyLayout(layout: LayoutId): void {
    const previous = this.board;
    this.layout = layout;
    if (isGridLayout(layout)) this.grid.setLayout(layout);
    // Trocar entre grade e area livre: quem sai solta os paineis antes.
    if (previous !== this.board) previous.setPanes([]);
    this.toolbar.setLayout(layout);
    this.sync();
    if (this.focusedId) this.board.revealPane(this.focusedId);
  }

  private focus(id: string): void {
    if (this.focusedId === id) {
      this.panes.get(id)?.focus();
      this.acknowledge(id);
      return;
    }
    this.focusedId = id;
    for (const [paneId, pane] of this.panes) pane.setFocused(paneId === id);
    this.panes.get(id)?.focus();
    this.acknowledge(id);
  }

  private rememberDir(dir: string): void {
    this.recentDirs = [dir, ...this.recentDirs.filter((d) => d !== dir)].slice(0, 12);
    this.defaultDir = dir;
  }

  private updatePaging(): void {
    this.toolbar.setPaging(this.board.currentPage, this.board.pageCount);
  }

  private sync(): void {
    const hasPanes = this.order.length > 0;
    this.emptyState.hidden = hasPanes;
    // A area livre fica visivel mesmo vazia: o fundo e onde se trabalha.
    this.grid.element.hidden = !hasPanes || this.board !== this.grid;
    this.canvas.element.hidden = this.board !== this.canvas;
    this.board.setPanes(this.order.map((id) => this.panes.get(id)!).filter(Boolean));
    this.updatePaging();
  }
}
