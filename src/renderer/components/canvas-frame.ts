import { MIN_FRAME_SIZE, type CanvasFrame, type CanvasFramePatch } from '../../domain/canvas/frame.js';
import type { CanvasRect } from '../../domain/workspace/layout.js';
import { openColorMenu, paneColorVar } from './color-menu.js';
import { beginRename, button, drag, el } from './panel.js';

export interface FrameCallbacks {
  onChange(id: string, patch: CanvasFramePatch): void;
  onRemove(id: string): void;
  /** Mousedown no titulo: a area livre move a moldura e quem esta dentro. */
  onMoveStart(frame: CanvasFrameItem, event: MouseEvent): void;
}

/**
 * Moldura (grupo) na area livre. So o titulo e a quina capturam o mouse: o
 * corpo e transparente aos eventos, entao arrastar ou dar duplo clique dentro
 * dela continua movendo a vista e criando texto, como no fundo.
 */
export class CanvasFrameItem {
  readonly element = el('div', 'canvas-frame');
  private readonly titleBar = el('div', 'canvas-frame-title');
  private readonly titleEl = el('span', 'canvas-frame-name');
  private readonly colorBtn: HTMLButtonElement;
  private frame: CanvasFrame;
  private zoom = 1;

  constructor(frame: CanvasFrame, private readonly callbacks: FrameCallbacks) {
    this.frame = frame;
    this.titleEl.title = 'Arraste para mover o grupo · duplo clique para renomear';
    this.colorBtn = button('●', 'Cor do grupo', () => void this.pickColor());
    this.colorBtn.className = 'canvas-frame-color';
    const tools = el('span', 'canvas-frame-tools');
    tools.append(this.colorBtn, button('✕', 'Apagar o grupo (os paineis ficam)', () => this.callbacks.onRemove(this.id)));
    this.titleBar.append(this.titleEl, tools);

    const resize = el('div', 'canvas-frame-resize');
    resize.title = 'Redimensionar o grupo';
    resize.addEventListener('mousedown', (event) => this.startResize(event));
    this.element.append(this.titleBar, resize);

    this.titleBar.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button, input')) return;
      event.stopPropagation();
      this.callbacks.onMoveStart(this, event);
    });
    this.titleEl.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      beginRename(this.titleEl, this.frame.title, (title) => this.update({ title }));
    });
    this.render();
  }

  get id(): string {
    return this.frame.id;
  }

  get workspaceId(): string {
    return this.frame.workspaceId;
  }

  get rect(): CanvasRect {
    const { x, y, width, height } = this.frame;
    return { x, y, width, height };
  }

  place(zoom: number): void {
    this.zoom = zoom;
    const { x, y, width, height } = this.frame;
    Object.assign(this.element.style, {
      left: `${x * zoom}px`,
      top: `${y * zoom}px`,
      width: `${width * zoom}px`,
      height: `${height * zoom}px`,
    });
    // Como os cabecalhos dos paineis: legivel de longe, sem crescer demais de perto.
    this.titleBar.style.zoom = `calc(var(--ui-zoom, 1) * ${Math.min(1.4, Math.max(0.6, zoom))})`;
  }

  /** Durante o arrasto do grupo: so a tela muda; `commit` grava a posicao final. */
  moveTo(x: number, y: number, commit = false): void {
    this.frame = { ...this.frame, x, y };
    this.place(this.zoom);
    if (commit) this.callbacks.onChange(this.id, { x, y });
  }

  dispose(): void {
    this.element.remove();
  }

  private update(patch: CanvasFramePatch): void {
    this.frame = { ...this.frame, ...patch } as CanvasFrame;
    this.render();
    this.callbacks.onChange(this.id, patch);
  }

  private render(): void {
    this.titleEl.textContent = this.frame.title;
    if (this.frame.color) this.element.style.setProperty('--frame-color', paneColorVar(this.frame.color));
    else this.element.style.removeProperty('--frame-color');
  }

  private async pickColor(): Promise<void> {
    const color = await openColorMenu(this.colorBtn, this.frame.color);
    if (color !== undefined) this.update({ color });
  }

  /** Redimensionar mexe so na moldura: quem esta dentro nao muda de lugar. */
  private startResize(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    const start = this.rect;
    let size = { width: start.width, height: start.height };
    drag(event, 'nwse-resize', (dx, dy) => {
      size = {
        width: Math.max(MIN_FRAME_SIZE.width, start.width + dx / this.zoom),
        height: Math.max(MIN_FRAME_SIZE.height, start.height + dy / this.zoom),
      };
      this.frame = { ...this.frame, ...size };
      this.place(this.zoom);
    }, () => {
      if (size.width !== start.width || size.height !== start.height) this.callbacks.onChange(this.id, size);
    });
  }
}
