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
  /** Painel lateral com todos os agentes aberto. */
  agentsPanel: boolean;
  /** Fonte dos terminais (lista CSS de familias). */
  fontFamily: string;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  /** Linhas guardadas no historico de cada terminal. */
  scrollback: number;
}

export type CursorStyle = 'block' | 'bar' | 'underline';
export const CURSOR_STYLES: readonly CursorStyle[] = ['block', 'bar', 'underline'];
export const DEFAULT_FONT_FAMILY = 'ui-monospace, "JetBrains Mono", "Fira Code", Menlo, monospace';
export const SCROLLBACK_MIN = 1000;
export const SCROLLBACK_MAX = 100_000;
const MAX_FONT_FAMILY = 200;

export const FONT_SIZE_MIN = 9;
export const FONT_SIZE_MAX = 24;
export const UI_SCALES: readonly number[] = [0.9, 1, 1.1, 1.25, 1.4];
export const DEFAULT_EDITOR = 'code';
const MAX_EDITOR_COMMAND = 200;

export function defaultSettings(): Settings {
  return {
    theme: 'dark',
    fontSize: 12,
    uiScale: 1,
    showLinks: true,
    editorCommand: DEFAULT_EDITOR,
    agentsPanel: false,
    fontFamily: DEFAULT_FONT_FAMILY,
    cursorStyle: 'block',
    cursorBlink: true,
    scrollback: 10_000,
  };
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
  if (typeof input.agentsPanel === 'boolean') base.agentsPanel = input.agentsPanel;
  if (typeof input.fontFamily === 'string') base.fontFamily = cleanFontFamily(input.fontFamily);
  if (typeof input.cursorStyle === 'string' && (CURSOR_STYLES as readonly string[]).includes(input.cursorStyle)) {
    base.cursorStyle = input.cursorStyle as CursorStyle;
  }
  if (typeof input.cursorBlink === 'boolean') base.cursorBlink = input.cursorBlink;
  if (typeof input.scrollback === 'number' && Number.isFinite(input.scrollback)) {
    base.scrollback = Math.round(Math.min(SCROLLBACK_MAX, Math.max(SCROLLBACK_MIN, input.scrollback)));
  }
  if (typeof input.editorCommand === 'string' && editorArgv(input.editorCommand, '.')) {
    base.editorCommand = input.editorCommand.trim();
  }
  return base;
}

/**
 * Familias de fonte digitadas pelo usuario. Vai direto para o xterm e o CSS:
 * sem `;`, chaves nem controle (nao vira outra declaracao). Vazio = padrao.
 */
export function cleanFontFamily(raw: string): string {
  const text = raw.trim().slice(0, MAX_FONT_FAMILY);
  if (!text || /[;{}<>\\\x00-\x1f]/.test(text)) return DEFAULT_FONT_FAMILY;
  return text;
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
