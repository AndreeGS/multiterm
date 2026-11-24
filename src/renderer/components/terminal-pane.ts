import { ClipboardAddon } from '@xterm/addon-clipboard';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type IMarker } from '@xterm/xterm';
import { describeStatus, formatStatus, type WorktreeStatus } from '../../domain/git/worktree.js';
import { quotePath, type AgentPhase } from '../../domain/terminal/agent.js';
import { formatDuration, formatWaiting } from '../../domain/terminal/shell-integration.js';
import type { TerminalSnapshot } from '../../domain/terminal/types.js';
import { totalTokens, type UsageTotals } from '../../domain/usage/types.js';
import type { CanvasRect } from '../../domain/workspace/layout.js';
import type { ThemeId } from '../../domain/workspace/settings.js';
import type { MultiTermApi } from '../../shared/contract.js';
import { shortenPath } from '../paths.js';
import { matchShortcut } from '../shortcuts.js';
import { MIN_CONTRAST, SEARCH_DECORATIONS, TERMINAL_THEMES, type Appearance } from '../theme.js';
import { openColorMenu, paneColorVar } from './color-menu.js';
import { openContextMenu } from './context-menu.js';
import { openConfirm } from './dialogs.js';
import { permissionCard } from './permission-card.js';
import { beginRename, button, DRAG_END_EVENT, el, isDragging, type Panel } from './panel.js';
import { formatTokens, money } from './usage-bar.js';

export const STATUS_LABEL: Record<TerminalSnapshot['status'], string> = {
  starting: 'iniciando',
  running: 'executando',
  idle: 'aguardando',
  exited: 'finalizado',
  error: 'erro',
};

/** O que o Claude Code esta fazendo, pelos hooks dele. */
export const AGENT_LABEL: Record<AgentPhase, string> = {
  working: 'Claude trabalhando',
  waiting: 'Claude aguardando voce',
  permission: 'Claude pedindo permissao',
};

/** Com o agente conhecido, o ponto mostra o estado dele em vez do fluxo de bytes. */
const AGENT_DOT: Record<AgentPhase, TerminalSnapshot['status']> = {
  working: 'running',
  waiting: 'idle',
  permission: 'idle',
};

/** Comandos mais curtos que isto nao ganham o selo de resultado: voce estava olhando. */
const COMMAND_BADGE_MIN_MS = 3000;
/** Linhas do historico salvas para restaurar a sessao (o arquivo tem limite de tamanho). */
const SAVED_HISTORY_LINES = 5000;
/** Marcas de prompt guardadas por terminal (as mais antigas saem com o scrollback). */
const MAX_PROMPT_MARKS = 2000;
/**
 * Terminais com renderizador WebGL ao mesmo tempo. O Chromium derruba o
 * contexto mais antigo acima de ~16; o resto usa o renderizador DOM. Os slots
 * vao para os terminais na tela: quem sai de vista (outra pagina, outro
 * workspace, atras de um maximizado) devolve o seu depois de um tempo.
 */
const MAX_WEBGL = 12;
let webglInUse = 0;
/** Terminais na tela sem WebGL, esperando um slot vagar (em ordem de chegada). */
const webglWaiting = new Set<TerminalPane>();
/** Fora de vista por mais que isto, o terminal devolve o slot (paginar rapido nao recria contextos). */
const WEBGL_RELEASE_MS = 2000;

/** Espera do tamanho final antes de avisar o pty: cada resize e um SIGWINCH e um redesenho da TUI. */
const PTY_RESIZE_DELAY_MS = 80;
/** Durante um arrasto, o xterm se reajusta no maximo uma vez neste intervalo. */
const DRAG_FIT_MS = 120;
/** Confirmacoes de output desenhado vao agrupadas neste intervalo. */
const ACK_INTERVAL_MS = 50;


