import { gridShape, type LayoutId } from '../../domain/workspace/layout.js';
import type { TerminalPane } from './terminal-pane.js';

/**
 * Posiciona os paineis. Quando ha mais terminais do que celulas no layout,
 * pagina em vez de encolher: os paineis fora da pagina continuam vivos,
 * apenas desanexados do DOM.
 */
export class TerminalGrid {
  readonly element = document.createElement('div');
  private layout: LayoutId;
  private page = 0;
  private maximizedId: string | null = null;
  private panes: TerminalPane[] = [];

  constructor(layout: LayoutId, private readonly onPagesChange: () => void) {
    this.element.className = 'grid';
    this.layout = layout;
  }

  get currentLayout(): LayoutId {
    return this.layout;
  }

  get currentPage(): number {
    return this.page;
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.panes.length / this.capacity()));
  }

  get maximized(): string | null {
    return this.maximizedId;
  }

  setPanes(panes: TerminalPane[]): void {
    this.panes = panes;
    if (this.maximizedId && !panes.some((pane) => pane.id === this.maximizedId)) {
      this.maximizedId = null;
    }
    this.render();
  }

  setLayout(layout: LayoutId): void {
    this.layout = layout;
    this.page = 0;
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

  /** Traz um painel para a tela, trocando de pagina se necessario. */
  revealPane(id: string): void {
    if (this.visiblePanes().some((pane) => pane.id === id)) return;
    if (this.maximizedId) {
      this.maximizedId = id;
      this.render();
      return;
    }
    const index = this.panes.findIndex((pane) => pane.id === id);
    if (index >= 0) this.setPage(Math.floor(index / this.capacity()));
  }

  /** Paineis atualmente visiveis, na ordem em que aparecem. */
  visiblePanes(): TerminalPane[] {
    if (this.maximizedId) {
      const pane = this.panes.find((p) => p.id === this.maximizedId);
      return pane ? [pane] : [];
    }
    const size = this.capacity();
    const start = this.page * size;
    return this.panes.slice(start, start + size);
  }

  private capacity(): number {
    const { cols, rows } = gridShape(this.layout);
    return cols * rows;
  }

  private render(): void {
    if (this.page >= this.pageCount) this.page = this.pageCount - 1;

    const visible = this.visiblePanes();
    const { cols, rows } = this.maximizedId ? { cols: 1, rows: 1 } : gridShape(this.layout);
    this.element.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    this.element.style.gridTemplateRows = `repeat(${Math.min(rows, Math.max(1, Math.ceil(visible.length / cols)))}, minmax(0, 1fr))`;

    // Remove do DOM apenas o que saiu de vista; os paineis em si continuam vivos.
    for (const child of [...this.element.children]) {
      if (!visible.some((pane) => pane.element === child)) child.remove();
    }
    for (const pane of visible) {
      this.element.appendChild(pane.element);
      pane.setMaximized(pane.id === this.maximizedId);
    }

    for (const pane of visible) pane.refit();
    this.onPagesChange();
  }
}
