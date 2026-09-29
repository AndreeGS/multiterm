import type { TerminalSpec } from '../../domain/terminal/types.js';
import type { MultiTermApi } from '../../shared/contract.js';
import { shortenPath } from '../paths.js';

/**
 * Dialogo de criacao. Nada e executado aqui: apenas coleta nome + diretorio.
 * Resolve com `null` se o usuario cancelar.
 */
export function openNewTerminalDialog(
  api: MultiTermApi,
  recentDirs: string[],
  defaultDir: string,
): Promise<TerminalSpec | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <h2>Novo terminal</h2>
      <label>Diretorio do projeto
        <span class="dir-row">
          <input type="text" id="dir" spellcheck="false" />
          <button type="button" id="browse">Procurar…</button>
        </span>
      </label>
      <div class="recent" id="recent"></div>
      <label>Nome (opcional)
        <input type="text" id="name" spellcheck="false" placeholder="derivado do diretorio" />
      </label>
      <div class="modal-actions">
        <button type="button" id="cancel">Cancelar</button>
        <button type="button" id="create" class="primary">Criar terminal</button>
      </div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const dirInput = modal.querySelector<HTMLInputElement>('#dir')!;
    const nameInput = modal.querySelector<HTMLInputElement>('#name')!;
    const recentBox = modal.querySelector<HTMLElement>('#recent')!;

    dirInput.value = defaultDir;

    for (const dir of recentDirs) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = shortenPath(dir, 2);
      chip.title = dir;
      chip.addEventListener('click', () => {
        dirInput.value = dir;
        nameInput.focus();
      });
      recentBox.appendChild(chip);
    }

    let settled = false;
    const close = (spec: TerminalSpec | null) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(spec);
    };

    const submit = () => {
      const cwd = dirInput.value.trim();
      if (!cwd) {
        dirInput.focus();
        return;
      }
      close({ cwd, name: nameInput.value.trim() });
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(null);
      }
      if (event.key === 'Enter' && document.activeElement !== recentBox) {
        event.stopPropagation();
        submit();
      }
    };

    modal.querySelector('#browse')!.addEventListener('click', async () => {
      const picked = await api.pickDirectory(dirInput.value.trim() || defaultDir);
      if (picked) dirInput.value = picked;
      dirInput.focus();
    });
    modal.querySelector('#cancel')!.addEventListener('click', () => close(null));
    modal.querySelector('#create')!.addEventListener('click', submit);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close(null);
    });
    document.addEventListener('keydown', onKey, true);

    dirInput.focus();
    dirInput.select();
  });
}