export interface PaneCallbacks {
  onFocus(id: string): void;
  onMaximize(id: string): void;
  onClose(id: string): void;
  /** Diff do worktree do terminal. */
  onShowDiff(id: string): void;
  /** Abre o diretorio do terminal no editor das configuracoes. */
  onOpenEditor(id: string): void;
  /** Abre outro terminal igual a este, no diretorio em que ele esta. */
  onDuplicate(id: string): void;
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
  private readonly serializer = new SerializeAddon();
  /** Chegou output desde o ultimo historico salvo. */
  private historyDirty = false;
  private readonly searchBar: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private readonly searchCount: HTMLElement;
  /** Onde o cartao de permissao aparece (sobre o terminal, no topo). */
  private readonly askSlot: HTMLElement;
  /** Pedido mostrado agora: o cartao so e refeito quando ele muda. */
  private shownAsk: string | null = null;
  private readonly dot: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly cwdEl: HTMLElement;
  private readonly maximizeBtn: HTMLButtonElement;
  private readonly colorBtn: HTMLButtonElement;
  private readonly usageEl: HTMLElement;
  /** `✓ 12s` do ultimo comando, `ha 5 min` esperando, `▸ vim` em foreground. */
  private readonly metaEl: HTMLElement;
  /** Inicio de cada prompt no buffer (OSC 133 A), para Ctrl+Shift+↑/↓. */
  private readonly prompts: IMarker[] = [];
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
  /** O contexto foi perdido (GPU resetada): nao tenta de novo neste terminal. */
  private webglLost = false;
  private theme: ThemeId;
  private visible = false;
  private webglReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly visibility: IntersectionObserver;
  /** Frame agendado para o fit (varios pedidos no mesmo frame viram um). */
  private fitFrame = 0;
  private dragFitTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.theme = appearance.theme;

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
    this.metaEl = el('span', 'pane-meta');
    this.metaEl.hidden = true;
    this.gitEl = button('', 'Ver diff do worktree', () => this.callbacks.onShowDiff(this.id));
    this.gitEl.className = 'pane-git';
    this.gitEl.hidden = true;

    header.append(this.dot, title, this.metaEl, this.gitEl, this.usageEl, actions);

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
    this.askSlot = el('div', 'permission-slot');
    body.append(this.askSlot);
    this.element.append(header, body);
    this.element.addEventListener('mousedown', () => this.callbacks.onFocus(this.id));

