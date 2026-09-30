import {
  capacity,
  equalSizes,
  equalTracks,
  gridTemplate,
  gutters,
  layoutFor,
  resizeTracks,
  type GridLayoutId,
  type TrackSizes,
} from '../../domain/workspace/layout.js';
import type { LayoutSizes } from '../../domain/workspace/config.js';
import { drag, el, type Board, type Panel } from './panel.js';

/** Precisa bater com `.grid { padding; gap }` no CSS. */
const PAD = 8;
const GAP = 8;

/**
 * Posiciona os paineis lado a lado. Quando ha mais paineis do que celulas no
 * layout, pagina em vez de encolher: os paineis fora da pagina continuam vivos,
 * apenas desanexados do DOM. Os divisores entre celulas sao arrastaveis.
 */
export class TerminalGrid implements Board {
  readonly element = el('div', 'grid');
  private layout: GridLayoutId;
  private sizes: LayoutSizes;
  private page = 0;
  private maximizedId: string | null = null;
  private panes: Panel[] = [];
  private gutterEls: HTMLElement[] = [];

  constructor(
    layout: GridLayoutId,
    private readonly onPagesChange: () => void,
    private readonly onSizesChange: (layout: GridLayoutId, sizes: TrackSizes) => void,
  ) {
    this.layout = layout;
    this.sizes = {};
  }

  get currentLayout(): GridLayoutId {
    return this.layout;
  }

