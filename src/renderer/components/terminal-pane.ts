import { ClipboardAddon } from '@xterm/addon-clipboard';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import { describeStatus, formatStatus, type WorktreeStatus } from '../../domain/git/worktree.js';
import type { TerminalSnapshot } from '../../domain/terminal/types.js';
import { totalTokens, type UsageTotals } from '../../domain/usage/types.js';
import type { CanvasRect } from '../../domain/workspace/layout.js';
import type { MultiTermApi } from '../../shared/contract.js';
import { shortenPath } from '../paths.js';
import { matchShortcut } from '../shortcuts.js';
import { MIN_CONTRAST, TERMINAL_THEMES, type Appearance } from '../theme.js';
import { openColorMenu, paneColorVar } from './color-menu.js';
import { openContextMenu } from './context-menu.js';
import { openConfirm } from './dialogs.js';
import { beginRename, button, el, type Panel } from './panel.js';
import { formatTokens, money } from './usage-bar.js';

export const STATUS_LABEL: Record<TerminalSnapshot['status'], string> = {
  starting: 'iniciando',
  running: 'executando',
  idle: 'aguardando',
  exited: 'finalizado',
  error: 'erro',
};

/**
 * Terminais com renderizador WebGL ao mesmo tempo. O Chromium derruba o
 * contexto mais antigo acima de ~16; o resto usa o renderizador DOM.
 */
const MAX_WEBGL = 12;
let webglInUse = 0;

/** Espera do tamanho final antes de avisar o pty: cada resize e um SIGWINCH e um redesenho da TUI. */
const PTY_RESIZE_DELAY_MS = 80;
/** Confirmacoes de output desenhado vao agrupadas neste intervalo. */
const ACK_INTERVAL_MS = 50;

/** Destaque das ocorrencias da busca (o addon exige cores #RRGGBB). */
const SEARCH_DECORATIONS = {
  matchBackground: '#6b5410',
  matchBorder: '#c9a227',
  matchOverviewRuler: '#c9a227',
  activeMatchBackground: '#c27c0e',
  activeMatchBorder: '#ffcf4d',
  activeMatchColorOverviewRuler: '#ffcf4d',
};

export interface PaneCallbacks {
  onFocus(id: string): void;
  onMaximize(id: string): void;
  onClose(id: string): void;
  /** Diff do worktree do terminal. */
  onShowDiff(id: string): void;
  /** Abre o diretorio do terminal no editor das configuracoes. */
  onOpenEditor(id: string): void;
}

