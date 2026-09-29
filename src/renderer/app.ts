import type { TerminalSnapshot } from '../domain/terminal/types.js';
import { layoutFor, type LayoutId } from '../domain/workspace/layout.js';
import type { MultiTermApi } from '../shared/contract.js';
import { TerminalGrid } from './components/grid.js';
import { openNewTerminalDialog } from './components/new-terminal-dialog.js';
import { TerminalPane } from './components/terminal-pane.js';
import { Toolbar } from './components/toolbar.js';
import { setHomeDir } from './paths.js';

/**
 * Orquestra a UI: mantem a lista de paineis em sincronia com as sessoes do main
 * e repassa acoes do usuario para a API exposta pelo preload.
 */
export class App {
  private readonly panes = new Map<string, TerminalPane>();
  private readonly order: string[] = [];
  private readonly toolbar: Toolbar;
  private readonly grid: TerminalGrid;
  private readonly emptyState = document.createElement('div');
  private recentDirs: string[] = [];
  private defaultDir = '';
  private focusedId: string | null = null;
  private readonly attention = new Set<string>();
  private dialogOpen = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly api: MultiTermApi,
    layout: LayoutId,
  ) {
    this.toolbar = new Toolbar({
      onNewTerminal: () => void this.promptNewTerminal(),
      onLayout: (next) => this.setLayout(next),
      onPage: (delta) => this.grid.setPage(this.grid.currentPage + delta),
      onNextAttention: () => this.goToNextAttention(),
    }, api);

    this.grid = new TerminalGrid(layout, () => {
      this.toolbar.setPaging(this.grid.currentPage, this.grid.pageCount);
    });

    const wrap = document.createElement('div');
    wrap.className = 'grid-wrap';
    this.emptyState.className = 'empty';
    this.emptyState.innerHTML =
      '<div>Nenhum terminal aberto.</div><div><kbd>Ctrl</kbd>+<kbd>T</kbd> para criar o primeiro.</div>';
    wrap.append(this.emptyState, this.grid.element);

    this.root.append(this.toolbar.element, wrap);
    this.toolbar.setLayout(layout);

    this.bindGlobalEvents();
  }

  async start(): Promise<void> {
    const state = await this.api.bootstrap();
    this.recentDirs = state.recentDirs;
    this.defaultDir = state.defaultDir;
    setHomeDir(state.homeDir);
    this.applyLayout(state.layout);
    for (const snapshot of state.terminals) {
      this.addPane(snapshot);
      this.trackAttention(snapshot);
    }
    this.sync();
  }

  private bindGlobalEvents(): void {
    this.api.onTerminalUpdate((snapshot) => {
      this.panes.get(snapshot.id)?.update(snapshot);
      this.trackAttention(snapshot);
    });
    this.api.onTerminalClose((id) => this.removePane(id));

    // Voltar para a janela ja conta como "vi o terminal em foco".
    window.addEventListener('focus', () => {
      if (this.focusedId) this.acknowledge(this.focusedId);
    });

    window.addEventListener('resize', () => {
      for (const pane of this.grid.visiblePanes()) pane.refit();
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
      if (event.shiftKey && key === 'w' && this.focusedId) {
        event.preventDefault();
        void this.api.closeTerminal(this.focusedId);
        return;
      }
      if (event.shiftKey && key === 'm' && this.focusedId) {
        event.preventDefault();
        this.grid.toggleMaximize(this.focusedId);
      }
    });
  }

  /**
   * Ctrl+T dentro do xterm pertence ao shell/agente; so intercepta quando o
   * foco nao esta em um terminal.
   */
  private isTypingInTerminal(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return Boolean(target?.closest('.pane-body'));
  }

  private async promptNewTerminal(): Promise<void> {
    if (this.dialogOpen) return;
    this.dialogOpen = true;
    try {
      const spec = await openNewTerminalDialog(this.api, this.recentDirs, this.defaultDir);
      if (!spec) return;
      const snapshot = await this.api.createTerminal(spec);
      this.rememberDir(snapshot.cwd);
      this.addPane(snapshot);
      // Cresce o layout automaticamente ate caber, sem passar do escolhido.
      const needed = layoutFor(this.order.length);
      if (Number(needed) > Number(this.grid.currentLayout)) this.setLayout(needed);
      this.sync();
      this.focus(snapshot.id);
    } finally {
      this.dialogOpen = false;
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
      this.grid.revealPane(id);
      this.focus(id);
      return;
    }
  }

  private addPane(snapshot: TerminalSnapshot): void {
    const pane = new TerminalPane(snapshot, this.api, {
      onFocus: (id) => this.focus(id),
      onClose: (id) => void this.api.closeTerminal(id),
      onMaximize: (id) => {
        this.grid.toggleMaximize(id);
        this.focus(id);
      },
    });
    this.panes.set(snapshot.id, pane);
    this.order.push(snapshot.id);
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
    this.grid.setLayout(layout);
    this.toolbar.setLayout(layout);
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

  private sync(): void {
    this.grid.setPanes(this.order.map((id) => this.panes.get(id)!).filter(Boolean));
    const hasPanes = this.order.length > 0;
    this.emptyState.hidden = hasPanes;
    this.grid.element.hidden = !hasPanes;
  }
}
