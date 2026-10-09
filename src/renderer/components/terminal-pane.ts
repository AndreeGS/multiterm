import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import type { TerminalSnapshot } from '../../domain/terminal/types.js';
import { totalTokens, type UsageTotals } from '../../domain/usage/types.js';
import type { CanvasRect } from '../../domain/workspace/layout.js';
import type { MultiTermApi } from '../../shared/contract.js';
import { shortenPath } from '../paths.js';
import { matchShortcut } from '../shortcuts.js';
import { MIN_CONTRAST, TERMINAL_THEMES, type Appearance } from '../theme.js';
import { openColorMenu, paneColorVar } from './color-menu.js';
import { beginRename, button, el, type Panel } from './panel.js';
import { formatTokens, money } from './usage-bar.js';

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
  private rect: CanvasRect | null;
  private readonly term: Terminal;
  private readonly fit = new FitAddon();
  private readonly dot: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly cwdEl: HTMLElement;
  private readonly maximizeBtn: HTMLButtonElement;
  private readonly colorBtn: HTMLButtonElement;
  private readonly usageEl: HTMLElement;
  private usage: UsageTotals | null = null;
  private readonly observer: ResizeObserver;
  private snapshot: TerminalSnapshot;
  /**
   * Output ao vivo que chega antes do replay: fica aqui ate o replay ser
   * escrito, e so entra o que for mais novo que ele. `null` = ja hidratado.
   */
  private early: Array<[data: string, seq: number]> | null = [];
  /** `seq` do ultimo chunk escrito no xterm. */
  private lastSeq = 0;
  private lastSize = { cols: 0, rows: 0 };
  /** Fonte escolhida nas configuracoes e zoom da area livre; o xterm usa o produto. */
  private fontSize: number;
  private scale = 1;
  private sending: Promise<void> = Promise.resolve();

  constructor(
    snapshot: TerminalSnapshot,
    private readonly api: MultiTermApi,
    private readonly callbacks: PaneCallbacks,
    appearance: Appearance,
    rect: CanvasRect | null = null,
  ) {
    this.snapshot = snapshot;
    this.rect = rect;
    this.fontSize = appearance.fontSize;

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
    this.colorBtn = button('●', 'Cor do terminal', () => void this.pickColor());
    this.colorBtn.classList.add('color-btn');
    actions.append(
      this.colorBtn,
      button('■', 'Interromper (Ctrl+C)', () => void this.api.interruptTerminal(this.id)),
      button('⟳', 'Reiniciar shell', () => void this.api.restartTerminal(this.id)),
      this.maximizeBtn,
      button('✕', 'Fechar terminal', () => this.callbacks.onClose(this.id)),
    );

    this.usageEl = el('span', 'pane-usage');
    this.usageEl.hidden = true;

    header.append(this.dot, title, this.usageEl, actions);

    const body = el('div', 'pane-body');
    this.element.append(header, body);
    this.element.addEventListener('mousedown', () => this.callbacks.onFocus(this.id));

    this.term = new Terminal({
      fontFamily: 'ui-monospace, "JetBrains Mono", "Fira Code", Menlo, monospace',
      fontSize: appearance.fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10_000,
      allowProposedApi: true,
      theme: TERMINAL_THEMES[appearance.theme],
      minimumContrastRatio: MIN_CONTRAST[appearance.theme],
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new WebLinksAddon());
    this.term.open(body);

    this.term.onData((data) => this.api.writeTerminal(this.id, data));
    this.term.onResize(({ cols, rows }) => this.api.resizeTerminal(this.id, cols, rows));
    this.term.attachCustomKeyEventHandler((event) => this.handleKey(event));

    this.observer = new ResizeObserver(() => this.refit());
    this.observer.observe(body);

    this.update(snapshot);
    void this.hydrate();
  }

  get id(): string {
    return this.snapshot.id;
  }

  get canvasRect(): CanvasRect | null {
    return this.rect;
  }

  /** A area livre chama isto ao terminar de mover/redimensionar. */
  set canvasRect(rect: CanvasRect | null) {
    this.rect = rect;
    this.api.setTerminalRect(this.id, rect);
  }

  update(snapshot: TerminalSnapshot): void {
    this.snapshot = snapshot;
    this.nameEl.textContent = snapshot.name;
    // Um pedido explicito do agente toma o lugar do diretorio ate voce olhar.
    this.cwdEl.textContent = snapshot.notice ? `🔔 ${snapshot.notice}` : terminalPlace(snapshot);
    this.cwdEl.title = `${snapshot.cwd}  (${snapshot.shell})` +
      (snapshot.worktree ? `\nWorktree da branch ${snapshot.worktree.branch}, de ${snapshot.worktree.repo}` : '') +
      (snapshot.command ? `\nComando inicial: ${snapshot.command}` : '');
    this.dot.dataset.status = snapshot.status;
    this.element.classList.toggle('attention', snapshot.needsAttention);
    this.element.classList.toggle('notice', snapshot.notice !== null);
    this.element.classList.toggle('colored', snapshot.color !== null);
    if (snapshot.color) this.element.style.setProperty('--pane-accent', paneColorVar(snapshot.color));
    else this.element.style.removeProperty('--pane-accent');
    this.dot.title = STATUS_LABEL[snapshot.status] +
      (snapshot.exitCode !== null ? ` (codigo ${snapshot.exitCode})` : '');
  }

  get name(): string {
    return this.snapshot.name;
  }

  get info(): TerminalSnapshot {
    return this.snapshot;
  }

  /**
   * Manda um texto como se voce tivesse digitado e aperta Enter. Varias linhas
   * vao como colagem (bracketed paste quando o programa pede, como o Claude
   * Code), para virarem um prompt so em vez de um Enter por linha.
   */
  send(text: string): void {
    const body = text.replace(/\s+$/, '');
    if (!body) return;
    // Em fila: dois Ctrl+Enter seguidos nao podem intercalar texto e Enter.
    this.sending = this.sending.then(async () => {
      if (!body.includes('\n')) {
        this.api.writeTerminal(this.id, `${body}\r`);
        return;
      }
      this.term.paste(body);
      // TUIs tratam o Enter colado ao fim da colagem como parte dela; um respiro resolve.
      await new Promise((resolve) => setTimeout(resolve, 60));
      this.api.writeTerminal(this.id, '\r');
    });
    this.element.classList.remove('received');
    void this.element.offsetWidth; // reinicia a animacao
    this.element.classList.add('received');
  }

  setMaximized(maximized: boolean): void {
    this.maximizeBtn.textContent = maximized ? '⤡' : '⤢';
  }

  setScale(scale: number): void {
    // Fonte e painel escalam juntos, entao cols/rows quase nao mudam e o
    // shell raramente recebe um resize por causa do zoom.
    this.scale = scale;
    this.applyFontSize();
  }

  setAppearance(appearance: Appearance): void {
    this.term.options.theme = TERMINAL_THEMES[appearance.theme];
    this.term.options.minimumContrastRatio = MIN_CONTRAST[appearance.theme];
    this.fontSize = appearance.fontSize;
    this.applyFontSize();
  }

  private applyFontSize(): void {
    const size = this.fontSize * this.scale;
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

  /**
   * Consumo da conversa do Claude deste terminal (`null` = sem conversa ou
   * nada gravado ainda). Vem do resumo de uso, atualizado a cada minuto.
   */
  setUsage(usage: UsageTotals | null): void {
    this.usage = usage;
    this.usageEl.hidden = usage === null;
    if (!usage) return;
    this.usageEl.textContent = this.usageText ?? '';
    this.usageEl.title =
      `Conversa do Claude neste terminal (${usage.requests} respostas)\n` +
      `entrada ${formatTokens(usage.inputTokens)} · saida ${formatTokens(usage.outputTokens)}\n` +
      `cache: escrita ${formatTokens(usage.cacheWriteTokens)} · leitura ${formatTokens(usage.cacheReadTokens)}\n` +
      'Custo estimado pela tabela publica da API.';
  }

  /** `48k · US$ 0,62`, ou `null` sem consumo. */
  get usageText(): string | null {
    return this.usage ? `${formatTokens(totalTokens(this.usage))} · ${money(this.usage.costUsd)}` : null;
  }

  /** Abre o menu de cores sob o botao ● do cabecalho. */
  async pickColor(): Promise<void> {
    const color = await openColorMenu(this.colorBtn, this.snapshot.color);
    if (color !== undefined) await this.api.setTerminalColor(this.id, color);
    this.focus();
  }

  /** Output ao vivo do pty, roteado pelo App. */
  write(data: string, seq: number): void {
    if (this.early) {
      this.early.push([data, seq]);
      return;
    }
    if (seq <= this.lastSeq) return;
    this.lastSeq = seq;
    this.term.write(data);
  }

  dispose(): void {
    this.observer.disconnect();
    this.term.dispose();
    this.element.remove();
  }

  /** Carrega o output ja produzido antes deste painel existir. */
  private async hydrate(): Promise<void> {
    const replay = await this.api.replayTerminal(this.id);
    if (replay.data) this.term.write(replay.data);
    this.lastSeq = replay.seq;
    const early = this.early ?? [];
    this.early = null;
    // O que chegou enquanto o replay vinha ja pode estar dentro dele.
    for (const [data, seq] of early) this.write(data, seq);
    this.refit();
  }

  private handleKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true;
    // Atalho do app: o xterm nao repassa ao shell, e o App (no window) executa.
    if (matchShortcut(event, true)) return false;
    const mod = event.ctrlKey && event.shiftKey;
    // Ctrl+Shift+C/V: copiar/colar sem colidir com Ctrl+C (SIGINT) do shell.
    if (mod && event.code === 'KeyC') {
      const selection = this.term.getSelection();
      if (selection) void navigator.clipboard.writeText(selection);
      return false;
    }
    if (mod && event.code === 'KeyV') {
      // Sem o preventDefault o Chromium tambem cola nativamente (Ctrl+Shift+V e
      // "colar sem formatacao") no textarea do xterm, e o texto entrava duas vezes.
      event.preventDefault();
      void navigator.clipboard.readText().then((text) => {
        if (text) this.term.paste(text);
      });
      return false;
    }
    return true;
  }
}

/** `~/repo.worktrees/feat-x · ⎇ feat-x · claude`: onde roda, em que branch isolada, o que roda. */
export function terminalPlace(snapshot: TerminalSnapshot): string {
  return shortenPath(snapshot.cwd) +
    (snapshot.worktree ? ` · ⎇ ${snapshot.worktree.branch}` : '') +
    (snapshot.command ? ` · ${snapshot.command}` : '');
}
