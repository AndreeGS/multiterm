/**
 * Confirmacao e aviso dentro da propria janela. Os nativos (`window.confirm`,
 * `window.alert`) do Electron bloqueiam o renderer e, no Linux, podem nunca
 * aparecer — o app inteiro fica travado esperando um clique impossivel.
 */

export interface ConfirmOptions {
  readonly title: string;
  /** Pode ter quebras de linha. */
  readonly message?: string;
  readonly confirmLabel?: string;
  /** Botao de confirmar vermelho: a acao apaga algo. */
  readonly danger?: boolean;
}

/** Resolve `true` so se o usuario confirmar (Enter ou o botao); Esc e fora cancelam. */
export function openConfirm({ title, message, confirmLabel = 'OK', danger = false }: ConfirmOptions): Promise<boolean> {
  return showDialog(title, message, [
    { label: 'Cancelar', value: false },
    { label: confirmLabel, value: true, primary: true, danger },
  ]);
}

/** Aviso com um botao so. */
export async function openAlert(title: string, message?: string): Promise<void> {
  await showDialog(title, message, [{ label: 'OK', value: true, primary: true }]);
}

interface DialogButton {
  readonly label: string;
  readonly value: boolean;
  readonly primary?: boolean;
  readonly danger?: boolean;
}

function showDialog(title: string, message: string | undefined, buttons: DialogButton[]): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const overlay = document.createElement('div');
    overlay.className = 'overlay dialog-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal dialog';
    modal.setAttribute('role', 'alertdialog');
    const heading = document.createElement('h2');
    heading.textContent = title;
    modal.append(heading);
    if (message) {
      const body = document.createElement('p');
      body.className = 'dialog-message';
      body.textContent = message;
      modal.append(body);
    }
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    let primary: HTMLButtonElement | null = null;
    const values = new Map<Element, boolean>();
    for (const spec of buttons) {
      const node = document.createElement('button');
      node.type = 'button';
      node.textContent = spec.label;
      if (spec.primary) node.className = spec.danger ? 'primary danger' : 'primary';
      node.addEventListener('click', () => close(spec.value));
      values.set(node, spec.value);
      if (spec.primary) primary = node;
      actions.append(node);
    }
    modal.append(actions);
    overlay.append(modal);
    document.body.append(overlay);

    let settled = false;
    function close(value: boolean): void {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
      resolve(value);
    }
    // Captura no document: nada atras do modal (terminal, atalhos) recebe tecla nenhuma.
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Tab') return; // navega entre os botoes
      event.preventDefault();
      event.stopPropagation();
      // Enter vale o botao em foco (comeca no de confirmar).
      if (event.key === 'Escape') close(false);
      else if (event.key === 'Enter') close(values.get(document.activeElement as Element) ?? true);
    }
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close(false);
    });
    document.addEventListener('keydown', onKey, true);
    (primary as HTMLButtonElement | null)?.focus();
  });
}
