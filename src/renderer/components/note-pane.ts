import type { Note } from '../../domain/notes/note.js';
import type { CanvasRect } from '../../domain/workspace/layout.js';
import type { MultiTermApi } from '../../shared/contract.js';
import type { Appearance } from '../theme.js';
import {
  beginRename,
  button,
  el,
  linkChip,
  renderLinkChip,
  type LinkCallbacks,
  type LinkLabel,
  type Panel,
} from './panel.js';

export interface NoteCallbacks extends LinkCallbacks {
  onFocus(id: string): void;
  onMaximize(id: string): void;
  onClose(id: string): void;
  /** Manda texto ao terminal vinculado; `pick` (ou sem vinculo) pergunta qual. */
  onSend(sourceId: string, text: string, pick: boolean): void;
}

/**
 * Bloco de notas: texto puro, salvo a cada tecla (o main agrupa as escritas
 * no disco). Mesmo cabecalho dos terminais, para arrastar e maximizar igual.
 */
export class NotePane implements Panel {
  readonly element: HTMLElement;
  readonly header: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly infoEl: HTMLElement;
  private readonly editor: HTMLTextAreaElement;
  private readonly maximizeBtn: HTMLButtonElement;
  private note: Note;
  private readonly chip: HTMLButtonElement;
  private fontSize: number;
  private scale = 1;

  constructor(
    note: Note,
    private readonly api: MultiTermApi,
    private readonly callbacks: NoteCallbacks,
    appearance: Appearance,
  ) {
    this.note = note;
    this.fontSize = appearance.fontSize;

    this.element = el('div', 'pane note');
    this.element.dataset.id = note.id;

    this.header = el('div', 'pane-header');
    const icon = el('span', 'note-icon');
    icon.textContent = '✎';
    this.nameEl = el('div', 'pane-name');
    this.infoEl = el('div', 'pane-cwd');

    const title = el('div', 'pane-title');
    title.append(this.nameEl, this.infoEl);
    title.title = 'Duplo clique para renomear';
    title.addEventListener('dblclick', () =>
      beginRename(this.nameEl, this.note.title, (name) => {
        this.note = { ...this.note, title: name.trim() };
        this.api.updateNote(this.id, { title: name });
        this.render();
      }),
    );

    this.chip = linkChip(() => this.id, this.callbacks);
    renderLinkChip(this.chip, null);

    const actions = el('div', 'pane-actions');
    this.maximizeBtn = button('⤢', 'Maximizar / restaurar', () => this.callbacks.onMaximize(this.id));
    const sendBtn = button('▶', '', () => this.sendCurrent(false));
    sendBtn.title = 'Enviar a selecao (ou a linha do cursor) ao terminal vinculado — Ctrl+Enter\n' +
      'Shift+clique ou Ctrl+Shift+Enter: escolher outro terminal (e vincular a ele)';
    sendBtn.addEventListener('click', (event) => {
      if (!event.shiftKey) return;
      event.stopImmediatePropagation();
      this.sendCurrent(true);
    }, { capture: true });
    actions.append(
      sendBtn,
      button('⧉', 'Copiar tudo', () => void navigator.clipboard.writeText(this.editor.value)),
      this.maximizeBtn,
      button('✕', 'Fechar e apagar nota', () => this.callbacks.onClose(this.id)),
    );
    this.header.append(icon, title, this.chip, actions);

    this.editor = el('textarea', 'note-editor');
    this.editor.value = note.content;
    this.editor.spellcheck = false;
    this.editor.placeholder = 'Anotacoes, comandos, TODOs...';
    this.editor.addEventListener('input', () => {
      this.note = { ...this.note, content: this.editor.value };
      this.api.updateNote(this.id, { content: this.editor.value });
      this.render();
    });
    this.editor.addEventListener('keydown', (event) => this.handleKey(event));

    const body = el('div', 'pane-body note-body');
    body.append(this.editor);
    this.element.append(this.header, body);
    this.element.addEventListener('mousedown', () => this.callbacks.onFocus(this.id));

    this.render();
    this.applyFontSize();
  }

