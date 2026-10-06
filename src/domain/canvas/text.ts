/**
 * Texto solto na area livre: sem cabecalho nem caixa, como uma anotacao
 * escrita direto no quadro. Coordenadas e tamanho sao do mundo (zoom 100%).
 */
export interface CanvasText {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly content: string;
  readonly fontSize: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CanvasTextPatch {
  x?: number;
  y?: number;
  content?: string;
  fontSize?: number;
}

/** Degraus do A−/A+, em px do mundo. */
export const TEXT_SIZES: readonly number[] = [12, 14, 18, 24, 32, 48, 64];
export const DEFAULT_TEXT_SIZE = 18;

export function createCanvasText(id: string, x: number, y: number, now: number): CanvasText {
  return { id, x, y, content: '', fontSize: DEFAULT_TEXT_SIZE, createdAt: now, updatedAt: now };
}

/** Aplica so os campos validos do patch. */
export function applyTextPatch(text: CanvasText, patch: CanvasTextPatch, now: number): CanvasText {
  return {
    ...text,
    x: isFiniteNumber(patch.x) ? patch.x : text.x,
    y: isFiniteNumber(patch.y) ? patch.y : text.y,
    content: typeof patch.content === 'string' ? patch.content : text.content,
    fontSize: isTextSize(patch.fontSize) ? patch.fontSize : text.fontSize,
    updatedAt: now,
  };
}

/** Normaliza o arquivo de textos: entradas invalidas sao descartadas. */
export function parseCanvasTexts(raw: unknown): CanvasText[] {
  const list = (raw as { texts?: unknown } | null)?.texts;
  if (!Array.isArray(list)) return [];
  const texts: CanvasText[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.id !== 'string' || !input.id) continue;
    if (!isFiniteNumber(input.x) || !isFiniteNumber(input.y)) continue;
    // Texto vazio nao tem como ser visto nem clicado: nao vale restaurar.
    if (typeof input.content !== 'string' || !input.content.trim()) continue;
    const createdAt = isFiniteNumber(input.createdAt) ? input.createdAt : 0;
    texts.push({
      id: input.id,
      x: input.x,
      y: input.y,
      content: input.content,
      fontSize: isTextSize(input.fontSize) ? input.fontSize : DEFAULT_TEXT_SIZE,
      createdAt,
      updatedAt: isFiniteNumber(input.updatedAt) ? input.updatedAt : createdAt,
    });
  }
  return texts;
}

function isTextSize(value: unknown): value is number {
  return typeof value === 'number' && TEXT_SIZES.includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
