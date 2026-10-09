import {
  DEFAULT_LAYOUT,
  GRID_LAYOUTS,
  isLayout,
  parseCanvasView,
  parseTrackSizes,
  type CanvasView,
  type GridLayoutId,
  type LayoutId,
  type TrackSizes,
} from './layout.js';

export type LayoutSizes = Partial<Record<GridLayoutId, TrackSizes>>;

/**
 * Um conjunto nomeado de terminais, notas, tarefas, textos e grupos, com o
 * proprio layout e a propria vista da area livre. Trocar de workspace so
 * troca o que aparece: os terminais dos outros continuam rodando.
 */
export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly layout: LayoutId;
  /** Proporcoes ajustadas em cada grade. Ausente = tudo igual. */
  readonly layoutSizes: LayoutSizes;
  /** Pan e zoom da area livre. `null` = origem em 100%. */
  readonly canvasView: CanvasView | null;
}

/** O que a barra e a paleta precisam saber de cada workspace. */
export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
}

/** Workspace de quem ainda nao tinha nenhum: tudo que ja existia cai nele. */
export const DEFAULT_WORKSPACE_ID = 'default';
export const DEFAULT_WORKSPACE_NAME = 'Principal';
export const MAX_WORKSPACE_NAME = 40;
export const MAX_WORKSPACES = 20;

export function createWorkspace(id: string, name: string): Workspace {
  return { id, name: cleanWorkspaceName(name) || 'Workspace', layout: DEFAULT_LAYOUT, layoutSizes: {}, canvasView: null };
}

export function cleanWorkspaceName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_WORKSPACE_NAME);
}

/**
 * Workspace de uma entidade vinda do disco. Arquivos de antes dos workspaces
 * nao tem o campo: tudo vai para o workspace padrao.
 */
export function parseWorkspaceId(raw: unknown): string {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 64 ? raw : DEFAULT_WORKSPACE_ID;
}

export function parseLayoutSizes(raw: unknown): LayoutSizes {
  const sizes: LayoutSizes = {};
  if (typeof raw !== 'object' || raw === null) return sizes;
  for (const layout of GRID_LAYOUTS) {
    const parsed = parseTrackSizes(layout, (raw as Record<string, unknown>)[layout]);
    if (parsed) sizes[layout] = parsed;
  }
  return sizes;
}

/** `null` se faltar id; o resto cai no padrao. */
export function parseWorkspace(raw: unknown): Workspace | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.id !== 'string' || !input.id || input.id.length > 64) return null;
  return {
    id: input.id,
    name: (typeof input.name === 'string' && cleanWorkspaceName(input.name)) || 'Workspace',
    layout: isLayout(input.layout) ? input.layout : DEFAULT_LAYOUT,
    layoutSizes: parseLayoutSizes(input.layoutSizes),
    canvasView: parseCanvasView(input.canvasView),
  };
}

export function summarize(workspace: Workspace): WorkspaceSummary {
  return { id: workspace.id, name: workspace.name };
}
