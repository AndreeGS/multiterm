import {
  clampZoom,
  fitView,
  zoomAt,
  type CanvasRect,
  type CanvasView,
} from '../../domain/workspace/layout.js';
import type { CanvasText, CanvasTextPatch } from '../../domain/canvas/text.js';
import { CanvasTextItem } from './canvas-text.js';
import { button, drag, el, type Board, type Panel } from './panel.js';

/** Onde a area livre guarda os textos soltos (o App liga isto a API). */
export interface TextStore {
  create(x: number, y: number): Promise<CanvasText>;
  update(id: string, patch: CanvasTextPatch): void;
  remove(id: string): void;
}

const DEFAULT_SIZE = { width: 640, height: 400 };
const MIN_SIZE = { width: 280, height: 160 };
const CASCADE = 32;
const DOT_SPACING = 24;
const ZOOM_STEP = 1.2;

/**
 * Area livre: um "mundo" infinito onde cada painel e uma janela flutuante.
 * Arrastar o fundo move a vista; arrastar o cabecalho move o painel; a quina
 * inferior direita redimensiona. Todos os paineis ficam visiveis, sem paginas.
 *
 * O zoom e "semantico": em vez de um transform scale (que desalinha o mouse
 * com as celulas do xterm e borra o texto), posicao e tamanho sao
 * multiplicados pelo zoom e cada painel ajusta a propria fonte.
 *
 * Alem dos paineis, o fundo aceita textos soltos (duplo clique), que ficam
 * sempre por baixo dos paineis.
 */
export class CanvasBoard implements Board {
  readonly element = el('div', 'canvas');
  private readonly world = el('div', 'canvas-world');
  private readonly zoomLabel: HTMLButtonElement;
  private readonly zoomBar = el('div', 'canvas-zoom');
  private readonly handles = new Map<string, HTMLElement>();
  private readonly texts = new Map<string, CanvasTextItem>();
  /** Camada dos textos: antes dos paineis no DOM, entao fica por baixo. */
  private readonly textLayer = el('div', 'canvas-texts');
  private panes: Panel[] = [];
  private view: CanvasView = { x: 0, y: 0, zoom: 1 };
  /** Frame agendado para aplicar o zoom aos paineis (0 = nenhum). */
  private pendingFrame = 0;
  private maximizedId: string | null = null;
  private topZ = 1;
  private cascade = 0;

