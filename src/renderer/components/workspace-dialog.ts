import { MAX_WORKSPACE_NAME } from '../../domain/workspace/workspace.js';
import { el } from './panel.js';

/** Um workspace na lista, com o que o App sabe dele. */
export interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly terminals: number;
  /** Paineis de qualquer tipo (terminais, notas, listas). */
  readonly panes: number;
  readonly waiting: number;
}

/** O que o usuario escolheu; o App executa depois que o dialogo fecha. */
export type WorkspaceAction =
  | { readonly kind: 'switch'; readonly id: string }
  | { readonly kind: 'create'; readonly name: string }
  | { readonly kind: 'rename'; readonly id: string; readonly name: string }
  | { readonly kind: 'delete'; readonly id: string };

/**
 * Lista de workspaces: clicar no nome troca; ✎ renomeia ali mesmo; 🗑 pede
 * confirmacao na propria linha, dizendo o que vai junto. Embaixo, o campo
 * para criar um novo. Resolve com a acao escolhida, ou `null` (Esc, fora).
 */
export function openWorkspaceDialog(rows: WorkspaceRow[], canCreate: boolean): Promise<WorkspaceAction | null> {
  return new Promise((resolve) => {
    const overlay = el('div', 'overlay palette-overlay');
    const modal = el('div', 'modal workspaces');
    const heading = el('h2', '');
    heading.textContent = 'Workspaces';
    const list = el('ul', 'workspace-list');
    const createRow = el('form', 'workspace-create');
    const createInput = el('input', '');
    createInput.type = 'text';
    createInput.spellcheck = false;
    createInput.maxLength = MAX_WORKSPACE_NAME;
    createInput.placeholder = canCreate ? 'Novo workspace — ex.: Projeto X, Infra' : 'Limite de workspaces atingido';
    createInput.disabled = !canCreate;
    const createBtn = el('button', 'primary');
    createBtn.type = 'submit';
    createBtn.textContent = 'Criar';
    createBtn.disabled = !canCreate;
    createRow.append(createInput, createBtn);
    modal.append(heading, list, createRow);
    overlay.append(modal);
    document.body.append(overlay);

    let settled = false;
    const close = (action: WorkspaceAction | null) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(action);
    };

    /** Linha em modo de edicao/confirmacao; Esc volta ela ao normal antes de fechar o dialogo. */
    let editing: (() => void) | null = null;

    const renderRow = (row: WorkspaceRow): HTMLLIElement => {
      const item = el('li', 'workspace-row');
      item.classList.toggle('active', row.active);

      const showNormal = () => {
        editing = null;
        const name = el('button', 'workspace-name');
        name.type = 'button';
        name.textContent = row.name;
        name.title = row.active ? 'Workspace em uso' : `Trocar para "${row.name}"`;
        name.addEventListener('click', () => close({ kind: 'switch', id: row.id }));
        const detail = el('span', 'workspace-detail');
        detail.textContent = [
          row.active ? 'em uso' : '',
          `${row.terminals} ${row.terminals === 1 ? 'terminal' : 'terminais'}`,
          row.waiting ? `● ${row.waiting} aguardando` : '',
        ].filter(Boolean).join(' · ');
        detail.classList.toggle('waiting', row.waiting > 0);
        const rename = el('button', 'icon-btn');
        rename.type = 'button';
        rename.textContent = '✎';
        rename.title = 'Renomear';
        rename.addEventListener('click', showRename);
        const remove = el('button', 'icon-btn danger');
        remove.type = 'button';
        remove.textContent = '🗑';
        remove.title = rows.length > 1 ? 'Apagar' : 'O ultimo workspace nao pode ser apagado';
        remove.disabled = rows.length <= 1;
        remove.addEventListener('click', showDelete);
        item.replaceChildren(name, detail, rename, remove);
      };

      const showRename = () => {
        editing?.();
        editing = showNormal;
        const form = el('form', 'workspace-rename');
        const input = el('input', '');
        input.type = 'text';
        input.spellcheck = false;
        input.maxLength = MAX_WORKSPACE_NAME;
        input.value = row.name;
        const save = el('button', 'primary');
        save.type = 'submit';
        save.textContent = 'Salvar';
        const cancel = el('button', '');
        cancel.type = 'button';
        cancel.textContent = 'Cancelar';
        cancel.addEventListener('click', showNormal);
        form.append(input, save, cancel);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const name = input.value.trim();
          if (!name || name === row.name) showNormal();
          else close({ kind: 'rename', id: row.id, name });
        });
        item.replaceChildren(form);
        input.focus();
        input.select();
      };

      const showDelete = () => {
        editing?.();
        editing = showNormal;
        const what = [
          row.terminals ? `${row.terminals} ${row.terminals === 1 ? 'terminal' : 'terminais'} (encerrados)` : '',
          row.panes - row.terminals ? `${row.panes - row.terminals} nota${row.panes - row.terminals === 1 ? '' : 's'}/lista${row.panes - row.terminals === 1 ? '' : 's'}` : '',
          'textos e grupos',
        ].filter(Boolean).join(', ');
        const text = el('span', 'workspace-confirm');
        text.textContent = `Apagar "${row.name}"? Vai junto: ${what}.`;
        const confirm = el('button', 'primary danger');
        confirm.type = 'button';
        confirm.textContent = 'Apagar';
        confirm.addEventListener('click', () => close({ kind: 'delete', id: row.id }));
        const cancel = el('button', '');
        cancel.type = 'button';
        cancel.textContent = 'Cancelar';
        cancel.addEventListener('click', showNormal);
        item.replaceChildren(text, cancel, confirm);
        cancel.focus();
      };

      showNormal();
      return item;
    };

    list.append(...rows.map(renderRow));

    createRow.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = createInput.value.trim();
      if (name) close({ kind: 'create', name });
      else createInput.focus();
    });

    function onKey(event: KeyboardEvent): void {
      // Teclas ficam no dialogo: nem o terminal nem os atalhos do app recebem.
      event.stopPropagation();
      if (event.key === 'Enter') {
        // Enter num campo envia o formulario dele (criar ou renomear).
        const form = (event.target as HTMLElement).closest?.('form');
        if (form && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          form.requestSubmit();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (editing) editing();
      else close(null);
    }
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close(null);
    });
    document.addEventListener('keydown', onKey, true);
    if (canCreate) createInput.focus();
  });
}
