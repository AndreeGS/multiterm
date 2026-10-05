import type { ITheme } from '@xterm/xterm';
import type { Settings, ThemeId } from '../domain/workspace/settings.js';

/** O que um painel precisa saber para se pintar. */
export interface Appearance {
  readonly theme: ThemeId;
  readonly fontSize: number;
}

/**
 * Cores do xterm por tema. O xterm pinta num canvas, entao nao enxerga as
 * variaveis CSS: cada tema repete aqui o fundo do painel e o texto.
 */
export const TERMINAL_THEMES: Record<ThemeId, ITheme> = {
  dark: {
    background: '#151822',
    foreground: '#d5d9e4',
    cursor: '#6ea8fe',
    selectionBackground: '#2b4a8f',
  },
  // ANSI escurecido: o amarelo/branco padrao some sobre o papel.
  paper: {
    background: '#f5eddb',
    foreground: '#3a2e21',
    cursor: '#8a5526',
    cursorAccent: '#f5eddb',
    selectionBackground: '#dcc59a',
    black: '#3a2e21',
    red: '#a8382b',
    green: '#4d7524',
    yellow: '#8f6200',
    blue: '#2d5c88',
    magenta: '#843c73',
    cyan: '#24726b',
    white: '#8f8270',
    brightBlack: '#75654f',
    brightRed: '#c24a3a',
    brightGreen: '#5e8a30',
    brightYellow: '#a87a0c',
    brightBlue: '#3a6fa3',
    brightMagenta: '#9c4b8a',
    brightCyan: '#2e8a81',
    brightWhite: '#6b5d4a',
  },
};

/**
 * Num fundo claro, programas que pintam com cores proprias (truecolor) ainda
 * podem ficar ilegiveis; o xterm corrige o contraste do texto ate este minimo.
 */
export const MIN_CONTRAST: Record<ThemeId, number> = {
  dark: 1,
  paper: 4.5,
};

/** Tema e escala da interface vivem no <html>; o CSS faz o resto. */
export function applyDocumentSettings(settings: Settings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.style.setProperty('--ui-zoom', String(settings.uiScale));
}
