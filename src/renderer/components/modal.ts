const FOCUSABLE = 'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])';

/**
 * Comportamento comum dos modais: o Tab circula so dentro deles (senao ia
 * parar no terminal atras do overlay, e o que voce digitasse iria para o
 * shell) e leitores de tela sabem que o resto da janela esta inerte.
 */
export function trapFocus(overlay: HTMLElement): void {
  const dialog = overlay.querySelector<HTMLElement>('[role]') ?? overlay.firstElementChild as HTMLElement | null;
  if (dialog && !dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
  dialog?.setAttribute('aria-modal', 'true');

  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const items = [...overlay.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => !(node as HTMLButtonElement).disabled && node.offsetParent !== null,
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !overlay.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !overlay.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });
}
