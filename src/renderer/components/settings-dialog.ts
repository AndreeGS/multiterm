import { trapFocus } from './modal.js';

import {
  CURSOR_STYLES,
  DEFAULT_EDITOR,
  DEFAULT_FONT_FAMILY,
  SCROLLBACK_MAX,
  SCROLLBACK_MIN,
  cleanFontFamily,
  type CursorStyle,
  defaultSettings,
  editorArgv,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  THEMES,
  UI_SCALES,
  type Settings,
  type ThemeId,
} from '../../domain/workspace/settings.js';

const CURSOR_LABELS: Record<CursorStyle, string> = { block: '█ Bloco', bar: '▏ Barra', underline: '▁ Sublinhado' };

const THEME_LABELS: Record<ThemeId, { name: string; hint: string }> = {
  dark: { name: 'Escuro', hint: 'O tema original' },
  paper: { name: 'Papel pardo', hint: 'Bege claro, tom de papel kraft' },
};

/**
 * Configuracoes de aparencia. Cada mudanca e aplicada na hora via `onChange`
 * (que tambem persiste), entao nao ha "salvar": fechar mantem o que esta na tela.
 */
export function openSettingsDialog(current: Settings, onChange: (settings: Settings) => void): Promise<void> {
  return new Promise((resolve) => {
    let settings = current;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const modal = document.createElement('div');
    modal.className = 'modal settings';
    modal.innerHTML = `
      <h2>Configuracoes</h2>
      <section>
        <div class="settings-label">Tema</div>
        <div class="theme-options" id="themes"></div>
      </section>
      <section>
        <div class="settings-label">Fonte dos terminais e notas</div>
        <div class="font-row">
          <button type="button" id="font-dec" title="Diminuir">A−</button>
          <input type="range" id="font" min="${FONT_SIZE_MIN}" max="${FONT_SIZE_MAX}" step="1" />
          <button type="button" id="font-inc" title="Aumentar">A+</button>
          <span class="font-value" id="font-value"></span>
        </div>
        <div class="font-preview" id="font-preview">$ claude --continue   # Ola, mundo</div>
      </section>
      <section>
        <label class="settings-label" for="font-family">Fonte dos terminais</label>
        <input type="text" id="font-family" spellcheck="false" placeholder="${DEFAULT_FONT_FAMILY.replace(/"/g, '&quot;')}" />
        <div class="settings-hint">Familias separadas por virgula, a primeira instalada vale; vazio volta ao padrao.</div>
      </section>
      <section>
        <div class="settings-label">Cursor dos terminais</div>
        <div class="segmented" id="cursors"></div>
        <label class="check-row">
          <input type="checkbox" id="cursor-blink" />
          Piscando
        </label>
      </section>
      <section>
        <label class="settings-label" for="scrollback">Historico de cada terminal (linhas)</label>
        <input type="number" id="scrollback" min="${SCROLLBACK_MIN}" max="${SCROLLBACK_MAX}" step="1000" />
        <div class="settings-hint">Mais linhas, mais memoria por terminal. O historico salvo para restaurar a sessao guarda ate 5000.</div>
      </section>
      <section>
        <div class="settings-label">Tamanho da interface</div>
        <div class="segmented" id="scales"></div>
      </section>
      <section>
        <div class="settings-label">Vinculos</div>
        <label class="check-row">
          <input type="checkbox" id="show-links" />
          Na area livre, linha ligando cada nota e lista de tarefas ao terminal vinculado
        </label>
      </section>
      <section>
        <label class="settings-label" for="editor">Editor ("Abrir no editor")</label>
        <input type="text" id="editor" spellcheck="false" placeholder="${DEFAULT_EDITOR}" />
        <div class="settings-hint">Programa e argumentos (ex.: <code>code</code>, <code>cursor</code>, <code>subl -n</code>); o diretorio do terminal vai no fim.</div>
      </section>
      <div class="modal-actions">
        <button type="button" id="reset">Restaurar padrao</button>
        <span class="spacer"></span>
        <button type="button" id="close" class="primary">Fechar</button>
      </div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const release = trapFocus(overlay);

    const themesBox = modal.querySelector<HTMLElement>('#themes')!;
    const fontInput = modal.querySelector<HTMLInputElement>('#font')!;
    const fontValue = modal.querySelector<HTMLElement>('#font-value')!;
    const fontPreview = modal.querySelector<HTMLElement>('#font-preview')!;
    const scalesBox = modal.querySelector<HTMLElement>('#scales')!;
    const showLinks = modal.querySelector<HTMLInputElement>('#show-links')!;
    showLinks.addEventListener('change', () => update({ showLinks: showLinks.checked }));
    const editorInput = modal.querySelector<HTMLInputElement>('#editor')!;
    editorInput.addEventListener('input', () => {
      editorInput.classList.toggle('invalid', !!editorInput.value.trim() && !editorArgv(editorInput.value, '.'));
    });
    // Vale ao sair do campo (ou Enter); vazio volta ao padrao.
    editorInput.addEventListener('change', () => {
      const value = editorInput.value.trim() || DEFAULT_EDITOR;
      if (editorArgv(value, '.')) update({ editorCommand: value });
    });

    const familyInput = modal.querySelector<HTMLInputElement>('#font-family')!;
    familyInput.addEventListener('change', () => update({ fontFamily: cleanFontFamily(familyInput.value) }));
    const blinkInput = modal.querySelector<HTMLInputElement>('#cursor-blink')!;
    blinkInput.addEventListener('change', () => update({ cursorBlink: blinkInput.checked }));
    const scrollbackInput = modal.querySelector<HTMLInputElement>('#scrollback')!;
    scrollbackInput.addEventListener('change', () => {
      const value = Number(scrollbackInput.value);
      if (Number.isFinite(value)) update({ scrollback: Math.round(Math.min(SCROLLBACK_MAX, Math.max(SCROLLBACK_MIN, value))) });
    });
    const cursorButtons = new Map<CursorStyle, HTMLButtonElement>();
    const cursorsBox = modal.querySelector<HTMLElement>('#cursors')!;
    for (const style of CURSOR_STYLES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = CURSOR_LABELS[style];
      btn.addEventListener('click', () => update({ cursorStyle: style }));
      cursorButtons.set(style, btn);
      cursorsBox.appendChild(btn);
    }

    const themeButtons = new Map<ThemeId, HTMLButtonElement>();
    for (const theme of THEMES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-option';
      btn.dataset.swatch = theme;
      btn.innerHTML = `
        <span class="theme-swatch"><span></span><span></span><span></span></span>
        <span class="theme-name">${THEME_LABELS[theme].name}</span>
        <span class="theme-hint">${THEME_LABELS[theme].hint}</span>`;
      btn.addEventListener('click', () => update({ theme }));
      themeButtons.set(theme, btn);
      themesBox.appendChild(btn);
    }

    const scaleButtons = new Map<number, HTMLButtonElement>();
    for (const scale of UI_SCALES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${Math.round(scale * 100)}%`;
      btn.addEventListener('click', () => update({ uiScale: scale }));
      scaleButtons.set(scale, btn);
      scalesBox.appendChild(btn);
    }

    const render = () => {
      for (const [theme, btn] of themeButtons) btn.classList.toggle('active', theme === settings.theme);
      for (const [scale, btn] of scaleButtons) btn.classList.toggle('active', scale === settings.uiScale);
      fontInput.value = String(settings.fontSize);
      fontValue.textContent = `${settings.fontSize}px`;
      fontPreview.style.fontSize = `${settings.fontSize}px`;
      showLinks.checked = settings.showLinks;
      for (const [style, btn] of cursorButtons) btn.classList.toggle('active', style === settings.cursorStyle);
      blinkInput.checked = settings.cursorBlink;
      if (document.activeElement !== familyInput) familyInput.value = settings.fontFamily === DEFAULT_FONT_FAMILY ? '' : settings.fontFamily;
      if (document.activeElement !== scrollbackInput) scrollbackInput.value = String(settings.scrollback);
      fontPreview.style.fontFamily = settings.fontFamily;
      if (document.activeElement !== editorInput) {
        editorInput.value = settings.editorCommand;
        editorInput.classList.remove('invalid');
      }
    };

    const update = (patch: Partial<Settings>) => {
      const next = { ...settings, ...patch };
      next.fontSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, next.fontSize));
      if (JSON.stringify(next) === JSON.stringify(settings)) return;
      settings = next;
      render();
      onChange(settings);
    };

    fontInput.addEventListener('input', () => update({ fontSize: Number(fontInput.value) }));
    modal.querySelector('#font-dec')!.addEventListener('click', () => update({ fontSize: settings.fontSize - 1 }));
    modal.querySelector('#font-inc')!.addEventListener('click', () => update({ fontSize: settings.fontSize + 1 }));
    // O painel de agentes aberto e escolha de layout, nao de aparencia: fica.
    modal.querySelector('#reset')!.addEventListener('click', () => update({ ...defaultSettings(), agentsPanel: settings.agentsPanel }));

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      release();
      resolve();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    modal.querySelector('#close')!.addEventListener('click', close);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey, true);

    render();
    modal.querySelector<HTMLButtonElement>('#close')!.focus();
  });
}
