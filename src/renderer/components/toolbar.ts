import { gridTemplate, LAYOUTS, type LayoutId } from '../../domain/workspace/layout.js';
import type { MultiTermApi } from '../../shared/contract.js';
import { UsageBar } from './usage-bar.js';

export interface ToolbarCallbacks {
  onNewTerminal(): void;
  onNewNote(): void;
  onLayout(layout: LayoutId): void;
  onPage(delta: number): void;
  /** Pular para o proximo terminal que pediu atencao. */
  onNextAttention(): void;
  onRestoreSession(): void;
  onDiscardSession(): void;
}

export class Toolbar {
  readonly element = document.createElement('div');
  private readonly layoutButtons = new Map<LayoutId, HTMLButtonElement>();
  private readonly pageGroup = document.createElement('div');
  private readonly pageLabel = document.createElement('span');
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly attentionBtn = document.createElement('button');
  private readonly sessionGroup = document.createElement('div');
  private readonly restoreBtn = document.createElement('button');

  constructor(private readonly callbacks: ToolbarCallbacks, api: MultiTermApi) {
    this.element.className = 'toolbar';

    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.textContent = 'MultiTerm';

    const newBtn = document.createElement('button');
    newBtn.className = 'primary';
    newBtn.textContent = '+ Terminal';
    newBtn.title = 'Novo terminal (Ctrl+T)';
    newBtn.addEventListener('click', () => this.callbacks.onNewTerminal());

    const noteBtn = document.createElement('button');
    noteBtn.textContent = '+ Nota';
    noteBtn.title = 'Novo bloco de notas (Ctrl+Shift+N)';
    noteBtn.addEventListener('click', () => this.callbacks.onNewNote());

    const layoutGroup = document.createElement('div');
    layoutGroup.className = 'group';
    const layoutLabel = document.createElement('span');
    layoutLabel.className = 'label';
    layoutLabel.textContent = 'Layout';
    layoutGroup.appendChild(layoutLabel);
    for (const layout of LAYOUTS) {
      const btn = document.createElement('button');
      btn.className = 'layout-btn';
      btn.append(layoutIcon(layout));
      btn.title = LAYOUT_TITLES[layout];
      btn.addEventListener('click', () => this.callbacks.onLayout(layout));
      this.layoutButtons.set(layout, btn);
      layoutGroup.appendChild(btn);
    }

    this.pageGroup.className = 'group';
    this.prevBtn = pagerButton('‹', () => this.callbacks.onPage(-1));
    this.nextBtn = pagerButton('›', () => this.callbacks.onPage(1));
    this.pageLabel.className = 'label';
    this.pageGroup.append(this.prevBtn, this.pageLabel, this.nextBtn);

    this.attentionBtn.className = 'attention-btn';
    this.attentionBtn.hidden = true;
    this.attentionBtn.addEventListener('click', () => this.callbacks.onNextAttention());

    this.sessionGroup.className = 'group session-group';
    this.sessionGroup.hidden = true;
    this.restoreBtn.className = 'restore-btn';
    this.restoreBtn.addEventListener('click', () => this.callbacks.onRestoreSession());
    const discardBtn = document.createElement('button');
    discardBtn.textContent = '✕';
    discardBtn.title = 'Descartar a sessao anterior';
    discardBtn.addEventListener('click', () => this.callbacks.onDiscardSession());
    this.sessionGroup.append(this.restoreBtn, discardBtn);

    const spacer = document.createElement('div');
    spacer.className = 'spacer';

    const usage = new UsageBar(api);

    this.element.append(
      brand,
      newBtn,
      noteBtn,
      this.attentionBtn,
      this.sessionGroup,
      spacer,
      usage.element,
      this.pageGroup,
      layoutGroup,
    );
  }

  setLayout(layout: LayoutId): void {
    for (const [id, btn] of this.layoutButtons) {
      btn.classList.toggle('active', id === layout);
    }
  }

  setAttention(count: number): void {
    this.attentionBtn.hidden = count === 0;
    this.attentionBtn.textContent = `● ${count} aguardando`;
    this.attentionBtn.title =
      count === 1
        ? 'Um terminal terminou e esta aguardando voce. Clique para ir ate ele.'
        : `${count} terminais terminaram e estao aguardando voce. Clique para percorre-los.`;
  }

  /** Terminais da sessao anterior esperando restauracao (vazio esconde). */
  setPendingSession(names: string[]): void {
    this.sessionGroup.hidden = names.length === 0;
    this.restoreBtn.textContent = `⟲ Restaurar sessao (${names.length})`;
    this.restoreBtn.title = `Reabre nas mesmas posicoes, com shells novos:\n${names.join('\n')}`;
  }

  setPaging(page: number, pageCount: number): void {
    this.pageGroup.hidden = pageCount <= 1;
    this.pageLabel.textContent = `${page + 1}/${pageCount}`;
    this.prevBtn.disabled = page === 0;
    this.nextBtn.disabled = page >= pageCount - 1;
  }
}

const LAYOUT_TITLES: Record<LayoutId, string> = {
  '1': '1 painel por tela',
  '2': '2 paineis lado a lado',
  '3': '3 paineis: 1 inteiro a esquerda, 2 empilhados a direita',
  '4': '4 paineis (2x2)',
  '6': '6 paineis (3x2)',
  '8': '8 paineis (4x2)',
  free: 'Area livre: arraste e redimensione os paineis a vontade',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Miniatura do layout, desenhada a partir do mesmo template que a grade usa. */
function layoutIcon(layout: LayoutId): SVGSVGElement {
  const W = 20;
  const H = 14;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.classList.add('layout-icon');

  const rect = (x: number, y: number, w: number, h: number) => {
    const node = document.createElementNS(SVG_NS, 'rect');
    for (const [key, value] of Object.entries({ x, y, width: w, height: h, rx: 1 })) {
      node.setAttribute(key, String(value));
    }
    svg.append(node);
  };

  if (layout === 'free') {
    rect(0.5, 0.5, 11, 8);
    rect(8.5, 5.5, 11, 8);
    return svg;
  }
  const { cols, rows, cells } = gridTemplate(layout);
  const gap = 1.5;
  const cw = (W - 1 - gap * (cols - 1)) / cols;
  const ch = (H - 1 - gap * (rows - 1)) / rows;
  for (const cell of cells) {
    rect(
      0.5 + cell.col * (cw + gap),
      0.5 + cell.row * (ch + gap),
      cw * cell.colSpan + gap * (cell.colSpan - 1),
      ch * cell.rowSpan + gap * (cell.rowSpan - 1),
    );
  }
  return svg;
}

function pagerButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}