  get id(): string {
    return this.note.id;
  }

  get isEmpty(): boolean {
    return this.note.content.trim().length === 0;
  }

  get canvasRect(): CanvasRect | null {
    return this.note.rect;
  }

  /** A area livre chama isto ao terminar de mover/redimensionar. */
  set canvasRect(rect: CanvasRect | null) {
    this.note = { ...this.note, rect };
    this.api.updateNote(this.id, { rect });
  }

  refit(): void {
    // textarea se ajusta sozinho ao painel.
  }

  focus(): void {
    // Nao rouba o foco de quem ja esta digitando aqui (ex.: renomeando).
    if (!this.element.contains(document.activeElement)) this.editor.focus();
  }

  setFocused(focused: boolean): void {
    this.element.classList.toggle('focused', focused);
  }

  setScale(scale: number): void {
    this.scale = scale;
    this.applyFontSize();
  }

  setAppearance(appearance: Appearance): void {
    // As cores vem das variaveis CSS; so a fonte precisa de ajuste aqui.
    this.fontSize = appearance.fontSize;
    this.applyFontSize();
  }

  private applyFontSize(): void {
    // Meio ponto acima do terminal: texto corrido le melhor um pouco maior.
    this.editor.style.fontSize = `${(this.fontSize + 0.5) * this.scale}px`;
    this.editor.style.padding = this.scale === 1 ? '' : `${8 * this.scale}px ${10 * this.scale}px`;
  }

  setMaximized(maximized: boolean): void {
    this.maximizeBtn.textContent = maximized ? '⤡' : '⤢';
  }

  dispose(): void {
    this.element.remove();
  }

  get workspaceId(): string {
    return this.note.workspaceId;
  }

  moveToWorkspace(workspaceId: string): void {
    if (workspaceId === this.note.workspaceId) return;
    this.note = { ...this.note, workspaceId };
    this.api.updateNote(this.id, { workspaceId });
  }

  get terminalId(): string | null {
    return this.note.terminalId;
  }

  /** Troca o terminal vinculado e persiste. */
  setLink(terminalId: string | null): void {
    if (terminalId === this.note.terminalId) return;
    this.note = { ...this.note, terminalId };
    this.api.updateNote(this.id, { terminalId });
  }

  /** O App resolve o nome do terminal (ou `null`, sem vinculo). */
  showLink(label: LinkLabel | null): void {
    renderLinkChip(this.chip, label);
  }

  /**
   * Envia a selecao; sem selecao, a linha do cursor — e desce o cursor para a
   * proxima, para mandar um roteiro de comandos linha a linha.
   */
  private sendCurrent(pick: boolean): void {
    const { value, selectionStart: from, selectionEnd: to } = this.editor;
    let text: string;
    if (from !== to) {
      text = value.slice(from, to);
    } else {
      const start = value.lastIndexOf('\n', from - 1) + 1;
      const newline = value.indexOf('\n', from);
      const end = newline < 0 ? value.length : newline;
      text = value.slice(start, end);
      const next = newline < 0 ? end : end + 1;
      this.editor.setSelectionRange(next, next);
    }
    if (text.trim()) this.callbacks.onSend(this.id, text, pick);
  }

  private render(): void {
    this.nameEl.textContent = this.note.title;
    const lines = this.note.content ? this.note.content.split('\n').length : 0;
    this.infoEl.textContent = `nota · ${lines} ${lines === 1 ? 'linha' : 'linhas'}`;
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      this.sendCurrent(event.shiftKey);
      return;
    }
    // Tab indenta em vez de tirar o foco do editor. execCommand preserva o Ctrl+Z.
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      document.execCommand('insertText', false, '\t');
    }
  }
}
