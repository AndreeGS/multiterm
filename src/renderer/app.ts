import type { Note } from '../domain/notes/note.js';
import type { TaskList } from '../domain/tasks/task-list.js';
import type { TerminalSnapshot, TerminalSpec } from '../domain/terminal/types.js';
import type { TerminalTemplate } from '../domain/workspace/template.js';
import type { WorktreeInfo } from '../domain/git/worktree.js';
import type { UsageSummary, UsageTotals } from '../domain/usage/types.js';
import { capacity, isGridLayout, layoutFor, type CanvasRect, type LayoutId } from '../domain/workspace/layout.js';
import type { SavedTerminal } from '../domain/workspace/config.js';
import { defaultSettings, type Settings } from '../domain/workspace/settings.js';
import type { MultiTermApi } from '../shared/contract.js';
import { CanvasBoard } from './components/canvas.js';
import { LinkLayer, type LinkPair } from './components/link-layer.js';
import { paneColorVar } from './components/color-menu.js';
import { openPalette, type PaletteItem } from './components/command-palette.js';
import { TerminalGrid } from './components/grid.js';
import { openNewTerminalDialog } from './components/new-terminal-dialog.js';
import { NotePane } from './components/note-pane.js';
import { openSettingsDialog } from './components/settings-dialog.js';
import type { Board, LinkLabel, Panel } from './components/panel.js';
import { TaskPane } from './components/task-pane.js';
import { terminalPlace, TerminalPane } from './components/terminal-pane.js';
import { Toolbar } from './components/toolbar.js';
import { setHomeDir, shortenPath } from './paths.js';
import { matchShortcut, type Shortcut } from './shortcuts.js';
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
  private recentCommands: string[] = [];
  private templates: TerminalTemplate[] = [];
  /** Consumo por conversa do Claude, do ultimo resumo de uso. */
  private usageBySession: Record<string, UsageTotals> = {};
  /** Terminais da sessao anterior ainda nao restaurados (vinculos podem apontar para eles). */
  private pendingTerminals: SavedTerminal[] = [];
  private readonly links: LinkLayer;
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
    }, {
      create: (rect) => this.api.createFrame(rect),
      update: (id, patch) => this.api.updateFrame(id, patch),
      remove: (id) => void this.api.deleteFrame(id),
    });
    this.toolbar = new Toolbar({
      onNewTerminal: () => void this.promptNewTerminal(),
      onTemplates: () => void this.openTemplates(),
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
      '<div><kbd>Ctrl</kbd>+<kbd>T</kbd> novo terminal · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> nova nota · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> nova lista de tarefas</div>' +
      '<div><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> todos os comandos</div>';
    this.links = new LinkLayer(wrap, () => this.linkPairs());
    wrap.append(this.emptyState, this.grid.element, this.canvas.element, this.links.element);

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
    this.links.setEnabled(this.settings.showLinks);
    this.recentDirs = state.recentDirs;
    this.recentCommands = state.recentCommands;
    this.templates = state.templates;
    this.defaultDir = state.defaultDir;
    setHomeDir(state.homeDir);
    this.grid.setSizes(state.layoutSizes);
    if (state.canvasView) this.canvas.restoreView(state.canvasView);
    this.canvas.setTexts(state.texts);
    this.canvas.setFrames(state.frames);
    for (const note of state.notes) this.addNote(note);
    for (const list of state.taskLists) this.addTaskList(list);
    for (const snapshot of state.terminals) {
      this.addTerminal(snapshot, state.terminalRects[snapshot.id] ?? null);
      this.trackAttention(snapshot);
    }
    this.setPendingSession(state.pendingSession);
    void this.api.getUsage().then((summary) => this.applyUsageSummary(summary));
    // Vinculo para um terminal que nao existe mais (nem aberto, nem na sessao
    // anterior) nao tem como voltar: solta.
    for (const source of this.linkSources()) {
      if (source.terminalId && !this.linkLabel(source.terminalId)) source.setLink(null);
    }
    this.refreshLinks();
    this.applyLayout(state.layout);
  }

  private setPendingSession(terminals: SavedTerminal[]): void {
    this.pendingTerminals = terminals;
    this.toolbar.setPendingSession(terminals.map((t) => t.name || t.cwd));
  }

  private async restoreSession(): Promise<void> {
    this.setPendingSession([]);
    const { terminals, terminalRects } = await this.api.restoreSession();
    if (terminals.length === 0) return;
    for (const snapshot of terminals) this.addTerminal(snapshot, terminalRects[snapshot.id] ?? null);
    // Os terminais voltam com o mesmo id: os vinculos de notas e listas reacendem.
    this.refreshLinks();
    const needed = layoutFor(this.order.length);
    if (isGridLayout(this.layout) && capacity(needed) > capacity(this.layout)) this.setLayout(needed);
    this.sync();
    this.focus(terminals[0]!.id);
  }

  private async discardSession(): Promise<void> {
    const discarded = new Set(this.pendingTerminals.map((t) => t.id));
    this.setPendingSession([]);
    for (const source of this.linkSources()) {
      if (source.terminalId && discarded.has(source.terminalId)) source.setLink(null);
    }
    this.refreshLinks();
    await this.api.discardSession();
  }

  private bindGlobalEvents(): void {
    // Uma assinatura so para o output de todos os terminais, roteada pelo id.
    this.api.onTerminalData((batch) => {
      for (const [id, data, seq] of batch) {
        const pane = this.panes.get(id);
        if (pane instanceof TerminalPane) pane.write(data, seq);
      }
    });
    this.api.onTerminalUpdate((snapshot) => {
      const pane = this.panes.get(snapshot.id);
      const renamed = pane instanceof TerminalPane && pane.name !== snapshot.name;
      if (pane instanceof TerminalPane) pane.update(snapshot);
      this.trackAttention(snapshot);
      // O 🔗 das notas e listas mostra o nome do terminal.
      if (renamed) this.refreshLinks();
    });
    this.api.onTerminalClose((id) => this.removePane(id));
    this.api.onUsageUpdate((summary) => this.applyUsageSummary(summary));

    // Voltar para a janela ja conta como "vi o terminal em foco".
    window.addEventListener('focus', () => {
      if (this.focusedId) this.acknowledge(this.focusedId);
    });

    window.addEventListener('resize', () => {
      for (const pane of this.board.visiblePanes()) pane.refit();
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Alt') document.body.classList.add('show-indexes');
      const shortcut = matchShortcut(event, this.isTypingInTerminal(event));
      if (!shortcut) return;
      event.preventDefault();
      this.runShortcut(shortcut);
    });
    // Segurar Alt mostra o numero de cada painel (Alt+N vai direto para ele).
    const hideIndexes = () => document.body.classList.remove('show-indexes');
    window.addEventListener('keyup', (event) => {
      if (event.key === 'Alt') hideIndexes();
    });
    window.addEventListener('blur', hideIndexes);
  }

  private runShortcut(shortcut: Shortcut): void {
    switch (shortcut.kind) {
      case 'new-terminal': return void this.promptNewTerminal();
      case 'new-note': return void this.createNote();
      case 'new-task-list': return void this.createTaskList();
      case 'settings': return void this.openSettings();
      case 'palette': return void this.openCommandPalette();
      case 'next-attention': return this.goToNextAttention();
      case 'focus-index': return this.goTo(this.order[shortcut.index]);
      case 'focus-step': return this.stepFocus(shortcut.delta);
      case 'close-pane':
        if (this.focusedId) void this.closePane(this.focusedId);
        return;
      case 'maximize-pane':
        if (this.focusedId) this.board.toggleMaximize(this.focusedId);
        return;
    }
  }

  /** Traz o painel para a tela (pagina/vista) e da foco a ele. */
  private goTo(id: string | undefined): void {
    if (!id || !this.panes.has(id)) return;
    this.board.revealPane(id);
    this.focus(id);
  }

  private stepFocus(delta: 1 | -1): void {
    if (this.order.length === 0) return;
    const current = this.focusedId ? this.order.indexOf(this.focusedId) : -1;
    const next = current < 0
      ? (delta > 0 ? 0 : this.order.length - 1)
      : (current + delta + this.order.length) % this.order.length;
    this.goTo(this.order[next]);
  }

  private async openCommandPalette(): Promise<void> {
    if (this.dialogOpen) return;
    this.dialogOpen = true;
    const items: PaletteItem[] = this.order.map((id, index) => {
      const pane = this.panes.get(id)!;
      return {
        label: paneLabel(pane),
        detail: paneDetail(pane),
        hint: index < 9 ? `Alt+${index + 1}` : undefined,
        attention: this.attention.has(id),
        run: () => this.goTo(id),
      };
    });
    const focused = this.focusedId;
    items.push(
      { label: 'Novo terminal', hint: 'Ctrl+Shift+T', run: () => void this.promptNewTerminal() },
      { label: 'Nova nota', hint: 'Ctrl+Shift+N', run: () => void this.createNote() },
      { label: 'Nova lista de tarefas', hint: 'Ctrl+Shift+L', run: () => void this.createTaskList() },
    );
    if (this.attention.size > 0) {
      items.push({ label: 'Proximo terminal aguardando', hint: 'Ctrl+Shift+A', attention: true, run: () => this.goToNextAttention() });
    }
    if (focused) {
      items.push(
        { label: 'Maximizar / restaurar painel em foco', hint: 'Ctrl+Shift+M', run: () => this.board.toggleMaximize(focused) },
        { label: 'Fechar painel em foco', hint: 'Ctrl+Shift+W', run: () => void this.closePane(focused) },
      );
    }
    items.push(...this.templateItems());
    for (const template of this.templates) {
      items.push({ label: `Apagar template: ${template.name}`, run: () => void this.deleteTemplate(template) });
    }
    const focusedPane = focused ? this.panes.get(focused) : undefined;
    if (focusedPane instanceof TerminalPane) {
      items.push({ label: `Cor de "${focusedPane.name}"`, run: () => void focusedPane.pickColor() });
      if (focusedPane.info.worktree) {
        items.push({ label: `Fechar "${focusedPane.name}" e remover o worktree`, run: () => void this.closePane(focusedPane.id) });
      }
    }
    if (focusedPane instanceof NotePane || focusedPane instanceof TaskPane) {
      items.push({ label: `Vincular "${paneLabel(focusedPane)}" a um terminal`, run: () => void this.pickLink(focusedPane.id) });
    }
    if (this.pendingTerminals.length > 0) {
      items.push({ label: `Restaurar sessao anterior (${this.pendingTerminals.length})`, run: () => void this.restoreSession() });
    }
    if (this.layout === 'free') {
      items.push({ label: 'Novo grupo na area livre', run: () => void this.canvas.createGroup() });
    }
    for (const layout of LAYOUT_NAMES) {
      items.push({ label: `Layout: ${layout.name}`, run: () => this.setLayout(layout.id) });
    }
    items.push({ label: 'Configuracoes', hint: 'Ctrl+,', run: () => void this.openSettings() });

    let chosen: PaletteItem | null = null;
    try {
      chosen = await openPalette(items, 'Ir para um painel ou executar um comando…');
    } finally {
      this.dialogOpen = false;
    }
    chosen?.run();
    // Fechou sem escolher (Esc): o foco volta para onde estava.
    if (this.focusedId === focused && focused) this.panes.get(focused)?.focus();
  }

  /**
   * Manda texto de uma nota/tarefa ao terminal vinculado a ela. Sem vinculo
   * (ou com `pick`), pergunta qual — e a escolha vira o vinculo. Devolve o
   * nome do terminal, ou `null` se nao mandou.
   */
  private async sendToTerminal(sourceId: string, text: string, pick: boolean): Promise<string | null> {
    const source = this.panes.get(sourceId);
    if (!(source instanceof NotePane || source instanceof TaskPane)) return null;
    const linked = source.terminalId ? this.panes.get(source.terminalId) : undefined;
    let target = linked instanceof TerminalPane && !pick ? linked : null;
    if (!target) {
      const terminals = this.terminalPanes();
      if (terminals.length === 0) {
        window.alert('Nenhum terminal aberto para receber o texto.');
        return null;
      }
      target = await this.pickTerminal(terminals, `Enviar para (e vincular "${paneLabel(source)}" a) qual terminal?`);
      if (!target) return null;
      this.setLink(source.id, target.id);
    }
    target.send(text);
    return target.name;
  }

  /** Clique no 🔗 (ou paleta): escolher o terminal, ou remover o vinculo. */
  private async pickLink(sourceId: string): Promise<void> {
    const source = this.panes.get(sourceId);
    if (!(source instanceof NotePane || source instanceof TaskPane) || this.dialogOpen) return;
    const current = source.terminalId;
    const items: PaletteItem[] = this.terminalPanes().map((pane) => ({
      label: pane.name,
      detail: (pane.id === current ? '✓ vinculado · ' : '') + paneDetail(pane),
      attention: this.attention.has(pane.id),
      run: () => this.setLink(sourceId, pane.id),
    }));
    if (current) items.push({ label: 'Remover vinculo', run: () => this.setLink(sourceId, null) });
    if (items.length === 0) {
      window.alert('Nenhum terminal aberto para vincular.');
      return;
    }
    this.dialogOpen = true;
    let chosen: PaletteItem | null = null;
    try {
      chosen = await openPalette(items, `Vincular "${paneLabel(source)}" a qual terminal?`);
    } finally {
      this.dialogOpen = false;
    }
    chosen?.run();
    source.focus();
  }

  /**
   * Mousedown no 🔗: soltar sem mexer e um clique (abre a lista); arrastar
   * puxa uma linha que vincula ao terminal onde for solta.
   */
  private beginLinkGesture(sourceId: string, start: MouseEvent): void {
    const chip = (start.currentTarget as HTMLElement).getBoundingClientRect();
    const from = { x: chip.left + chip.width / 2, y: chip.top + chip.height / 2 };
    let dragging = false;
    let hover: TerminalPane | null = null;

    const setHover = (pane: TerminalPane | null) => {
      if (pane === hover) return;
      hover?.element.classList.remove('link-target');
      hover = pane;
      hover?.element.classList.add('link-target');
    };
    const move = (event: MouseEvent) => {
      if (!dragging && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 5) return;
      dragging = true;
      document.body.classList.add('linking');
      this.links.setDraft(from, { x: event.clientX, y: event.clientY });
      setHover(this.terminalAt(event.clientX, event.clientY));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('linking');
      this.links.setDraft(null);
      const target = hover;
      setHover(null);
      if (!dragging) void this.pickLink(sourceId);
      else if (target) this.setLink(sourceId, target.id);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  private terminalAt(x: number, y: number): TerminalPane | null {
    const node = document.elementFromPoint(x, y)?.closest<HTMLElement>('.pane');
    const pane = node?.dataset.id ? this.panes.get(node.dataset.id) : undefined;
    return pane instanceof TerminalPane ? pane : null;
  }

  private setLink(sourceId: string, terminalId: string | null): void {
    const source = this.panes.get(sourceId);
    if (!(source instanceof NotePane || source instanceof TaskPane)) return;
    source.setLink(terminalId);
    this.refreshLinks();
  }

  /** Atualiza o 🔗 de todas as notas e listas (nome do terminal, aberto ou nao). */
  private refreshLinks(): void {
    for (const source of this.linkSources()) {
      source.showLink(source.terminalId ? this.linkLabel(source.terminalId) : null);
    }
  }

  private linkLabel(terminalId: string): LinkLabel | null {
    const pane = this.panes.get(terminalId);
    if (pane instanceof TerminalPane) return { name: pane.name, open: true };
    const saved = this.pendingTerminals.find((t) => t.id === terminalId);
    return saved ? { name: saved.name || shortenPath(saved.cwd), open: false } : null;
  }

  /**
   * Para a camada de linhas: cada nota/lista vinculada a um terminal aberto.
   * So na area livre — na grade os paineis sao vizinhos fixos e a linha
   * cruzaria o conteudo; la o 🔗 com o nome basta.
   */
  private linkPairs(): LinkPair[] {
    if (this.layout !== 'free') return [];
    const pairs: LinkPair[] = [];
    for (const source of this.linkSources()) {
      const target = source.terminalId ? this.panes.get(source.terminalId) : undefined;
      if (!(target instanceof TerminalPane)) continue;
      const { notice, needsAttention, color } = target.info;
      pairs.push({
        from: source.element,
        to: target.element,
        tone: notice ? 'notice' : needsAttention ? 'attention' : 'normal',
        ...(color ? { color: paneColorVar(color) } : {}),
      });
    }
    return pairs;
  }

  private linkSources(): Array<NotePane | TaskPane> {
    return [...this.panes.values()].filter((pane): pane is NotePane | TaskPane =>
      pane instanceof NotePane || pane instanceof TaskPane);
  }

  private terminalPanes(): TerminalPane[] {
    return this.order
      .map((id) => this.panes.get(id))
      .filter((pane): pane is TerminalPane => pane instanceof TerminalPane);
  }

  /** Paleta so com os terminais; devolve o escolhido (`null` se cancelar). */
  private async pickTerminal(terminals: TerminalPane[], placeholder: string): Promise<TerminalPane | null> {
    if (this.dialogOpen) return null;
    const origin = this.focusedId;
    const chosen: { pane: TerminalPane | null } = { pane: null };
    this.dialogOpen = true;
    try {
      const item = await openPalette(terminals.map((pane) => ({
        label: pane.name,
        detail: paneDetail(pane),
        attention: this.attention.has(pane.id),
        run: () => {
          chosen.pane = pane;
        },
      })), placeholder);
      item?.run();
    } finally {
      this.dialogOpen = false;
    }
    // Quem pediu o envio (nota/lista) continua com o foco.
    if (origin) this.panes.get(origin)?.focus();
    return chosen.pane;
  }

  /**
   * Ctrl+T dentro do xterm pertence ao shell/agente; so intercepta quando o
   * foco nao esta em um terminal.
   */
  private isTypingInTerminal(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return Boolean(target?.closest('.pane-body:not(.note-body):not(.tasks-body)'));
  }

  private async promptNewTerminal(initial?: TerminalTemplate): Promise<void> {
    if (this.dialogOpen) return;
    this.dialogOpen = true;
    try {
      const result = await openNewTerminalDialog(this.api, {
        recentDirs: this.recentDirs,
        defaultDir: this.defaultDir,
        recentCommands: this.recentCommands,
        templates: this.templates,
        ...(initial ? { initial } : {}),
      });
      if (!result) return;
      const snapshot = await this.openTerminal(result.spec, result.worktreeBranch);
      if (snapshot && result.saveAsTemplate) {
        // Sem nome digitado, o template leva o nome que o terminal ganhou.
        // Com worktree, guarda o diretorio escolhido, nao a pasta criada.
        this.templates = await this.api.saveTemplate({
          name: snapshot.name,
          cwd: snapshot.worktree ? result.spec.cwd : snapshot.cwd,
          command: snapshot.command ?? '',
          color: snapshot.color,
          worktree: snapshot.worktree !== null,
        });
      }
    } finally {
      this.dialogOpen = false;
    }
  }

  /** Cria o terminal; `null` se o main recusar (ex.: o git nao criou o worktree). */
  private async openTerminal(spec: TerminalSpec, worktreeBranch: string | null = null): Promise<TerminalSnapshot | null> {
    let snapshot: TerminalSnapshot;
    try {
      snapshot = await this.api.createTerminal(spec, worktreeBranch ?? undefined);
    } catch (error) {
      window.alert(`Nao foi possivel abrir o terminal:\n${ipcErrorMessage(error)}`);
      return null;
    }
    this.rememberDir(snapshot.worktree ? snapshot.worktree.repo : snapshot.cwd);
    if (snapshot.command) {
      this.recentCommands = [snapshot.command, ...this.recentCommands.filter((c) => c !== snapshot.command)].slice(0, 8);
    }
    this.addTerminal(snapshot);
    this.showNew(snapshot.id);
    return snapshot;
  }

  /** Um item de paleta por template: abre o terminal direto, sem dialogo. */
  private templateItems(): PaletteItem[] {
    return this.templates.map((template) => ({
      label: `Novo: ${template.name}`,
      detail: shortenPath(template.cwd) + (template.command ? ` · ${template.command}` : ''),
      // Com worktree falta a branch: o dialogo abre preenchido, pedindo so ela.
      run: () => void (template.worktree
        ? this.promptNewTerminal(template)
        : this.openTerminal({ name: template.name, cwd: template.cwd, command: template.command, color: template.color })),
    }));
  }

  /** O ▾ ao lado de "+ Terminal": so os templates. Sem nenhum, vai ao dialogo. */
  private async openTemplates(): Promise<void> {
    if (this.dialogOpen) return;
    if (this.templates.length === 0) {
      await this.promptNewTerminal();
      return;
    }
    this.dialogOpen = true;
    let chosen: PaletteItem | null = null;
    try {
      chosen = await openPalette(
        [...this.templateItems(), { label: 'Outro terminal…', hint: 'Ctrl+Shift+T', run: () => void this.promptNewTerminal() }],
        'Abrir um template…',
      );
    } finally {
      this.dialogOpen = false;
    }
    chosen?.run();
  }

  private async deleteTemplate(template: TerminalTemplate): Promise<void> {
    if (!window.confirm(`Apagar o template "${template.name}"?`)) return;
    this.templates = await this.api.deleteTemplate(template.id);
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
    this.links.setEnabled(settings.showLinks);
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
    const worktree = pane instanceof TerminalPane ? pane.info.worktree : null;
    await this.api.closeTerminal(id);
    if (worktree) await this.offerWorktreeRemoval(worktree);
  }

  /**
   * Fechou um terminal num worktree: pergunta se apaga a pasta. A branch
   * sempre fica. Outro terminal ainda no mesmo worktree: nem pergunta.
   */
  private async offerWorktreeRemoval(worktree: WorktreeInfo): Promise<void> {
    if (this.terminalPanes().some((pane) => pane.info.worktree?.path === worktree.path)) return;
    let dirty: boolean;
    try {
      dirty = await this.api.worktreeDirty(worktree);
    } catch {
      return; // pasta ja removida por fora
    }
    const where = `${worktree.branch} (${shortenPath(worktree.path)})`;
    const question = dirty
      ? `O worktree ${where} tem mudancas NAO commitadas.\n\nRemover a pasta mesmo assim? As mudancas serao perdidas; a branch continua no repositorio.`
      : `Remover tambem o worktree ${where}?\n\nA pasta e apagada; a branch continua no repositorio.`;
    if (!window.confirm(question)) return;
    try {
      await this.api.removeWorktree(worktree, dirty);
    } catch (error) {
      window.alert(`Nao foi possivel remover o worktree:\n${ipcErrorMessage(error)}`);
    }
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
      this.goTo(id);
      return;
    }
  }

  private addTerminal(snapshot: TerminalSnapshot, rect: CanvasRect | null = null): void {
    const pane = new TerminalPane(snapshot, this.api, this.paneCallbacks(), this.settings, rect);
    this.addPane(pane);
    this.applyUsage(pane);
  }

  private applyUsageSummary(summary: UsageSummary): void {
    this.usageBySession = summary.bySession;
    for (const pane of this.terminalPanes()) this.applyUsage(pane);
  }

  private applyUsage(pane: TerminalPane): void {
    const session = pane.info.claudeSession;
    pane.setUsage((session && this.usageBySession[session]) || null);
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
      onSend: (sourceId: string, text: string, pick: boolean) => this.sendToTerminal(sourceId, text, pick),
      onLinkGesture: (sourceId: string, event: MouseEvent) => this.beginLinkGesture(sourceId, event),
      onLinkPick: (sourceId: string) => void this.pickLink(sourceId),
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
    // Terminal fechado de vez: quem estava vinculado a ele fica sem vinculo.
    if (pane instanceof TerminalPane) {
      for (const source of this.linkSources()) if (source.terminalId === id) source.setLink(null);
      this.refreshLinks();
    }
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
    this.order.forEach((id, index) => {
      const header = this.panes.get(id)?.header;
      if (!header) return;
      if (index < 9) header.dataset.index = String(index + 1);
      else delete header.dataset.index;
    });
    this.updatePaging();
  }
}

const LAYOUT_NAMES: Array<{ id: LayoutId; name: string }> = [
  { id: '1', name: '1 painel' },
  { id: '2', name: '2 lado a lado' },
  { id: '3', name: '3 paineis' },
  { id: '4', name: 'grade 2x2' },
  { id: '6', name: 'grade 3x2' },
  { id: '8', name: 'grade 4x2' },
  { id: 'free', name: 'area livre' },
];

function paneLabel(pane: Panel): string {
  if (pane instanceof TerminalPane) return pane.name;
  return pane.header.querySelector('.pane-name')?.textContent || 'painel';
}

/** O Electron embrulha o erro do main: "Error invoking remote method 'x': Error: <mensagem>". */
function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
}

function paneDetail(pane: Panel): string {
  if (pane instanceof TerminalPane) {
    const { notice } = pane.info;
    if (notice) return `🔔 ${notice}`;
    const usage = pane.usageText;
    return `terminal · ${terminalPlace(pane.info)}${usage ? ` · ${usage}` : ''}`;
  }
  if (pane instanceof NotePane) return 'nota';
  if (pane instanceof TaskPane) return 'tarefas';
  return '';
}
