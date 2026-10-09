/**
 * Pergunta um texto curto (nome de workspace...). O Electron nao implementa
 * `window.prompt`. Resolve com o texto sem espacos nas pontas, ou `null` se
 * cancelar ou deixar vazio.
 */
export function openPrompt(title: string, initial = '', placeholder = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal prompt';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const input = document.createElement('input');
    input.type = 'text';
    input.spellcheck = false;
    input.value = initial;
    input.placeholder = placeholder;
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'primary';
    ok.textContent = 'OK';
    actions.append(cancel, ok);
    modal.append(heading, input, actions);
    overlay.append(modal);
    document.body.append(overlay);

    let settled = false;
    const close = (value: string | null) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value?.trim() || null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(null);
      else if (event.key === 'Enter') close(input.value);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    cancel.addEventListener('click', () => close(null));
    ok.addEventListener('click', () => close(input.value));
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close(null);
    });
    document.addEventListener('keydown', onKey, true);
    input.focus();
    input.select();
  });
}
