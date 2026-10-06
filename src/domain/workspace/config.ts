import {
  DEFAULT_LAYOUT,
  GRID_LAYOUTS,
  isLayout,
  parseCanvasRect,
  parseCanvasView,
  parseTrackSizes,
  type CanvasRect,
  type CanvasView,
  type GridLayoutId,
  type LayoutId,
  type TrackSizes,
} from './layout.js';
import { defaultSettings, parseSettings, type Settings } from './settings.js';

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

/**
 * Terminal aberto no encerramento. O processo nao sobrevive; na proxima
 * abertura sobe um shell novo com o mesmo nome, diretorio e posicao.
 */
export interface SavedTerminal {
  name: string;
  cwd: string;
  shell?: string;
  rect: CanvasRect | null;
}

export type LayoutSizes = Partial<Record<GridLayoutId, TrackSizes>>;

export interface AppConfig {
  window: WindowBounds;
  layout: LayoutId;
  /** Proporcoes ajustadas pelo usuario em cada grade. Ausente = tudo igual. */
  layoutSizes: LayoutSizes;
  /** Diretorios usados recentemente, mais recente primeiro. */
  recentDirs: string[];
  /** Terminais para reabrir, na ordem de criacao. */
  terminals: SavedTerminal[];
  /** Pan e zoom da area livre. Ausente = origem em 100%. */
  canvasView: CanvasView | null;
  /** Tema e tamanhos de fonte. */
  settings: Settings;
}

export const MAX_RECENT_DIRS = 12;

export function defaultConfig(): AppConfig {
  return {
    window: { width: 1400, height: 900 },
    layout: DEFAULT_LAYOUT,
    layoutSizes: {},
    recentDirs: [],
    terminals: [],
    canvasView: null,
    settings: defaultSettings(),
  };
}

/** Normaliza conteudo vindo do disco: qualquer campo invalido cai no padrao. */
export function parseConfig(raw: unknown): AppConfig {
  const base = defaultConfig();
  if (typeof raw !== 'object' || raw === null) return base;
  const input = raw as Record<string, unknown>;

  const window = input.window as Record<string, unknown> | undefined;
  if (window && typeof window === 'object') {
    if (isFinitePositive(window.width)) base.window.width = window.width;
    if (isFinitePositive(window.height)) base.window.height = window.height;
    if (Number.isFinite(window.x)) base.window.x = window.x as number;
    if (Number.isFinite(window.y)) base.window.y = window.y as number;
  }

  if (isLayout(input.layout)) base.layout = input.layout;

  const sizes = input.layoutSizes as Record<string, unknown> | undefined;
  if (sizes && typeof sizes === 'object') {
    for (const layout of GRID_LAYOUTS) {
      const parsed = parseTrackSizes(layout, sizes[layout]);
      if (parsed) base.layoutSizes[layout] = parsed;
    }
  }

  if (Array.isArray(input.recentDirs)) {
    base.recentDirs = input.recentDirs
      .filter((dir): dir is string => typeof dir === 'string' && dir.length > 0)
      .slice(0, MAX_RECENT_DIRS);
  }

  if (Array.isArray(input.terminals)) {
    base.terminals = input.terminals
      .map(parseSavedTerminal)
      .filter((t): t is SavedTerminal => t !== null);
  }

  base.canvasView = parseCanvasView(input.canvasView);
  base.settings = parseSettings(input.settings);

  return base;
}

function parseSavedTerminal(raw: unknown): SavedTerminal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.cwd !== 'string' || !input.cwd) return null;
  const saved: SavedTerminal = {
    name: typeof input.name === 'string' ? input.name : '',
    cwd: input.cwd,
    rect: parseCanvasRect(input.rect),
  };
  if (typeof input.shell === 'string' && input.shell) saved.shell = input.shell;
  return saved;
}

export function withRecentDir(config: AppConfig, dir: string): AppConfig {
  const recentDirs = [dir, ...config.recentDirs.filter((d) => d !== dir)].slice(0, MAX_RECENT_DIRS);
  return { ...config, recentDirs };
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
