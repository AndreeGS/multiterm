/**
 * Layouts suportados. Os numericos sao grades lado a lado (o numero indica
 * quantos paineis cabem); `free` e a area livre, com paineis flutuantes.
 */
export const LAYOUTS = ['1', '2', '3', '4', '6', '8', 'free'] as const;
export type LayoutId = (typeof LAYOUTS)[number];
export type GridLayoutId = Exclude<LayoutId, 'free'>;

export const GRID_LAYOUTS: readonly GridLayoutId[] = ['1', '2', '3', '4', '6', '8'];

export const DEFAULT_LAYOUT: LayoutId = '4';

/** Celula da grade, em indices de trilha (base 0). */
export interface GridCell {
  readonly col: number;
  readonly row: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

export interface GridTemplate {
  readonly cols: number;
  readonly rows: number;
  /** Uma celula por painel, na ordem em que os paineis sao distribuidos. */
  readonly cells: readonly GridCell[];
}

function uniform(cols: number, rows: number): GridTemplate {
  const cells: GridCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) cells.push({ col, row, colSpan: 1, rowSpan: 1 });
  }
  return { cols, rows, cells };
}

const TEMPLATES: Record<GridLayoutId, GridTemplate> = {
  '1': uniform(1, 1),
  '2': uniform(2, 1),
  // Um painel de altura inteira a esquerda, dois empilhados a direita.
  '3': {
    cols: 2,
    rows: 2,
    cells: [
      { col: 0, row: 0, colSpan: 1, rowSpan: 2 },
      { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
      { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
    ],
  },
  '4': uniform(2, 2),
  '6': uniform(3, 2),
  '8': uniform(4, 2),
};

export function gridTemplate(layout: GridLayoutId): GridTemplate {
  return TEMPLATES[layout] ?? TEMPLATES['4'];
}

export function isLayout(value: unknown): value is LayoutId {
  return typeof value === 'string' && (LAYOUTS as readonly string[]).includes(value);
}

export function isGridLayout(value: unknown): value is GridLayoutId {
  return typeof value === 'string' && (GRID_LAYOUTS as readonly string[]).includes(value);
}

/** Quantos paineis cabem em uma tela. A area livre nao tem limite. */
export function capacity(layout: LayoutId): number {
  return layout === 'free' ? Number.POSITIVE_INFINITY : gridTemplate(layout).cells.length;
}

/** Menor grade que comporta `count` paineis. */
export function layoutFor(count: number): GridLayoutId {
  for (const layout of GRID_LAYOUTS) {
    if (capacity(layout) >= count) return layout;
  }
  return GRID_LAYOUTS[GRID_LAYOUTS.length - 1]!;
}

/* ---------- tamanho das trilhas ---------- */

/** Proporcao de cada coluna e de cada linha da grade; cada lista soma 1. */
export interface TrackSizes {
  readonly cols: number[];
  readonly rows: number[];
}

/** Nenhuma trilha fica menor que isto ao arrastar um divisor. */
export const MIN_TRACK = 0.1;

export function equalTracks(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

export function equalSizes(layout: GridLayoutId): TrackSizes {
  const { cols, rows } = gridTemplate(layout);
  return { cols: equalTracks(cols), rows: equalTracks(rows) };
}

/** Valida tamanhos vindos do disco para um layout; normaliza para somar 1. */
export function parseTrackSizes(layout: GridLayoutId, raw: unknown): TrackSizes | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { cols, rows } = gridTemplate(layout);
  const input = raw as Record<string, unknown>;
  const parsedCols = parseTracks(input.cols, cols);
  const parsedRows = parseTracks(input.rows, rows);
  return parsedCols && parsedRows ? { cols: parsedCols, rows: parsedRows } : null;
}

function parseTracks(raw: unknown, count: number): number[] | null {
  if (!Array.isArray(raw) || raw.length !== count) return null;
  if (!raw.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)) return null;
  const total = (raw as number[]).reduce((sum, v) => sum + v, 0);
  return (raw as number[]).map((v) => v / total);
}

/**
 * Move o divisor entre as trilhas `boundary` e `boundary + 1` por `delta`
 * (fracao do espaco total). As demais trilhas nao mudam.
 */
export function resizeTracks(tracks: readonly number[], boundary: number, delta: number): number[] {
  const next = [...tracks];
  const a = next[boundary];
  const b = next[boundary + 1];
  if (a === undefined || b === undefined) return next;
  const pair = a + b;
  const min = Math.min(MIN_TRACK, pair / 2);
  const left = Math.min(Math.max(a + delta, min), pair - min);
  next[boundary] = left;
  next[boundary + 1] = pair - left;
  return next;
}

/**
 * Divisor arrastavel. `axis: 'col'` e uma linha vertical entre as colunas
 * `boundary` e `boundary + 1`, cobrindo as linhas [from, to). `axis: 'row'`
 * e o equivalente horizontal.
 */
export interface Gutter {
  readonly axis: 'col' | 'row';
  readonly boundary: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Divisores de um template. Onde uma celula atravessa a fronteira (ex.: o
 * painel alto do layout 3) nao ha divisor naquele trecho.
 */
export function gutters(template: GridTemplate): Gutter[] {
  const result: Gutter[] = [];
  const spans = (axis: 'col' | 'row', boundary: number, at: number): boolean =>
    template.cells.some((cell) =>
      axis === 'col'
        ? cell.col <= boundary && cell.col + cell.colSpan > boundary + 1 &&
          cell.row <= at && cell.row + cell.rowSpan > at
        : cell.row <= boundary && cell.row + cell.rowSpan > boundary + 1 &&
          cell.col <= at && cell.col + cell.colSpan > at,
    );

  for (const axis of ['col', 'row'] as const) {
    const boundaries = (axis === 'col' ? template.cols : template.rows) - 1;
    const length = axis === 'col' ? template.rows : template.cols;
    for (let boundary = 0; boundary < boundaries; boundary += 1) {
      let from = -1;
      for (let at = 0; at <= length; at += 1) {
        const open = at < length && !spans(axis, boundary, at);
        if (open && from < 0) from = at;
        if (!open && from >= 0) {
          result.push({ axis, boundary, from, to: at });
          from = -1;
        }
      }
    }
  }
  return result;
}

/* ---------- area livre ---------- */

/** Posicao e tamanho de um painel na area livre, em pixels do "mundo". */
export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function parseCanvasRect(raw: unknown): CanvasRect | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y, width, height } = raw as Record<string, unknown>;
  const finite = [x, y, width, height].every((v) => typeof v === 'number' && Number.isFinite(v));
  if (!finite || (width as number) <= 0 || (height as number) <= 0) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Vista da area livre: deslocamento em pixels de tela e fator de zoom. */
export interface CanvasView {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export function parseCanvasView(raw: unknown): CanvasView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y, zoom } = raw as Record<string, unknown>;
  if (![x, y, zoom].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return { x: x as number, y: y as number, zoom: clampZoom(zoom as number) };
}

/**
 * Muda o zoom mantendo parado o ponto do mundo que esta sob (sx, sy) na tela
 * — o cursor, ou o centro da vista.
 */
export function zoomAt(view: CanvasView, zoom: number, sx: number, sy: number): CanvasView {
  const next = clampZoom(zoom);
  const wx = (sx - view.x) / view.zoom;
  const wy = (sy - view.y) / view.zoom;
  return { x: sx - wx * next, y: sy - wy * next, zoom: next };
}

/** Vista que enquadra todos os retangulos, sem ampliar alem de 100%. */
export function fitView(rects: readonly CanvasRect[], width: number, height: number, margin = 40): CanvasView {
  if (rects.length === 0 || width <= 0 || height <= 0) return { x: 0, y: 0, zoom: 1 };
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  const zoom = clampZoom(Math.min(1, (width - margin * 2) / (right - left), (height - margin * 2) / (bottom - top)));
  return {
    x: (width - (right - left) * zoom) / 2 - left * zoom,
    y: (height - (bottom - top) * zoom) / 2 - top * zoom,
    zoom,
  };
}
