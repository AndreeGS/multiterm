import { TEXT_SIZES, type CanvasText, type CanvasTextPatch } from '../../domain/canvas/text.js';
import type { CanvasRect } from '../../domain/workspace/layout.js';
import { button, drag, el } from './panel.js';

export interface TextCallbacks {
  onChange(id: string, patch: CanvasTextPatch): void;
  /** Apagar pelo ✕ ou sair da edicao com o texto vazio. */
  onRemove(id: string): void;
}

/**
 * Texto solto na area livre. Arrastar move; clicar sem arrastar entra em
 * edicao; Esc ou clicar fora sai. Como os paineis, segue o zoom pela fonte
 * em vez de transform, para o cursor de texto nao desalinhar.
 */
export class CanvasTextItem {
  readonly element = el('div', 'canvas-text');
  private readonly body = el('div', 'canvas-text-body');
  private text: CanvasText;
  private zoom = 1;

  constructor(text: CanvasText, private readonly callbacks: TextCallbacks) {
    this.text = text;
    this.body.textContent = text.content;
    this.body.dataset.placeholder = 'Digite aqui…';

    const tools = el('div', 'canvas-text-tools');
    tools.append(
      button('A−', 'Diminuir texto', () => this.resizeBy(-1)),
      button('A+', 'Aumentar texto', () => this.resizeBy(1)),
      button('✕', 'Apagar texto', () => this.callbacks.onRemove(this.id)),
    );
    this.element.append(this.body, tools);

    this.element.addEventListener('mousedown', (event) => this.onMouseDown(event));
    this.body.addEventListener('input', () => {
      this.text = { ...this.text, content: this.body.innerText };
      this.callbacks.onChange(this.id, { content: this.text.content });
    });
    this.body.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.body.blur();
      // Atalhos com Ctrl continuam globais; o resto pertence ao texto.
      if (!event.ctrlKey) event.stopPropagation();
    });
    this.body.addEventListener('blur', () => this.finishEditing());
  }

  get id(): string {
    return this.text.id;
  }

  get workspaceId(): string {
    return this.text.workspaceId;
  }

  /** Retangulo no mundo, para o "Ajustar" enquadrar os textos tambem. */
  get worldRect(): CanvasRect {
    return {
      x: this.text.x,
      y: this.text.y,
      width: this.element.offsetWidth / this.zoom,
      height: this.element.offsetHeight / this.zoom,
    };
  }

  /** Posicao no mundo. */
  get position(): { x: number; y: number } {
    return { x: this.text.x, y: this.text.y };
  }

  /** Movido junto com um grupo: so a tela muda; `commit` grava a posicao final. */
  moveTo(x: number, y: number, commit = false): void {
    this.text = { ...this.text, x, y };
    this.place(this.zoom);
    if (commit) this.callbacks.onChange(this.id, { x, y });
  }

  place(zoom: number): void {
    this.zoom = zoom;
    this.element.style.left = `${this.text.x * zoom}px`;
    this.element.style.top = `${this.text.y * zoom}px`;
    this.element.style.fontSize = `${this.text.fontSize * zoom}px`;
  }

  edit(): void {
    this.element.classList.add('editing');
    this.body.contentEditable = 'plaintext-only';
    this.body.focus();
    // Cursor no fim do texto, nao no comeco.
    const range = document.createRange();
    range.selectNodeContents(this.body);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  dispose(): void {
    this.element.remove();
  }

  private finishEditing(): void {
    this.element.classList.remove('editing');
    this.body.contentEditable = 'false';
    if (!this.text.content.trim()) this.callbacks.onRemove(this.id);
  }

  private onMouseDown(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest('button')) return;
    // Em edicao, o mouse seleciona texto normalmente.
    if (this.element.classList.contains('editing')) return;
    event.stopPropagation();
    const start = { x: this.text.x, y: this.text.y };
    let moved = false;
    drag(event, 'grabbing', (dx, dy) => {
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      this.text = { ...this.text, x: start.x + dx / this.zoom, y: start.y + dy / this.zoom };
      this.place(this.zoom);
    }, () => {
      if (moved) this.callbacks.onChange(this.id, { x: this.text.x, y: this.text.y });
      else this.edit();
    });
  }

  private resizeBy(step: number): void {
    const index = TEXT_SIZES.indexOf(this.text.fontSize);
    const next = TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, index + step))]!;
    if (next === this.text.fontSize) return;
    this.text = { ...this.text, fontSize: next };
    this.place(this.zoom);
    this.callbacks.onChange(this.id, { fontSize: next });
  }
}
