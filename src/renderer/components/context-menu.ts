import { el } from './panel.js';

export interface MenuItem {
  readonly label: string;
  /** Atalho mostrado a direita (so informativo). */
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly run: () => void;
}

/** `null` desenha um separador. */
export type MenuEntry = MenuItem | null;

/**
 * Menu flutuante do botao direito, na posicao do clique. Fecha ao escolher,
 * com Esc ou clicando fora; setas e Enter navegam pelo teclado.
 */
export function openContextMenu(x: number, y: number, entries: MenuEntry[]): void {
  const menu = el('div', 'context-menu');
  menu.setAttribute('role', 'menu');
  const buttons: HTMLButtonElement[] = [];

  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
  };

  for (const entry of entries) {
    if (!entry) {
      menu.append(el('div', 'context-menu-separator'));
      continue;
    }
    const item = el('button', 'context-menu-item');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.disabled = entry.disabled ?? false;
    item.classList.toggle('danger', entry.danger ?? false);
    const label = el('span', 'context-menu-label');
    label.textContent = entry.label;
    item.append(label);
    if (entry.hint) {
      const hint = el('span', 'context-menu-hint');
      hint.textContent = entry.hint;
      item.append(hint);
    }
    item.addEventListener('click', () => {
      close();
      entry.run();
    });
    menu.append(item);
    if (!item.disabled) buttons.push(item);
  }
  document.body.append(menu);

  // Abre para o lado que cabe na janela.
  const { offsetWidth: width, offsetHeight: height } = menu;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`;
  buttons[0]?.focus();

  const onOutside = (event: MouseEvent) => {
    if (!menu.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent) => {
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowDown') buttons[(index + 1) % buttons.length]?.focus();
    else if (event.key === 'ArrowUp') buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    else if (event.key === 'Tab') close();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
}