  /** `onViewChange` recebe cada mudanca de pan/zoom, para persistir. */
  constructor(
    private readonly onViewChange: (view: CanvasView) => void,
    private readonly textStore: TextStore,
  ) {
    this.zoomLabel = button('100%', 'Voltar para 100%', () => this.zoomBy(1 / this.view.zoom));
    this.zoomLabel.className = 'zoom-label';
    this.zoomBar.append(
      button('T', 'Novo texto solto (ou duplo clique no fundo)', () => void this.createTextAtCenter()),
      button('−', 'Diminuir zoom (Ctrl+roda do mouse)', () => this.zoomBy(1 / ZOOM_STEP)),
      this.zoomLabel,
      button('+', 'Aumentar zoom (Ctrl+roda do mouse)', () => this.zoomBy(ZOOM_STEP)),
      button('Ajustar', 'Enquadrar todos os paineis', () => this.fitAll()),
    );
    this.world.append(this.textLayer);
    this.element.append(this.world, this.zoomBar);
    this.element.title =
      'Arraste o fundo para mover a vista · Ctrl+roda para zoom · duplo clique escreve um texto';

    // Arrastos cancelam o mousedown, e com isso o foco nao sairia do texto em
    // edicao: clicar em qualquer outro lugar da area livre encerra a edicao.
    this.element.addEventListener('mousedown', (event) => {
      const active = document.activeElement as HTMLElement | null;
      const editing = active?.closest('.canvas-text');
      if (editing && !editing.contains(event.target as Node)) active!.blur();
    }, true);
    this.element.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || !this.isBackground(event.target)) return;
      const origin = this.view;
      this.element.classList.add('panning');
      drag(event, 'grabbing', (dx, dy) => this.setView({ ...origin, x: origin.x + dx, y: origin.y + dy }), () => {
        this.element.classList.remove('panning');
      });
    });
    this.element.addEventListener('dblclick', (event) => {
      if (!this.isBackground(event.target)) return;
      const box = this.element.getBoundingClientRect();
      const { x, y, zoom } = this.view;
      // Desloca um pouco para o cursor de texto cair onde o mouse estava.
      void this.createText((event.clientX - box.left - x) / zoom - 4, (event.clientY - box.top - y) / zoom - 12);
    });
    this.element.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });

    // Sem avisar: persistiria a vista padrao antes de a salva ser restaurada.
    this.setView(this.view, false);
  }

  /** Vista salva da sessao anterior. */
  restoreView(view: CanvasView): void {
    this.setView(view, false);
  }

  /** Textos salvos da sessao anterior. */
  setTexts(texts: CanvasText[]): void {
    for (const text of texts) this.addText(text);
  }

  get currentPage(): number {
    return 0;
  }

  get pageCount(): number {
    return 1;
  }

  setPanes(panes: Panel[]): void {
    const removed = this.panes.filter((pane) => !panes.includes(pane));
    for (const pane of removed) this.detach(pane);
    const added = panes.filter((pane) => !this.panes.includes(pane));
    this.panes = panes;
    if (this.maximizedId && !panes.some((pane) => pane.id === this.maximizedId)) {
      this.maximizedId = null;
    }
    for (const pane of added) this.attach(pane);
    this.render();
  }

  setPage(): void {
    // A area livre nao tem paginas.
  }

  toggleMaximize(id: string): void {
    this.maximizedId = this.maximizedId === id ? null : id;
    this.render();
  }

  revealPane(id: string): void {
    const pane = this.panes.find((p) => p.id === id);
    if (!pane) return;
    if (this.maximizedId && this.maximizedId !== id) {
      this.maximizedId = id;
      this.render();
      return;
    }
    this.raise(pane);
    const rect = pane.canvasRect;
    if (!rect || this.isInView(rect)) return;
    // Centraliza o painel na vista, mantendo o zoom.
    const { zoom } = this.view;
    this.setView({
      zoom,
      x: Math.round(this.element.clientWidth / 2 - (rect.x + rect.width / 2) * zoom),
      y: Math.round(this.element.clientHeight / 2 - (rect.y + rect.height / 2) * zoom),
    });
  }

  visiblePanes(): Panel[] {
    if (this.maximizedId) return this.panes.filter((pane) => pane.id === this.maximizedId);
    return [...this.panes];
  }

  private isBackground(target: EventTarget | null): boolean {
    return target === this.element || target === this.world || target === this.textLayer;
  }

  private async createText(x: number, y: number): Promise<void> {
    const text = await this.textStore.create(x, y);
    this.addText(text).edit();
  }

  private createTextAtCenter(): Promise<void> {
    const { x, y, zoom } = this.view;
    return this.createText((this.element.clientWidth / 2 - x) / zoom - 60, (this.element.clientHeight / 2 - y) / zoom - 12);
  }

  private addText(text: CanvasText): CanvasTextItem {
    const item = new CanvasTextItem(text, {
      onChange: (id, patch) => this.textStore.update(id, patch),
      onRemove: (id) => this.removeText(id),
    });
    this.texts.set(text.id, item);
    this.textLayer.append(item.element);
    item.place(this.view.zoom);
    return item;
  }

  /** Idempotente: o ✕ e o blur de um texto vazio podem chegar juntos. */
  private removeText(id: string): void {
    const item = this.texts.get(id);
    if (!item) return;
    this.texts.delete(id);
    item.dispose();
    this.textStore.remove(id);
  }

  private isInView(rect: CanvasRect): boolean {
    const { x, y, zoom } = this.view;
    const left = rect.x * zoom + x;
    const top = rect.y * zoom + y;
    return left >= 0 && top >= 0 &&
      left + Math.min(rect.width * zoom, 200) <= this.element.clientWidth &&
      top + Math.min(rect.height * zoom, 100) <= this.element.clientHeight;
  }

  /**
   * Ctrl+roda da zoom em qualquer lugar (inclusive sobre um painel, e sem
   * deixar o Chromium dar zoom na pagina inteira). Sem Ctrl, a roda no fundo
   * move a vista; em cima de um painel, rola o painel.
   */
  private onWheel(event: WheelEvent): void {
    if (event.ctrlKey) {
      event.preventDefault();
      if (this.maximizedId) return;
      const box = this.element.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      this.setView(zoomAt(this.view, this.view.zoom * factor, event.clientX - box.left, event.clientY - box.top));
      return;
    }
    const overText = (event.target as HTMLElement).closest?.('.canvas-text:not(.editing)');
    if (!this.isBackground(event.target) && !overText) return;
    event.preventDefault();
    const dx = event.shiftKey ? event.deltaY : event.deltaX;
    const dy = event.shiftKey ? 0 : event.deltaY;
    this.setView({ ...this.view, x: this.view.x - dx, y: this.view.y - dy });
  }

  /** Zoom pelos botoes: ancorado no centro da vista. */
  private zoomBy(factor: number): void {
    this.setView(zoomAt(this.view, this.view.zoom * factor, this.element.clientWidth / 2, this.element.clientHeight / 2));
  }

  private fitAll(): void {
    const rects = this.panes.map((pane) => pane.canvasRect).filter((r): r is CanvasRect => r !== null);
    for (const item of this.texts.values()) rects.push(item.worldRect);
    this.setView(fitView(rects, this.element.clientWidth, this.element.clientHeight));
  }

  private setView(view: CanvasView, notify = true): void {
    const zoomChanged = view.zoom !== this.view.zoom;
    this.view = { ...view, zoom: clampZoom(view.zoom) };
    const { x, y, zoom } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px)`;
    // O pontilhado do fundo acompanha a vista, dando a sensacao de mover o plano.
    this.element.style.backgroundPosition = `${x}px ${y}px`;
    this.element.style.backgroundSize = `${DOT_SPACING * zoom}px ${DOT_SPACING * zoom}px`;
    this.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    if (notify) this.onViewChange(this.view);
    if (!zoomChanged) return;
    // Varios eventos de roda por frame viram uma unica troca de fonte por painel.
    if (!this.pendingFrame) {
      this.pendingFrame = requestAnimationFrame(() => {
        this.pendingFrame = 0;
        this.render();
      });
    }
  }

  private attach(pane: Panel): void {
    if (!pane.canvasRect) {
      // Novos paineis aparecem em cascata dentro da vista atual, ja no tamanho
      // que ocupariam em 100%.
      const { x, y, zoom } = this.view;
      const step = this.cascade++ % 8;
      const fit = (size: number, view: number, min: number) =>
        view > 0 ? Math.min(size, Math.max(min, view / zoom - 80)) : size;
      pane.canvasRect = {
        x: (-x + 24) / zoom + step * CASCADE,
        y: (-y + 24) / zoom + step * CASCADE,
        width: fit(DEFAULT_SIZE.width, this.element.clientWidth, MIN_SIZE.width),
        height: fit(DEFAULT_SIZE.height, this.element.clientHeight, MIN_SIZE.height),
      };
    }

    pane.element.classList.add('floating');
    pane.header.classList.add('drag-handle');
    pane.header.addEventListener('mousedown', this.onHeaderDown);
    pane.element.addEventListener('mousedown', this.onPaneDown, true);

    const handle = el('div', 'resize-handle');
    handle.title = 'Redimensionar';
    handle.addEventListener('mousedown', (event) => this.startResize(event, pane));
    pane.element.append(handle);
    this.handles.set(pane.id, handle);
    this.raise(pane);
  }

  /** Desfaz tudo que `attach` pos no painel, para a grade receber limpo. */
  private detach(pane: Panel): void {
    pane.element.classList.remove('floating', 'canvas-max');
    pane.element.hidden = false;
    pane.header.classList.remove('drag-handle');
    pane.header.removeEventListener('mousedown', this.onHeaderDown);
    pane.element.removeEventListener('mousedown', this.onPaneDown, true);
    this.handles.get(pane.id)?.remove();
    this.handles.delete(pane.id);
    for (const prop of ['left', 'top', 'width', 'height', 'zIndex'] as const) pane.element.style[prop] = '';
    this.scale(pane, 1);
    pane.element.remove();
  }

  private render(): void {
    this.zoomBar.hidden = this.maximizedId !== null;
    for (const item of this.texts.values()) item.place(this.view.zoom);
    for (const pane of this.panes) {
      const maximized = pane.id === this.maximizedId;
      const hidden = this.maximizedId !== null && !maximized;
      pane.element.classList.toggle('canvas-max', maximized);
      pane.element.hidden = hidden;
      pane.setMaximized(maximized);
      // Maximizado sai do mundo (que se move) e ocupa a vista inteira, em 100%.
      const parent = maximized ? this.element : this.world;
      if (pane.element.parentElement !== parent) parent.append(pane.element);
      this.scale(pane, maximized ? 1 : this.view.zoom);
      if (!maximized) this.place(pane, pane.canvasRect!);
    }
    for (const pane of this.visiblePanes()) pane.refit();
  }

  /**
   * O conteudo (terminal, texto) segue o zoom pela fonte. O cabecalho usa CSS
   * `zoom` — nao tem xterm dentro, entao nao ha mouse para desalinhar — com
   * limites, para continuar clicavel de longe e nao crescer demais de perto.
   */
  private scale(pane: Panel, zoom: number): void {
    pane.setScale(zoom);
    // Multiplica a escala da interface (configuracoes), que vem do CSS.
    const clamped = Math.min(1.4, Math.max(0.6, zoom));
    pane.header.style.zoom = zoom === 1 ? '' : `calc(var(--ui-zoom, 1) * ${clamped})`;
  }

  /** Converte o retangulo do mundo para pixels na tela, conforme o zoom. */
  private place(pane: Panel, rect: CanvasRect): void {
    const { zoom } = this.view;
    Object.assign(pane.element.style, {
      left: `${rect.x * zoom}px`,
      top: `${rect.y * zoom}px`,
      width: `${rect.width * zoom}px`,
      height: `${rect.height * zoom}px`,
    });
  }

  private raise(pane: Panel): void {
    if (pane.element.style.zIndex === String(this.topZ)) return;
    this.topZ += 1;
    pane.element.style.zIndex = String(this.topZ);
  }

  private paneOf(target: EventTarget | null): Panel | undefined {
    const node = (target as HTMLElement | null)?.closest('.pane');
    return this.panes.find((pane) => pane.element === node);
  }

  private readonly onPaneDown = (event: MouseEvent): void => {
    const pane = this.paneOf(event.target);
    if (pane) this.raise(pane);
  };

  private readonly onHeaderDown = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest('button, input')) return;
    const pane = this.paneOf(target);
    if (!pane || pane.id === this.maximizedId || !pane.canvasRect) return;
    const start = { ...pane.canvasRect };
    const { zoom } = this.view;
    let moved = start;
    drag(event, 'grabbing', (dx, dy) => {
      moved = { ...start, x: start.x + dx / zoom, y: start.y + dy / zoom };
      this.place(pane, moved);
    }, () => {
      if (moved !== start) pane.canvasRect = moved;
    });
  };

  private startResize(event: MouseEvent, pane: Panel): void {
    if (event.button !== 0 || !pane.canvasRect) return;
    event.stopPropagation();
    const start = { ...pane.canvasRect };
    const { zoom } = this.view;
    let resized = start;
    drag(event, 'nwse-resize', (dx, dy) => {
      resized = {
        ...start,
        width: Math.max(MIN_SIZE.width, start.width + dx / zoom),
        height: Math.max(MIN_SIZE.height, start.height + dy / zoom),
      };
      this.place(pane, resized);
    }, () => {
      if (resized !== start) pane.canvasRect = resized;
    });
  }
}
