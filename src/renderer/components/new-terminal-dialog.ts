import type { TerminalSpec } from '../../domain/terminal/types.js';
import type { MultiTermApi } from '../../shared/contract.js';
import { shortenPath } from '../paths.js';

/** Sugestoes fixas; os comandos que voce usou aparecem antes delas. */
const COMMAND_PRESETS = ['claude', 'claude --continue', 'codex', 'npm run dev'];

/**
 * Dialogo de criacao. Nada e executado aqui: apenas coleta diretorio, comando
 * inicial e nome. Resolve com `null` se o usuario cancelar.
 */
export function openNewTerminalDialog(
  api: MultiTermApi,
  recentDirs: string[],
  defaultDir: string,
  recentCommands: string[],
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
      <label>Comando inicial (opcional)
        <input type="text" id="command" spellcheck="false" placeholder="so o shell — ex.: claude, npm run dev" />
      </label>
      <div class="recent" id="commands"></div>
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
    const commandInput = modal.querySelector<HTMLInputElement>('#command')!;
    const commandsBox = modal.querySelector<HTMLElement>('#commands')!;

    dirInput.value = defaultDir;

    for (const dir of recentDirs) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = shortenPath(dir, 2);
      chip.title = dir;
      chip.addEventListener('click', () => {
        dirInput.value = dir;
        commandInput.focus();
      });
      recentBox.appendChild(chip);
    }

    const commands = [...recentCommands, ...COMMAND_PRESETS.filter((c) => !recentCommands.includes(c))];
    for (const command of commands) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = command;
      chip.title = `Ao abrir, digita "${command}" no shell (e de novo a cada reinicio)`;
      chip.addEventListener('click', () => {
        commandInput.value = command;
        nameInput.focus();
      });
      commandsBox.appendChild(chip);
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
      close({ cwd, name: nameInput.value.trim(), command: commandInput.value.trim() });
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(null);
      }
      // Enter num chip escolhe o chip; nos campos, cria o terminal.
      if (event.key === 'Enter' && !(document.activeElement instanceof HTMLButtonElement)) {
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
