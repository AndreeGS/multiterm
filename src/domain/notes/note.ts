import { parseCanvasRect, type CanvasRect } from '../workspace/layout.js';

/** Bloco de notas. Diferente dos terminais, sobrevive ao reinicio do app. */
export interface Note {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  /** Posicao na area livre; `null` ate o painel ser posicionado la. */
  readonly rect: CanvasRect | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface NotePatch {
  title?: string;
  content?: string;
  rect?: CanvasRect | null;
}

export const MAX_TITLE_LENGTH = 80;

export function createNote(id: string, title: string, now: number): Note {
  return { id, title: cleanTitle(title) || 'Nota', content: '', rect: null, createdAt: now, updatedAt: now };
}

/** Aplica so os campos validos do patch; titulo vazio mantem o anterior. */
export function applyNotePatch(note: Note, patch: NotePatch, now: number): Note {
  const title = typeof patch.title === 'string' ? cleanTitle(patch.title) : '';
  return {
    ...note,
    title: title || note.title,
    content: typeof patch.content === 'string' ? patch.content : note.content,
    rect: patch.rect === undefined ? note.rect : parseCanvasRect(patch.rect),
    updatedAt: now,
  };
}

/** Normaliza o arquivo de notas: entradas invalidas sao descartadas. */
export function parseNotes(raw: unknown): Note[] {
  const list = (raw as { notes?: unknown } | null)?.notes;
  if (!Array.isArray(list)) return [];
  const notes: Note[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.id !== 'string' || !input.id) continue;
    const createdAt = Number.isFinite(input.createdAt) ? (input.createdAt as number) : 0;
    notes.push({
      id: input.id,
      title: (typeof input.title === 'string' && cleanTitle(input.title)) || 'Nota',
      content: typeof input.content === 'string' ? input.content : '',
      rect: parseCanvasRect(input.rect),
      createdAt,
      updatedAt: Number.isFinite(input.updatedAt) ? (input.updatedAt as number) : createdAt,
    });
  }
  return notes;
}

function cleanTitle(title: string): string {
  return title.trim().slice(0, MAX_TITLE_LENGTH);
}
