/** Layouts suportados pela grade. O numero indica quantos paineis cabem. */
export const LAYOUTS = ['1', '2', '4', '6', '8'] as const;
export type LayoutId = (typeof LAYOUTS)[number];

export const DEFAULT_LAYOUT: LayoutId = '4';

export interface GridShape {
  readonly cols: number;
  readonly rows: number;
}

const SHAPES: Record<LayoutId, GridShape> = {
  '1': { cols: 1, rows: 1 },
  '2': { cols: 2, rows: 1 },
  '4': { cols: 2, rows: 2 },
  '6': { cols: 3, rows: 2 },
  '8': { cols: 4, rows: 2 },
};

export function gridShape(layout: LayoutId): GridShape {
  return SHAPES[layout] ?? SHAPES[DEFAULT_LAYOUT];
}

export function isLayout(value: unknown): value is LayoutId {
  return typeof value === 'string' && (LAYOUTS as readonly string[]).includes(value);
}

/** Menor layout que comporta `count` paineis. */
export function layoutFor(count: number): LayoutId {
  for (const layout of LAYOUTS) {
    if (Number(layout) >= count) return layout;
  }
  return LAYOUTS[LAYOUTS.length - 1]!;
}
