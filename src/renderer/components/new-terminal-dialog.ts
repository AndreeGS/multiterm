import type { TerminalSpec } from '../../domain/terminal/types.js';
import type { PaneColor } from '../../domain/workspace/colors.js';
import type { TerminalTemplate } from '../../domain/workspace/template.js';
import type { MultiTermApi } from '../../shared/contract.js';
import { shortenPath } from '../paths.js';
import { colorSwatches, paneColorVar } from './color-menu.js';

/** Sugestoes fixas; os comandos que voce usou aparecem antes delas. */
const COMMAND_PRESETS = ['claude', 'claude --continue', 'codex', 'npm run dev'];

export interface NewTerminalOptions {
  readonly recentDirs: string[];
  readonly defaultDir: string;
  readonly recentCommands: string[];
  readonly templates: TerminalTemplate[];
}

export interface NewTerminalResult {
  readonly spec: TerminalSpec;
  /** Marcou "Salvar como template". */
  readonly saveAsTemplate: boolean;
}

/**
 * Dialogo de criacao. Nada e executado aqui: apenas coleta diretorio, comando
 * inicial, nome e cor. Resolve com `null` se o usuario cancelar.
 */
export function openNewTerminalDialog(
  api: MultiTermApi,
  { recentDirs, defaultDir, recentCommands, templates }: NewTerminalOptions,
): Promise<NewTerminalResult | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <h2>Novo terminal</h2>
      <div class="recent templates" id="templates"></div>
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
      <div class="field">
        <span class="field-label">Cor</span>
        <span id="colors"></span>
      </div>
      <label class="check-row"><input type="checkbox" id="save-template" /> Salvar como template</label>
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
    const templatesBox = modal.querySelector<HTMLElement>('#templates')!;
    const colorsBox = modal.querySelector<HTMLElement>('#colors')!;
    const saveTemplate = modal.querySelector<HTMLInputElement>('#save-template')!;

    dirInput.value = defaultDir;

    let color: PaneColor | null = null;
    const setColor = (next: PaneColor | null) => {
      color = next;
      colorsBox.replaceChildren(colorSwatches(color, (picked) => {
        color = picked;
      }));
    };
    setColor(null);

    // Um template preenche o formulario inteiro; da para ajustar antes de criar.
    templatesBox.hidden = templates.length === 0;
    for (const template of templates) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'template-chip';
      chip.textContent = template.name;
      chip.title = `${template.cwd}${template.command ? `\n${template.command}` : ''}`;
      if (template.color) chip.style.setProperty('--chip-color', paneColorVar(template.color));
      chip.addEventListener('click', () => {
        dirInput.value = template.cwd;
        commandInput.value = template.command;
        nameInput.value = template.name;
        setColor(template.color);
        modal.querySelector<HTMLButtonElement>('#create')!.focus();
      });
      templatesBox.appendChild(chip);
    }

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
    const close = (result: NewTerminalResult | null) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };

    const submit = () => {
      const cwd = dirInput.value.trim();
      if (!cwd) {
        dirInput.focus();
        return;
      }
      close({
        spec: { cwd, name: nameInput.value.trim(), command: commandInput.value.trim(), color },
        saveAsTemplate: saveTemplate.checked,
      });
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
