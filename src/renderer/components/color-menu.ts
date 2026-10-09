import { PANE_COLOR_NAMES, PANE_COLORS, type PaneColor } from '../../domain/workspace/colors.js';
import { el } from './panel.js';

/** Valor de CSS da cor no tema atual (`--pane-<cor>`, definido no styles.css). */
export function paneColorVar(color: PaneColor): string {
  return `var(--pane-${color})`;
}

/**
 * Fileira de bolinhas: "sem cor" e uma por cor. Marca a atual e chama
 * `onPick` ao clicar. Usada no dialogo de novo terminal e no menu de cor.
 */
export function colorSwatches(
  current: PaneColor | null,
  onPick: (color: PaneColor | null) => void,
): HTMLElement {
  const row = el('div', 'swatches');
  const options: Array<PaneColor | null> = [null, ...PANE_COLORS];
  const buttons = options.map((color) => {
    const swatch = el('button', 'swatch');
    swatch.type = 'button';
    swatch.title = color ? PANE_COLOR_NAMES[color] : 'Sem cor';
    if (color) swatch.style.setProperty('--swatch', paneColorVar(color));
    else swatch.classList.add('none');
    swatch.addEventListener('click', (event) => {
      event.stopPropagation();
      for (const other of buttons) other.classList.toggle('selected', other === swatch);
      onPick(color);
    });
    swatch.classList.toggle('selected', color === current);
    return swatch;
  });
  row.append(...buttons);
  return row;
}

/**
 * Menu flutuante de cores, logo abaixo de `anchor`. Resolve com a cor
 * escolhida (`null` = sem cor) ou `undefined` se fechar sem escolher.
 */
export function openColorMenu(anchor: HTMLElement, current: PaneColor | null): Promise<PaneColor | null | undefined> {
  return new Promise((resolve) => {
    let done = false;
    const close = (result: PaneColor | null | undefined) => {
      if (done) return;
      done = true;
      menu.remove();
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    const menu = el('div', 'color-menu');
    menu.append(colorSwatches(current, (color) => close(color)));
    document.body.append(menu);

    const box = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    menu.style.left = `${Math.max(4, Math.min(box.right - width, window.innerWidth - width - 4))}px`;
    menu.style.top = `${box.bottom + 4}px`;

    const onOutside = (event: MouseEvent) => {
      if (!menu.contains(event.target as Node)) close(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close(undefined);
    };
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  });
}