    this.term = new Terminal({
      fontFamily: appearance.fontFamily,
      fontSize: appearance.fontSize,
      lineHeight: 1.2,
      cursorBlink: appearance.cursorBlink,
      cursorStyle: appearance.cursorStyle,
      scrollback: appearance.scrollback,
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
    this.term.loadAddon(this.serializer);
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
    // Marcas de prompt do shell: guarda onde cada prompt comecou para pular
    // entre eles. Nao consome a sequencia (o xterm a ignora de qualquer jeito).
    this.term.parser.registerOscHandler(133, (data) => {
      if (data === 'A' || data.startsWith('A;')) this.markPrompt();
      return false;
    });
    this.term.open(body);
    // Pega (ou devolve) um slot de WebGL conforme o painel entra ou sai da tela.
    this.visibility = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) this.setVisible(last.isIntersecting);
    });
    this.visibility.observe(this.element);
    // Arrastar arquivos (do gerenciador de arquivos, do editor) cola os
    // caminhos, com aspas quando precisam, sem Enter.
    body.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      this.element.classList.add('drop-target');
    });
    body.addEventListener('dragleave', () => this.element.classList.remove('drop-target'));
    body.addEventListener('drop', (event) => {
      this.element.classList.remove('drop-target');
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      event.preventDefault();
      const paths = files.map((file) => this.api.pathForFile(file)).filter(Boolean);
      if (paths.length === 0) return;
      this.term.paste(`${paths.map(quotePath).join(' ')} `);
      this.callbacks.onFocus(this.id);
      this.term.focus();
    });
    body.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.callbacks.onFocus(this.id);
      this.openMenu(event.clientX, event.clientY);
    });

    this.term.onData((data) => this.api.writeTerminal(this.id, data));
    this.term.attachCustomKeyEventHandler((event) => this.handleKey(event));

    this.observer = new ResizeObserver(() => this.refit());
    window.addEventListener(DRAG_END_EVENT, this.onDragEnd);
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
    this.dot.dataset.status = dotStatus(snapshot);
    this.element.classList.toggle('attention', snapshot.needsAttention);
    this.element.classList.toggle('notice', snapshot.notice !== null);
    this.element.classList.toggle('colored', snapshot.color !== null);
    if (snapshot.color) this.element.style.setProperty('--pane-accent', paneColorVar(snapshot.color));
    else this.element.style.removeProperty('--pane-accent');
    this.dot.title = stateLabel(snapshot);
    this.renderMeta();
    this.renderAsk();
  }

  /** Cartao do pedido de permissao em aberto (ou nenhum). */
  private renderAsk(): void {
    const ask = this.snapshot.pendingPermission;
    if ((ask?.id ?? null) === this.shownAsk) return;
    this.shownAsk = ask?.id ?? null;
    this.askSlot.replaceChildren(...(ask ? [permissionCard(ask, (answer) => {
      this.api.answerPermission(this.id, ask.id, answer);
      if (answer === 'release') this.focus();
    })] : []));
  }

  /**
   * Selos do cabecalho: ha quanto tempo espera voce, o resultado do ultimo
   * comando demorado e o programa em foreground quando nao e o comando
   * inicial. O App chama de tempos em tempos para o "ha X min" andar.
   */
  renderMeta(now = Date.now()): void {
    const { attentionSince, lastCommand, foreground, command } = this.snapshot;
    const parts: Array<[text: string, kind: string, title: string]> = [];
    const waiting = attentionSince !== null ? formatWaiting(now - attentionSince) : null;
    if (waiting) parts.push([waiting, 'waiting', `Aguardando desde ${new Date(attentionSince!).toLocaleTimeString()}`]);
    if (lastCommand && lastCommand.durationMs >= COMMAND_BADGE_MIN_MS) {
      const failed = lastCommand.exitCode !== null && lastCommand.exitCode !== 0;
      const duration = formatDuration(lastCommand.durationMs);
      parts.push([
        failed ? `✗ ${lastCommand.exitCode} · ${duration}` : `✓ ${duration}`,
        failed ? 'failed' : 'ok',
        `Ultimo comando: ${lastCommand.exitCode === null ? 'terminou' : `codigo ${lastCommand.exitCode}`}, ` +
          `levou ${duration}, as ${new Date(lastCommand.endedAt).toLocaleTimeString()}`,
      ]);
    }
    const initial = command?.trim().split(/\s+/)[0]?.split('/').pop() ?? null;
    if (foreground && foreground !== initial) parts.push([`▸ ${foreground}`, 'fg', `Rodando agora: ${foreground}`]);
    this.metaEl.hidden = parts.length === 0;
    this.metaEl.replaceChildren(...parts.map(([text, kind, title]) => {
      const item = el('span', `pane-meta-${kind}`);
      item.textContent = text;
      item.title = title;
      return item;
    }));
  }

  private markPrompt(): void {
    const marker = this.term.registerMarker(0);
    if (!marker) return;
    // Um prompt redesenhado na mesma linha (resize, Ctrl+L) nao vira outra marca.
    const last = this.prompts[this.prompts.length - 1];
    if (last && !last.isDisposed && last.line === marker.line) {
      marker.dispose();
      return;
    }
    marker.onDispose(() => {
      const index = this.prompts.indexOf(marker);
      if (index >= 0) this.prompts.splice(index, 1);
    });
    this.prompts.push(marker);
    if (this.prompts.length > MAX_PROMPT_MARKS) this.prompts.shift()?.dispose();
  }

  /** Rola ate o prompt anterior/seguinte ao topo da tela (Ctrl+Shift+↑/↓). */
  private jumpToPrompt(direction: -1 | 1): void {
    const top = this.term.buffer.active.viewportY;
    const lines = this.prompts.filter((marker) => !marker.isDisposed).map((marker) => marker.line);
    const target = direction < 0
      ? lines.filter((line) => line < top).pop()
      : lines.find((line) => line > top);
    if (target === undefined) {
      if (direction > 0) this.term.scrollToBottom();
      return;
    }
    this.term.scrollToLine(target);
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
  send(text: string): Promise<void> {
    const body = text.replace(/\s+$/, '');
    if (!body) return Promise.resolve();
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
    return this.sending;
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
    const themeChanged = appearance.theme !== this.theme;
    this.theme = appearance.theme;
    this.term.options.theme = TERMINAL_THEMES[appearance.theme];
    this.term.options.minimumContrastRatio = MIN_CONTRAST[appearance.theme];
    this.term.options.cursorStyle = appearance.cursorStyle;
    this.term.options.cursorBlink = appearance.cursorBlink;
    this.term.options.scrollback = appearance.scrollback;
    const fontChanged = this.term.options.fontFamily !== appearance.fontFamily;
    if (fontChanged) this.term.options.fontFamily = appearance.fontFamily;
    this.fontSize = appearance.fontSize;
    this.applyFontSize();
    // Outra fonte, outra largura de celula: cols/rows mudam.
    if (fontChanged) this.refit();
    // Busca aberta: repinta as ocorrencias com as cores do tema novo.
    if (themeChanged && !this.searchBar.hidden && this.searchInput.value) this.findNext(false, true);
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
    if (this.fitFrame || this.dragFitTimer) return;
    // Arrastando uma quina ou divisor, o reflow do xterm a cada frame pesa: ajusta
    // de tempos em tempos e uma ultima vez ao soltar.
    if (isDragging()) {
      this.dragFitTimer = setTimeout(() => {
        this.dragFitTimer = null;
        this.fitNow();
      }, DRAG_FIT_MS);
      return;
    }
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = 0;
      this.fitNow();
    });
  }

  private readonly onDragEnd = (): void => {
    if (!this.dragFitTimer) return;
    clearTimeout(this.dragFitTimer);
    this.dragFitTimer = null;
    this.refit();
  };

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
  private setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) {
      if (this.webglReleaseTimer) clearTimeout(this.webglReleaseTimer);
      this.webglReleaseTimer = null;
      this.loadWebgl();
      return;
    }
    webglWaiting.delete(this);
    if (!this.webgl || this.webglReleaseTimer) return;
    this.webglReleaseTimer = setTimeout(() => {
      this.webglReleaseTimer = null;
      if (this.visible) return;
      this.disposeWebgl();
      TerminalPane.grantWebgl();
    }, WEBGL_RELEASE_MS);
  }

  /** Um slot vagou: vai para o primeiro terminal na tela que esperava. */
  private static grantWebgl(): void {
    for (const pane of webglWaiting) {
      if (webglInUse >= MAX_WEBGL) return;
      pane.loadWebgl();
    }
  }

  private loadWebgl(): void {
    if (this.webgl || this.webglLost) return;
    if (webglInUse >= MAX_WEBGL) {
      webglWaiting.add(this);
      return;
    }
    webglWaiting.delete(this);
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        this.webglLost = true;
        this.disposeWebgl();
        TerminalPane.grantWebgl();
      });
      this.term.loadAddon(addon);
      this.webgl = addon;
      webglInUse++;
    } catch {
      // sem WebGL (GPU bloqueada, --disable-gpu): fica no renderizador DOM
      this.webglLost = true;
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
    this.historyDirty = true;
    this.term.write(data, () => this.ack(data.length));
  }

  /**
   * Historico com cores para salvar, ou `null` se nada mudou desde a ultima
   * vez (`force` = mesmo assim, ao fechar a janela).
   */
  takeHistory(force = false): string | null {
    if (!this.historyDirty && !force) return null;
    if (this.early) return null; // ainda hidratando: o buffer nao esta completo
    this.historyDirty = false;
    try {
      return this.serializer.serialize({ scrollback: Math.min(this.term.options.scrollback ?? 0, SAVED_HISTORY_LINES) });
    } catch {
      return null;
    }
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
    window.removeEventListener(DRAG_END_EVENT, this.onDragEnd);
    this.visibility.disconnect();
    webglWaiting.delete(this);
    if (this.webglReleaseTimer) clearTimeout(this.webglReleaseTimer);
    if (this.fitFrame) cancelAnimationFrame(this.fitFrame);
    if (this.dragFitTimer) clearTimeout(this.dragFitTimer);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    if (this.ackTimer) clearTimeout(this.ackTimer);
    // O terminal pode seguir vivo sem este painel: nao deixa o pty pausado.
    if (this.unacked > 0) this.api.ackOutput(this.id, this.unacked);
    const hadWebgl = this.webgl !== null;
    this.disposeWebgl();
    this.term.dispose();
    this.element.remove();
    if (hadWebgl) TerminalPane.grantWebgl();
  }

  /** Carrega o output ja produzido antes deste painel existir. */
  private async hydrate(): Promise<void> {
    // Terminal restaurado: o que estava na tela antes de fechar o app vem
    // primeiro, separado do shell novo por uma linha.
    const [history, replay] = await Promise.all([
      this.api.takeScrollback(this.id),
      this.api.replayTerminal(this.id),
    ]);
    if (history) {
      this.term.write(history);
      this.term.write(`\x1b[0m\r\n\x1b[2m── sessao anterior, restaurada em ${new Date().toLocaleString()} ──\x1b[0m\r\n`);
      this.historyDirty = true;
    }
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
    const options = { incremental, decorations: SEARCH_DECORATIONS[this.theme] };
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
      { label: 'Duplicar terminal', run: () => this.callbacks.onDuplicate(this.id) },
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
    if (mod && !event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      this.jumpToPrompt(event.key === 'ArrowUp' ? -1 : 1);
      return false;
    }
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

/** Cor do ponto de estado: o do agente, quando ha um acompanhado pelos hooks. */
export function dotStatus(snapshot: TerminalSnapshot): TerminalSnapshot['status'] {
  const { agent, status } = snapshot;
  return agent && status !== 'exited' && status !== 'error' ? AGENT_DOT[agent.phase] : status;
}

/** `Claude aguardando voce`, `executando`, `finalizado (codigo 1)`... */
export function stateLabel(snapshot: TerminalSnapshot): string {
  const { agent, status, exitCode } = snapshot;
  return (agent ? AGENT_LABEL[agent.phase] : STATUS_LABEL[status]) + (exitCode !== null ? ` (codigo ${exitCode})` : '');
}

/** `~/repo.worktrees/feat-x · ⎇ feat-x · claude`: onde roda, em que branch isolada, o que roda. */
export function terminalPlace(snapshot: TerminalSnapshot): string {
  return shortenPath(snapshot.cwd) +
    (snapshot.worktree ? ` · ⎇ ${snapshot.worktree.branch}` : '') +
    (snapshot.command ? ` · ${snapshot.command}` : '');
}