/** Focar o terminal pede o status do worktree, mas no maximo uma vez neste intervalo. */
const GIT_STATUS_ON_FOCUS_MS = 5000;

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
  private readonly search = new SearchAddon();
  private readonly searchBar: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private readonly searchCount: HTMLElement;
  private readonly dot: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly cwdEl: HTMLElement;
  private readonly maximizeBtn: HTMLButtonElement;
  private readonly colorBtn: HTMLButtonElement;
  private readonly usageEl: HTMLElement;
  private usage: UsageTotals | null = null;
  private readonly gitEl: HTMLButtonElement;
  private gitRequestedAt = 0;
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
  private webgl: WebglAddon | null = null;
  /** Frame agendado para o fit (varios pedidos no mesmo frame viram um). */
  private fitFrame = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bytes ja desenhados ainda nao confirmados ao main (vao juntos, a cada ~50ms). */
  private unacked = 0;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;

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
    title.addEventListener('dblclick', () => this.rename());

    const actions = el('div', 'pane-actions');
    this.maximizeBtn = button('⤢', 'Maximizar / restaurar', () =>
      this.callbacks.onMaximize(this.id),
    );
    this.colorBtn = button('●', 'Cor do terminal', () => void this.pickColor());
    this.colorBtn.classList.add('color-btn');
    actions.append(
      this.colorBtn,
      button('■', 'Interromper (Ctrl+C)', () => void this.api.interruptTerminal(this.id)),
      button('⟳', 'Reiniciar shell', () => void this.restart()),
      this.maximizeBtn,
      button('✕', 'Fechar terminal', () => this.callbacks.onClose(this.id)),
    );

    this.usageEl = el('span', 'pane-usage');
    this.usageEl.hidden = true;
    this.gitEl = button('', 'Ver diff do worktree', () => this.callbacks.onShowDiff(this.id));
    this.gitEl.className = 'pane-git';
    this.gitEl.hidden = true;

    header.append(this.dot, title, this.gitEl, this.usageEl, actions);

    const body = el('div', 'pane-body');
    this.searchInput = el('input', 'search-input');
    this.searchInput.placeholder = 'Buscar no terminal';
    this.searchInput.setAttribute('aria-label', 'Buscar no terminal');
    this.searchCount = el('span', 'search-count');
    this.searchBar = el('div', 'search-bar');
    this.searchBar.hidden = true;
    this.searchBar.append(
      this.searchInput,
      this.searchCount,
      button('↑', 'Anterior (Shift+Enter)', () => this.findNext(true)),
      button('↓', 'Proxima (Enter)', () => this.findNext(false)),
      button('✕', 'Fechar busca (Esc)', () => this.closeSearch()),
    );
    this.searchInput.addEventListener('input', () => this.findNext(false, true));
    this.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.findNext(event.shiftKey);
      else if (event.key === 'Escape') this.closeSearch();
      else return;
      event.preventDefault();
      event.stopPropagation();
    });
    // Flutua sobre o terminal: abrir a busca nao muda o tamanho do pty.
    body.append(this.searchBar);
    this.element.append(header, body);
    this.element.addEventListener('mousedown', () => this.callbacks.onFocus(this.id));

    this.term = new Terminal({
      fontFamily: 'ui-monospace, "JetBrains Mono", "Fira Code", Menlo, monospace',
      fontSize: appearance.fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10_000,
      // A largura Unicode 11 (abaixo) e API proposta do xterm.
      allowProposedApi: true,
      theme: TERMINAL_THEMES[appearance.theme],
      minimumContrastRatio: MIN_CONTRAST[appearance.theme],
      // Links OSC 8 (hyperlinks que o programa imprime). Sem isto o xterm faz
      // window.open() sem URL e nada abre.
      linkHandler: { activate: (_event, uri) => this.api.openExternal(uri) },
    });
    this.term.loadAddon(this.fit);
    // URLs soltas no texto: o handler padrao tambem abriria uma janela vazia.
    this.term.loadAddon(new WebLinksAddon((_event, uri) => this.api.openExternal(uri)));
    this.term.loadAddon(this.search);
    this.search.onDidChangeResults(({ resultIndex, resultCount }) => {
      this.searchCount.textContent = resultCount === 0 ? 'nada' : `${resultIndex + 1}/${resultCount}`;
    });
    // Emoji e caracteres largos com a largura que os agentes (Ink, etc.) assumem.
    this.term.loadAddon(new Unicode11Addon());
    this.term.unicode.activeVersion = '11';
    // OSC 52: o programa pode copiar para a area de transferencia (ex.: o
    // `/copy` de um agente, ou o vim via SSH). Ler nao: qualquer texto
    // impresso no terminal poderia pedir o conteudo copiado de volta.
    this.term.loadAddon(new ClipboardAddon(undefined, {
      readText: () => '',
      writeText: (_selection, text) => navigator.clipboard.writeText(text),
    }));
    this.term.open(body);
    this.loadWebgl();
    body.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.callbacks.onFocus(this.id);
      this.openMenu(event.clientX, event.clientY);
    });

    this.term.onData((data) => this.api.writeTerminal(this.id, data));
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

  get workspaceId(): string {
    return this.snapshot.workspaceId;
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
    // Voce voltou a olhar o terminal: o worktree pode ter mudado por fora (outro editor, git na mao).
    if (this.snapshot.worktree && Date.now() - this.gitRequestedAt > GIT_STATUS_ON_FOCUS_MS) {
      this.gitRequestedAt = Date.now();
      this.api.requestWorktreeStatus(this.id);
    }
  }

  /** `+novos ~alterados ↑frente` do worktree; `null` esconde. */
  setGitStatus(status: WorktreeStatus | null): void {
    this.gitEl.hidden = status === null || !this.snapshot.worktree;
    if (!status) return;
    const text = formatStatus(status);
    this.gitEl.textContent = text || '✓';
    this.gitEl.classList.toggle('dirty', status.changed + status.untracked > 0);
    this.gitEl.classList.toggle('conflict', status.conflicts > 0);
    this.gitEl.title = `⎇ ${this.snapshot.worktree?.branch ?? ''}\n${describeStatus(status)}\n\nClique para ver o diff`;
  }

  /**
   * Reajusta o xterm ao tamanho do painel; chamado em resize e troca de layout.
   * Agendado para o proximo frame: arrastar um divisor dispara dezenas de
   * pedidos, e so o ultimo tamanho importa.
   */
  refit(): void {
    if (this.fitFrame) return;
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = 0;
      this.fitNow();
    });
  }

  private fitNow(): void {
    if (!this.element.isConnected || this.element.clientHeight === 0) return;
    try {
      this.fit.fit();
    } catch {
      // painel ainda sem dimensoes (durante a montagem)
      return;
    }
    const { cols, rows } = this.term;
    if (cols === this.lastSize.cols && rows === this.lastSize.rows) return;
    this.lastSize = { cols, rows };
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      this.api.resizeTerminal(this.id, this.lastSize.cols, this.lastSize.rows);
    }, PTY_RESIZE_DELAY_MS);
  }

  /** GPU quando ha contexto sobrando; se o contexto se perder, volta ao DOM. */
  private loadWebgl(): void {
    if (webglInUse >= MAX_WEBGL) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => this.disposeWebgl());
      this.term.loadAddon(addon);
      this.webgl = addon;
      webglInUse++;
    } catch {
      // sem WebGL (GPU bloqueada, --disable-gpu): fica no renderizador DOM
    }
  }

  private disposeWebgl(): void {
    if (!this.webgl) return;
    const addon = this.webgl;
    this.webgl = null;
    webglInUse--;
    try {
      addon.dispose();
    } catch {
      // contexto ja perdido
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
    if (seq <= this.lastSeq) {
      this.ack(data.length);
      return;
    }
    this.lastSeq = seq;
    this.term.write(data, () => this.ack(data.length));
  }

  /** Controle de fluxo: o main pausa o pty se o xterm ficar muito para tras. */
  private ack(bytes: number): void {
    this.unacked += bytes;
    this.ackTimer ??= setTimeout(() => {
      this.ackTimer = null;
      const total = this.unacked;
      this.unacked = 0;
      this.api.ackOutput(this.id, total);
    }, ACK_INTERVAL_MS);
  }

  dispose(): void {
    this.observer.disconnect();
    if (this.fitFrame) cancelAnimationFrame(this.fitFrame);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    if (this.ackTimer) clearTimeout(this.ackTimer);
    // O terminal pode seguir vivo sem este painel: nao deixa o pty pausado.
    if (this.unacked > 0) this.api.ackOutput(this.id, this.unacked);
    this.disposeWebgl();
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

  /** Barra de busca no scrollback (Ctrl+Shift+F); ja aberta, so volta o foco a ela. */
  openSearch(): void {
    this.searchBar.hidden = false;
    const selection = this.term.getSelection();
    if (selection && !selection.includes('\n')) this.searchInput.value = selection;
    this.searchInput.focus();
    this.searchInput.select();
    if (this.searchInput.value) this.findNext(false, true);
  }

  private closeSearch(): void {
    this.searchBar.hidden = true;
    this.search.clearDecorations();
    this.searchCount.textContent = '';
    this.term.focus();
  }

  private findNext(backwards: boolean, incremental = false): void {
    const query = this.searchInput.value;
    if (!query) {
      this.search.clearDecorations();
      this.searchCount.textContent = '';
      return;
    }
    const options = { incremental, decorations: SEARCH_DECORATIONS };
    if (backwards) this.search.findPrevious(query, options);
    else this.search.findNext(query, options);
  }

  /** Reiniciar mata o que estiver rodando: com um programa aberto, pergunta antes. */
  async restart(): Promise<void> {
    const busy = await this.api.busyProgram(this.id);
    if (busy && !await openConfirm({
      title: `Reiniciar "${this.snapshot.name}"?`,
      message: `${busy} ainda esta rodando neste terminal e sera encerrado.`,
      confirmLabel: 'Reiniciar',
      danger: true,
    })) return;
    await this.api.restartTerminal(this.id);
  }

  private openMenu(x: number, y: number): void {
    const selection = this.term.getSelection();
    openContextMenu(x, y, [
      { label: 'Copiar', hint: 'Ctrl+Shift+C', disabled: !selection, run: () => void navigator.clipboard.writeText(selection) },
      { label: 'Colar', hint: 'Ctrl+Shift+V', run: () => void this.pasteClipboard() },
      { label: 'Selecionar tudo', run: () => this.term.selectAll() },
      null,
      { label: 'Buscar…', hint: 'Ctrl+Shift+F', run: () => this.openSearch() },
      { label: 'Limpar tela', run: () => this.term.clear() },
      null,
      { label: 'Renomear', run: () => this.rename() },
      { label: 'Cor…', run: () => void this.pickColor() },
      { label: 'Interromper (Ctrl+C)', run: () => void this.api.interruptTerminal(this.id) },
      { label: 'Reiniciar shell', run: () => void this.restart() },
      null,
      ...(this.snapshot.worktree ? [{ label: 'Ver diff do worktree', run: () => this.callbacks.onShowDiff(this.id) }] : []),
      { label: 'Abrir no editor', run: () => this.callbacks.onOpenEditor(this.id) },
      null,
      { label: 'Fechar terminal', hint: 'Ctrl+Shift+W', danger: true, run: () => this.callbacks.onClose(this.id) },
    ]);
  }

  rename(): void {
    beginRename(this.nameEl, this.snapshot.name, (name) => void this.api.renameTerminal(this.id, name), () => this.focus());
  }

  private async pasteClipboard(): Promise<void> {
    const text = await navigator.clipboard.readText();
    if (text) this.term.paste(text);
    this.term.focus();
  }

  private handleKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true;
    // Atalho do app: o xterm nao repassa ao shell, e o App (no window) executa.
    if (matchShortcut(event, true)) return false;
    const mod = event.ctrlKey && event.shiftKey;
    if (mod && event.code === 'KeyF') {
      event.preventDefault();
      this.openSearch();
      return false;
    }
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
      void this.pasteClipboard();
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
