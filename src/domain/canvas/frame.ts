import { parsePaneColor, type PaneColor } from '../workspace/colors.js';
import type { CanvasRect } from '../workspace/layout.js';
import { parseWorkspaceId } from '../workspace/workspace.js';

/**
 * Moldura na area livre: um retangulo com titulo que agrupa paineis e textos.
 * Arrastar o titulo leva junto tudo que esta dentro. Nao "possui" ninguem:
 * pertencer e estar com o centro dentro dela no momento do arrasto.
 */
export interface CanvasFrame {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly color: PaneColor | null;
  readonly workspaceId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CanvasFramePatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  title?: string;
  color?: PaneColor | null;
}

export const MIN_FRAME_SIZE = { width: 200, height: 120 } as const;
export const MAX_FRAME_TITLE = 60;
export const DEFAULT_FRAME_TITLE = 'Grupo';

export function createFrame(id: string, rect: CanvasRect, workspaceId: string, now: number): CanvasFrame {
  return {
    id,
    x: rect.x,
    y: rect.y,
    width: Math.max(MIN_FRAME_SIZE.width, rect.width),
    height: Math.max(MIN_FRAME_SIZE.height, rect.height),
    title: DEFAULT_FRAME_TITLE,
    color: null,
    workspaceId,
    createdAt: now,
    updatedAt: now,
  };
}

/** Aplica so os campos validos; tamanho abaixo do minimo e limitado; titulo vazio mantem o anterior. */
export function applyFramePatch(frame: CanvasFrame, patch: CanvasFramePatch, now: number): CanvasFrame {
  const title = typeof patch.title === 'string' ? cleanTitle(patch.title) : '';
  return {
    ...frame,
    x: isFiniteNumber(patch.x) ? patch.x : frame.x,
    y: isFiniteNumber(patch.y) ? patch.y : frame.y,
    width: isFiniteNumber(patch.width) ? Math.max(MIN_FRAME_SIZE.width, patch.width) : frame.width,
    height: isFiniteNumber(patch.height) ? Math.max(MIN_FRAME_SIZE.height, patch.height) : frame.height,
    title: title || frame.title,
    color: patch.color === undefined ? frame.color : parsePaneColor(patch.color),
    updatedAt: now,
  };
}

/** Normaliza o arquivo de molduras: entradas invalidas sao descartadas. */
export function parseFrames(raw: unknown): CanvasFrame[] {
  const list = (raw as { frames?: unknown } | null)?.frames;
  if (!Array.isArray(list)) return [];
  const frames: CanvasFrame[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.id !== 'string' || !input.id) continue;
    const { x, y, width, height } = input;
    if (![x, y, width, height].every(isFiniteNumber)) continue;
    const createdAt = isFiniteNumber(input.createdAt) ? input.createdAt : 0;
    frames.push({
      id: input.id,
      x: x as number,
      y: y as number,
      width: Math.max(MIN_FRAME_SIZE.width, width as number),
      height: Math.max(MIN_FRAME_SIZE.height, height as number),
      title: (typeof input.title === 'string' && cleanTitle(input.title)) || DEFAULT_FRAME_TITLE,
      color: parsePaneColor(input.color),
      workspaceId: parseWorkspaceId(input.workspaceId),
      createdAt,
      updatedAt: isFiniteNumber(input.updatedAt) ? input.updatedAt : createdAt,
    });
  }
  return frames;
}

/**
 * Quem esta dentro da moldura: os itens com o centro dentro dela. Pelo centro,
 * e nao pela caixa inteira, um painel maior que a moldura ainda pertence a ela,
 * e um que so encosta na borda nao.
 */
export function membersOf<T extends { readonly rect: CanvasRect }>(frame: CanvasRect, items: readonly T[]): T[] {
  return items.filter(({ rect }) => {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    return cx >= frame.x && cx <= frame.x + frame.width && cy >= frame.y && cy <= frame.y + frame.height;
  });
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, MAX_FRAME_TITLE);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