  get currentPage(): number {
    return this.page;
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.panes.length / capacity(this.layout)));
  }

  setPanes(panes: Panel[]): void {
    this.panes = panes;
    if (this.maximizedId && !panes.some((pane) => pane.id === this.maximizedId)) {
      this.maximizedId = null;
    }
    this.render();
  }

  setLayout(layout: GridLayoutId): void {
    this.layout = layout;
    this.page = 0;
    this.render();
  }

  setSizes(sizes: LayoutSizes): void {
    this.sizes = { ...sizes };
    this.render();
  }

  setPage(page: number): void {
    this.page = Math.min(Math.max(page, 0), this.pageCount - 1);
    this.render();
  }

  toggleMaximize(id: string): void {
    this.maximizedId = this.maximizedId === id ? null : id;
    this.render();
  }

  revealPane(id: string): void {
    if (this.visiblePanes().some((pane) => pane.id === id)) return;
    if (this.maximizedId) {
      this.maximizedId = id;
      this.render();
      return;
    }
    const index = this.panes.findIndex((pane) => pane.id === id);
    if (index >= 0) this.setPage(Math.floor(index / capacity(this.layout)));
  }

  /** Paineis atualmente visiveis, na ordem em que aparecem. */
  visiblePanes(): Panel[] {
    if (this.maximizedId) {
      const pane = this.panes.find((p) => p.id === this.maximizedId);
      return pane ? [pane] : [];
    }
    const size = capacity(this.layout);
    const start = this.page * size;
    return this.panes.slice(start, start + size);
  }

  /**
   * Layout efetivamente desenhado. Uma pagina incompleta usa a menor grade
   * que comporta o que sobrou (ex.: 3 paineis no layout 4 viram o layout 3),
   * em vez de deixar celulas vazias.
   */
  private shownLayout(count: number): GridLayoutId {
    if (this.maximizedId) return '1';
    return count >= capacity(this.layout) ? this.layout : layoutFor(Math.max(1, count));
  }

  private sizesFor(layout: GridLayoutId): TrackSizes {
    return this.sizes[layout] ?? equalSizes(layout);
  }

  private render(): void {
    if (this.page >= this.pageCount) this.page = this.pageCount - 1;

    const visible = this.visiblePanes();
    const layout = this.shownLayout(visible.length);
    const template = gridTemplate(layout);

    // Remove do DOM apenas o que saiu de vista; os paineis em si continuam vivos.
    for (const child of [...this.element.children]) {
      if (!visible.some((pane) => pane.element === child)) {
        (child as HTMLElement).style.gridArea = '';
        child.remove();
      }
    }
    visible.forEach((pane, index) => {
      const cell = template.cells[index]!;
      pane.element.style.gridArea =
        `${cell.row + 1} / ${cell.col + 1} / span ${cell.rowSpan} / span ${cell.colSpan}`;
      this.element.appendChild(pane.element);
      pane.setMaximized(pane.id === this.maximizedId);
    });

    this.gutterEls = gutters(template).map((gutter) => {
      const node = el('div', `gutter gutter-${gutter.axis}`);
      node.title = 'Arraste para redimensionar · duplo clique iguala';
      node.addEventListener('mousedown', (event) => this.startResize(event, layout, gutter.axis, gutter.boundary));
      node.addEventListener('dblclick', () => this.resetAxis(layout, gutter.axis));
      node.dataset.axis = gutter.axis;
      node.dataset.boundary = String(gutter.boundary);
      node.dataset.from = String(gutter.from);
      node.dataset.to = String(gutter.to);
      this.element.appendChild(node);
      return node;
    });
    this.applyTracks(layout);

    for (const pane of visible) pane.refit();
    this.onPagesChange();
  }

  /** Escreve as proporcoes no CSS da grade e reposiciona os divisores. */
  private applyTracks(layout: GridLayoutId): void {
    const { cols, rows } = this.sizesFor(layout);
    const track = (sizes: number[]) => sizes.map((f) => `minmax(0, ${f}fr)`).join(' ');
    this.element.style.gridTemplateColumns = track(cols);
    this.element.style.gridTemplateRows = track(rows);

    // Posicao em calc(): acompanha o redimensionamento da janela sem JS.
    const offset = (sizes: number[], index: number) => sizes.slice(0, index).reduce((a, b) => a + b, 0);
    const along = (sizes: number[], from: number, to: number) => {
      const free = `(100% - ${PAD * 2 + GAP * (sizes.length - 1)}px)`;
      return {
        start: `calc(${PAD + GAP * from}px + ${free} * ${offset(sizes, from)})`,
        length: `calc(${GAP * (to - from - 1)}px + ${free} * ${offset(sizes, to) - offset(sizes, from)})`,
      };
    };
    for (const node of this.gutterEls) {
      const boundary = Number(node.dataset.boundary);
      const from = Number(node.dataset.from);
      const to = Number(node.dataset.to);
      const across = node.dataset.axis === 'col' ? cols : rows;
      const span = along(node.dataset.axis === 'col' ? rows : cols, from, to);
      const at = along(across, boundary + 1, boundary + 1).start;
      const position = `calc(${at} - ${GAP}px)`;
      if (node.dataset.axis === 'col') {
        Object.assign(node.style, { left: position, width: `${GAP}px`, top: span.start, height: span.length });
      } else {
        Object.assign(node.style, { top: position, height: `${GAP}px`, left: span.start, width: span.length });
      }
    }
  }

  private startResize(event: MouseEvent, layout: GridLayoutId, axis: 'col' | 'row', boundary: number): void {
    const initial = this.sizesFor(layout);
    const tracks = axis === 'col' ? initial.cols : initial.rows;
    const total = axis === 'col' ? this.element.clientWidth : this.element.clientHeight;
    const free = total - PAD * 2 - GAP * (tracks.length - 1);
    if (free <= 0) return;

    let next = initial;
    drag(
      event,
      axis === 'col' ? 'col-resize' : 'row-resize',
      (dx, dy) => {
        const moved = resizeTracks(tracks, boundary, (axis === 'col' ? dx : dy) / free);
        next = axis === 'col' ? { cols: moved, rows: initial.rows } : { cols: initial.cols, rows: moved };
        this.sizes[layout] = next;
        this.applyTracks(layout);
      },
      () => {
        if (next !== initial) this.onSizesChange(layout, next);
      },
    );
  }

  private resetAxis(layout: GridLayoutId, axis: 'col' | 'row'): void {
    const current = this.sizesFor(layout);
    const next = axis === 'col'
      ? { cols: equalTracks(current.cols.length), rows: current.rows }
      : { cols: current.cols, rows: equalTracks(current.rows.length) };
    this.sizes[layout] = next;
    this.applyTracks(layout);
    this.onSizesChange(layout, next);
  }
}
