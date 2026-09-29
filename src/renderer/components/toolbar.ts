import { LAYOUTS, type LayoutId } from '../../domain/workspace/layout.js';
import type { MultiTermApi } from '../../shared/contract.js';
import { UsageBar } from './usage-bar.js';

export interface ToolbarCallbacks {
  onNewTerminal(): void;
  onLayout(layout: LayoutId): void;
  onPage(delta: number): void;
  /** Pular para o proximo terminal que pediu atencao. */
  onNextAttention(): void;
}

export class Toolbar {
  readonly element = document.createElement('div');
  private readonly layoutButtons = new Map<LayoutId, HTMLButtonElement>();
  private readonly pageGroup = document.createElement('div');
  private readonly pageLabel = document.createElement('span');
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly attentionBtn = document.createElement('button');

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

    const layoutGroup = document.createElement('div');
    layoutGroup.className = 'group';
    const layoutLabel = document.createElement('span');
    layoutLabel.className = 'label';
    layoutLabel.textContent = 'Layout';
    layoutGroup.appendChild(layoutLabel);
    for (const layout of LAYOUTS) {
      const btn = document.createElement('button');
      btn.className = 'layout-btn';
      btn.textContent = layout;
      btn.title = `${layout} terminal(is) por tela`;
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

    const spacer = document.createElement('div');
    spacer.className = 'spacer';

    const usage = new UsageBar(api);

    this.element.append(
      brand,
      newBtn,
      this.attentionBtn,
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

  setPaging(page: number, pageCount: number): void {
    this.pageGroup.hidden = pageCount <= 1;
    this.pageLabel.textContent = `${page + 1}/${pageCount}`;
    this.prevBtn.disabled = page === 0;
    this.nextBtn.disabled = page >= pageCount - 1;
  }
}

function pagerButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}
