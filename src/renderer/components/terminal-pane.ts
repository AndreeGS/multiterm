import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import type { TerminalSnapshot } from '../../domain/terminal/types.js';
import type { CanvasRect } from '../../domain/workspace/layout.js';
import type { MultiTermApi } from '../../shared/contract.js';
import { shortenPath } from '../paths.js';
import { beginRename, button, el, type Panel } from './panel.js';

const FONT_SIZE = 12;

const STATUS_LABEL: Record<TerminalSnapshot['status'], string> = {
  starting: 'iniciando',
  running: 'executando',
  idle: 'aguardando',
  exited: 'finalizado',
  error: 'erro',
};

export interface PaneCallbacks {
  onFocus(id: string): void;
  onMaximize(id: string): void;
  onClose(id: string): void;
}

/**
 * Um painel = cabecalho + instancia de xterm ligada a uma sessao do main.
 * O elemento raiz sobrevive a mudancas de layout: a grade apenas o reposiciona,
 * de modo que o scrollback nunca e perdido.
 */
export class TerminalPane implements Panel {
  readonly element: HTMLElement;
  readonly header: HTMLElement;
  /** Terminais nao sao persistidos, entao a posicao na area livre fica so em memoria. */
  canvasRect: CanvasRect | null = null;
  private readonly term: Terminal;
  private readonly fit = new FitAddon();
  private readonly dot: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly cwdEl: HTMLElement;
  private readonly maximizeBtn: HTMLButtonElement;
  private readonly observer: ResizeObserver;
  private readonly unsubscribe: Array<() => void> = [];
  private snapshot: TerminalSnapshot;
  private lastSize = { cols: 0, rows: 0 };

  constructor(
    snapshot: TerminalSnapshot,
    private readonly api: MultiTermApi,
    private readonly callbacks: PaneCallbacks,
  ) {
    this.snapshot = snapshot;

    this.element = el('div', 'pane');
    this.element.dataset.id = snapshot.id;

    const header = (this.header = el('div', 'pane-header'));
    this.dot = el('span', 'status-dot');
    this.nameEl = el('div', 'pane-name');
    this.cwdEl = el('div', 'pane-cwd');

    const title = el('div', 'pane-title');
    title.append(this.nameEl, this.cwdEl);
    title.title = 'Duplo clique para renomear';
    title.addEventListener('dblclick', () =>
      beginRename(this.nameEl, this.snapshot.name, (name) => void this.api.renameTerminal(this.id, name)),
    );

    const actions = el('div', 'pane-actions');
    this.maximizeBtn = button('⤢', 'Maximizar / restaurar', () =>
      this.callbacks.onMaximize(this.id),
    );
    actions.append(
      button('■', 'Interromper (Ctrl+C)', () => void this.api.interruptTerminal(this.id)),
      button('⟳', 'Reiniciar shell', () => void this.api.restartTerminal(this.id)),
      this.maximizeBtn,
      button('✕', 'Fechar terminal', () => this.callbacks.onClose(this.id)),
    );

    header.append(this.dot, title, actions);

    const body = el('div', 'pane-body');
    this.element.append(header, body);
    this.element.addEventListener('mousedown', () => this.callbacks.onFocus(this.id));

    this.term = new Terminal({
      fontFamily: 'ui-monospace, "JetBrains Mono", "Fira Code", Menlo, monospace',
      fontSize: FONT_SIZE,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10_000,
      allowProposedApi: true,
      theme: {
        background: '#151822',
        foreground: '#d5d9e4',
        cursor: '#6ea8fe',
        selectionBackground: '#2b4a8f',
      },
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new WebLinksAddon());
    this.term.open(body);

    this.term.onData((data) => this.api.writeTerminal(this.id, data));
    this.term.onResize(({ cols, rows }) => this.api.resizeTerminal(this.id, cols, rows));
    this.term.attachCustomKeyEventHandler((event) => this.handleKey(event));

    this.observer = new ResizeObserver(() => this.refit());
    this.observer.observe(body);

    this.unsubscribe.push(
      this.api.onTerminalData((id, chunk) => {
        if (id === this.id) this.term.write(chunk);
      }),
    );

    this.update(snapshot);
    void this.hydrate();
  }

  get id(): string {
    return this.snapshot.id;
  }

  update(snapshot: TerminalSnapshot): void {
    this.snapshot = snapshot;
    this.nameEl.textContent = snapshot.name;
    this.cwdEl.textContent = shortenPath(snapshot.cwd);
    this.cwdEl.title = `${snapshot.cwd}  (${snapshot.shell})`;
    this.dot.dataset.status = snapshot.status;
    this.element.classList.toggle('attention', snapshot.needsAttention);
    this.dot.title = STATUS_LABEL[snapshot.status] +
      (snapshot.exitCode !== null ? ` (codigo ${snapshot.exitCode})` : '');
  }

  setMaximized(maximized: boolean): void {
    this.maximizeBtn.textContent = maximized ? '⤡' : '⤢';
  }

  setScale(scale: number): void {
    // Fonte e painel escalam juntos, entao cols/rows quase nao mudam e o
    // shell raramente recebe um resize por causa do zoom.
    const size = FONT_SIZE * scale;
    if (this.term.options.fontSize === size) return;
    this.term.options.fontSize = size;
    this.refit();
  }

  setFocused(focused: boolean): void {
    this.element.classList.toggle('focused', focused);
  }

  focus(): void {
    this.term.focus();
  }

  /** Reajusta o xterm ao tamanho do painel; chamado em resize e troca de layout. */
  refit(): void {
    if (!this.element.isConnected || this.element.clientHeight === 0) return;
    try {
      this.fit.fit();
    } catch {
      // painel ainda sem dimensoes (durante a montagem)
      return;
    }
    const { cols, rows } = this.term;
    if (cols !== this.lastSize.cols || rows !== this.lastSize.rows) {
      this.lastSize = { cols, rows };
      this.api.resizeTerminal(this.id, cols, rows);
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.observer.disconnect();
    this.term.dispose();
    this.element.remove();
  }

  /** Carrega o output ja produzido antes deste painel existir. */
  private async hydrate(): Promise<void> {
    const buffered = await this.api.replayTerminal(this.id);
    if (buffered) this.term.write(buffered);
    this.refit();
  }

  private handleKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true;
    const mod = event.ctrlKey && event.shiftKey;
    // Ctrl+Shift+C/V: copiar/colar sem colidir com Ctrl+C (SIGINT) do shell.
    if (mod && event.code === 'KeyC') {
      const selection = this.term.getSelection();
      if (selection) void navigator.clipboard.writeText(selection);
      return false;
    }
    if (mod && event.code === 'KeyV') {
      void navigator.clipboard.readText().then((text) => {
        if (text) this.api.writeTerminal(this.id, text);
      });
      return false;
    }
    return true;
  }
}
