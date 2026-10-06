import {
  defaultSettings,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  THEMES,
  UI_SCALES,
  type Settings,
  type ThemeId,
} from '../../domain/workspace/settings.js';

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
        <div class="settings-label">Tamanho da interface</div>
        <div class="segmented" id="scales"></div>
      </section>
      <div class="modal-actions">
        <button type="button" id="reset">Restaurar padrao</button>
        <span class="spacer"></span>
        <button type="button" id="close" class="primary">Fechar</button>
      </div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const themesBox = modal.querySelector<HTMLElement>('#themes')!;
    const fontInput = modal.querySelector<HTMLInputElement>('#font')!;
    const fontValue = modal.querySelector<HTMLElement>('#font-value')!;
    const fontPreview = modal.querySelector<HTMLElement>('#font-preview')!;
    const scalesBox = modal.querySelector<HTMLElement>('#scales')!;

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
    modal.querySelector('#reset')!.addEventListener('click', () => update(defaultSettings()));

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
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
