export interface PaletteItem {
  readonly label: string;
  /** Texto secundario (diretorio, tipo do painel...). Tambem entra na busca. */
  readonly detail?: string;
  /** Atalho mostrado a direita. */
  readonly hint?: string;
  /** Marca o item com o ponto de "aguardando". */
  readonly attention?: boolean;
  run(): void;
}

/**
 * Lista com busca: digita para filtrar, setas escolhem, Enter executa, Esc
 * fecha. Serve para a paleta de comandos e para escolher um terminal.
 * Resolve quando fecha (executando algo ou nao).
 */
export function openPalette(items: PaletteItem[], placeholder: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay palette-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal palette';
    const input = document.createElement('input');
    input.type = 'text';
    input.spellcheck = false;
    input.placeholder = placeholder;
    const list = document.createElement('ul');
    list.className = 'palette-list';
    modal.append(input, list);
    overlay.append(modal);
    document.body.append(overlay);

    let visible: PaletteItem[] = items;
    let selected = 0;

    const render = () => {
      list.replaceChildren(...visible.map((item, index) => {
        const row = document.createElement('li');
        row.className = 'palette-item';
        row.classList.toggle('selected', index === selected);
        if (item.attention) row.classList.add('attention');
        const label = document.createElement('span');
        label.className = 'palette-label';
        label.textContent = item.label;
        const detail = document.createElement('span');
        detail.className = 'palette-detail';
        detail.textContent = item.detail ?? '';
        const hint = document.createElement('kbd');
        hint.textContent = item.hint ?? '';
        hint.hidden = !item.hint;
        row.append(label, detail, hint);
        row.addEventListener('mousemove', () => {
          if (selected === index) return;
          selected = index;
          render();
        });
        row.addEventListener('mousedown', (event) => {
          event.preventDefault();
          choose(index);
        });
        return row;
      }));
      if (visible.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'palette-empty';
        empty.textContent = 'Nada encontrado.';
        list.append(empty);
      }
      list.children[selected]?.scrollIntoView({ block: 'nearest' });
    };

    let settled = false;
    const close = () => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve();
    };
    const choose = (index: number) => {
      const item = visible[index];
      close();
      item?.run();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      } else if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
        selected = visible.length === 0 ? 0 : (selected + 1) % visible.length;
        render();
      } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
        selected = visible.length === 0 ? 0 : (selected - 1 + visible.length) % visible.length;
        render();
      } else if (event.key === 'Enter') {
        choose(selected);
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    input.addEventListener('input', () => {
      const terms = normalize(input.value).split(/\s+/).filter(Boolean);
      visible = items.filter((item) => {
        const haystack = normalize(`${item.label} ${item.detail ?? ''}`);
        return terms.every((term) => haystack.includes(term));
      });
      selected = 0;
      render();
    });
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey, true);

    render();
    input.focus();
  });
}

/** Busca sem acento e sem caixa: "acao" encontra "Ação". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
