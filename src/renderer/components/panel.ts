import type { CanvasRect } from '../../domain/workspace/layout.js';
import type { Appearance } from '../theme.js';

/**
 * O que a grade e a area livre precisam de um painel. Terminais e notas
 * implementam esta interface; nenhum dos dois sabe onde esta sendo exibido.
 */
export interface Panel {
  readonly id: string;
  /** Workspace a que pertence: so aparece quando ele esta em uso. */
  readonly workspaceId: string;
  /** Raiz do painel. Sobrevive a trocas de layout: so e reposicionada. */
  readonly element: HTMLElement;
  /** Cabecalho, usado como alca para arrastar na area livre. */
  readonly header: HTMLElement;
  /** Posicao na area livre; a area livre le e grava, o painel so guarda. */
  canvasRect: CanvasRect | null;
  refit(): void;
  focus(): void;
  setFocused(focused: boolean): void;
  setMaximized(maximized: boolean): void;
  /** Zoom da area livre: o painel escala a propria fonte (1 = normal). */
  setScale(scale: number): void;
  /** Tema e tamanho de fonte vindos das configuracoes. */
  setAppearance(appearance: Appearance): void;
  dispose(): void;
}

/** Exibe um conjunto de paineis: a grade (com paginas) ou a area livre. */
export interface Board {
  readonly element: HTMLElement;
  readonly currentPage: number;
  readonly pageCount: number;
  setPanes(panes: Panel[]): void;
  setPage(page: number): void;
  toggleMaximize(id: string): void;
  /** Traz um painel para a tela (troca de pagina ou move a vista). */
  revealPane(id: string): void;
  visiblePanes(): Panel[];
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.textContent = label;
  node.title = title;
  node.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return node;
}

/**
 * Arrasto com o mouse: segue o ponteiro na janela inteira ate soltar, e marca
 * o body para que terminais nao roubem os eventos nem selecionem texto.
 */
export function drag(
  start: MouseEvent,
  cursor: string,
  onMove: (dx: number, dy: number) => void,
  onEnd?: () => void,
): void {
  start.preventDefault();
  const { clientX, clientY } = start;
  document.body.classList.add('dragging');
  document.body.style.cursor = cursor;
  const move = (event: MouseEvent) => onMove(event.clientX - clientX, event.clientY - clientY);
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    document.body.classList.remove('dragging');
    document.body.style.cursor = '';
    onEnd?.();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

/** Renomeacao inline: troca o texto por um input ate Enter/blur (ou Esc). */
export function beginRename(target: HTMLElement, current: string, onCommit: (name: string) => void): void {
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = current;
  target.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    input.replaceWith(target);
    if (commit && input.value.trim()) onCommit(input.value);
  };
  input.addEventListener('blur', () => finish(true), { once: true });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') finish(false);
    event.stopPropagation();
  });
}

export interface LinkCallbacks {
  /** Mousedown no 🔗: clicar abre a lista, arrastar ate um terminal vincula. */
  onLinkGesture(sourceId: string, event: MouseEvent): void;
  /** Teclado (Enter/Espaco no 🔗): abre a lista de terminais. */
  onLinkPick(sourceId: string): void;
}

/** O que mostrar no 🔗: nome do terminal, e se ele esta aberto agora. */
export interface LinkLabel {
  readonly name: string;
  /** `false` = terminal da sessao anterior ainda nao restaurado. */
  readonly open: boolean;
}

/** Botao 🔗 do cabecalho de notas e listas. */
export function linkChip(sourceId: () => string, callbacks: LinkCallbacks): HTMLButtonElement {
  const chip = el('button', 'link-chip');
  chip.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    // Sem isto o cabecalho da area livre comecaria a arrastar o painel.
    event.stopPropagation();
    event.preventDefault();
    callbacks.onLinkGesture(sourceId(), event);
  });
  chip.addEventListener('click', (event) => {
    event.stopPropagation();
    // detail 0 = clique vindo do teclado; o do mouse ja foi tratado no mousedown.
    if (event.detail === 0) callbacks.onLinkPick(sourceId());
  });
  return chip;
}

export function renderLinkChip(chip: HTMLButtonElement, label: LinkLabel | null): void {
  chip.classList.toggle('linked', label !== null);
  chip.classList.toggle('missing', label !== null && !label.open);
  chip.textContent = label ? `🔗 ${label.name}` : '🔗 vincular';
  chip.title = label
    ? (label.open
        ? `Vinculado ao terminal "${label.name}".`
        : `Vinculado a "${label.name}", da sessao anterior (ainda nao restaurado).`) +
      '\nClique para trocar ou remover · arraste ate um terminal para vincular a ele'
    : 'Vincular a um terminal: clique para escolher, ou arraste ate o terminal';
}
