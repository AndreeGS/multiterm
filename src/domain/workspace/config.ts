import {
  DEFAULT_LAYOUT,
  GRID_LAYOUTS,
  isLayout,
  parseTrackSizes,
  type GridLayoutId,
  type LayoutId,
  type TrackSizes,
} from './layout.js';

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export type LayoutSizes = Partial<Record<GridLayoutId, TrackSizes>>;

export interface AppConfig {
  window: WindowBounds;
  layout: LayoutId;
  /** Proporcoes ajustadas pelo usuario em cada grade. Ausente = tudo igual. */
  layoutSizes: LayoutSizes;
  /** Diretorios usados recentemente, mais recente primeiro. */
  recentDirs: string[];
}

export const MAX_RECENT_DIRS = 12;

export function defaultConfig(): AppConfig {
  return {
    window: { width: 1400, height: 900 },
    layout: DEFAULT_LAYOUT,
    layoutSizes: {},
    recentDirs: [],
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

  return base;
}

export function withRecentDir(config: AppConfig, dir: string): AppConfig {
  const recentDirs = [dir, ...config.recentDirs.filter((d) => d !== dir)].slice(0, MAX_RECENT_DIRS);
  return { ...config, recentDirs };
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
