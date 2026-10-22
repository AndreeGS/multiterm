/** Aparencia escolhida pelo usuario no dialogo de configuracoes. */

export type ThemeId = 'dark' | 'paper';

export const THEMES: readonly ThemeId[] = ['dark', 'paper'];

export interface Settings {
  theme: ThemeId;
  /** Fonte dos terminais e notas, em px (antes do zoom da area livre). */
  fontSize: number;
  /** Escala da interface (barra, cabecalhos, dialogos). 1 = normal. */
  uiScale: number;
  /** Linha ligando cada nota/lista ao terminal vinculado (so na area livre). */
  showLinks: boolean;
  /**
   * Programa para "Abrir no editor" (ex.: `code`, `cursor`, `subl -n`). O
   * diretorio do terminal vai como ultimo argumento; sem shell.
   */
  editorCommand: string;
}

export const FONT_SIZE_MIN = 9;
export const FONT_SIZE_MAX = 24;
export const UI_SCALES: readonly number[] = [0.9, 1, 1.1, 1.25, 1.4];
export const DEFAULT_EDITOR = 'code';
const MAX_EDITOR_COMMAND = 200;

export function defaultSettings(): Settings {
  return { theme: 'dark', fontSize: 12, uiScale: 1, showLinks: true, editorCommand: DEFAULT_EDITOR };
}

export function isTheme(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Qualquer campo invalido cai no padrao; tamanhos sao limitados a faixa aceita. */
export function parseSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return base;
  const input = raw as Record<string, unknown>;
  if (isTheme(input.theme)) base.theme = input.theme;
  if (typeof input.fontSize === 'number' && Number.isFinite(input.fontSize)) {
    base.fontSize = Math.round(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, input.fontSize)));
  }
  if (typeof input.uiScale === 'number' && UI_SCALES.includes(input.uiScale)) {
    base.uiScale = input.uiScale;
  }
  if (typeof input.showLinks === 'boolean') base.showLinks = input.showLinks;
  if (typeof input.editorCommand === 'string' && editorArgv(input.editorCommand, '.')) {
    base.editorCommand = input.editorCommand.trim();
  }
  return base;
}

/**
 * Programa e argumentos para abrir `dir` no editor: as palavras do comando
 * (separadas por espaco, sem aspas nem shell) e o diretorio no fim. `null` =
 * comando vazio ou invalido.
 */
export function editorArgv(command: string, dir: string): [string, ...string[]] | null {
  if (command.length > MAX_EDITOR_COMMAND || /[\x00-\x1f\x7f]/.test(command)) return null;
  const [program, ...args] = command.trim().split(/\s+/).filter(Boolean);
  return program ? [program, ...args, dir] : null;
}

/** Cor de fundo da janela antes do renderer pintar (evita um flash escuro no tema claro). */
export const WINDOW_BACKGROUND: Record<ThemeId, string> = {
  dark: '#0f1116',
  paper: '#e6d9bf',
};
