import { parseCanvasRect, type CanvasRect } from '../workspace/layout.js';
import { parseTerminalId } from '../terminal/link.js';
import { parseWorkspaceId } from '../workspace/workspace.js';

/** Bloco de notas. Diferente dos terminais, sobrevive ao reinicio do app. */
export interface Note {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  /** Posicao na area livre; `null` ate o painel ser posicionado la. */
  readonly rect: CanvasRect | null;
  /** Terminal vinculado: recebe o Ctrl+Enter. `null` = nenhum. */
  readonly terminalId: string | null;
  readonly workspaceId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface NotePatch {
  title?: string;
  content?: string;
  rect?: CanvasRect | null;
  terminalId?: string | null;
  /** Mover para outro workspace (o main confere que ele existe). */
  workspaceId?: string;
}

export const MAX_TITLE_LENGTH = 80;

export function createNote(id: string, title: string, workspaceId: string, now: number): Note {
  return { id, title: cleanTitle(title) || 'Nota', content: '', rect: null, terminalId: null, workspaceId, createdAt: now, updatedAt: now };
}

/** Aplica so os campos validos do patch; titulo vazio mantem o anterior. */
export function applyNotePatch(note: Note, patch: NotePatch, now: number): Note {
  const title = typeof patch.title === 'string' ? cleanTitle(patch.title) : '';
  return {
    ...note,
    title: title || note.title,
    content: typeof patch.content === 'string' ? patch.content : note.content,
    rect: patch.rect === undefined ? note.rect : parseCanvasRect(patch.rect),
    terminalId: patch.terminalId === undefined ? note.terminalId : parseTerminalId(patch.terminalId),
    workspaceId: patch.workspaceId === undefined ? note.workspaceId : parseWorkspaceId(patch.workspaceId),
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
      terminalId: parseTerminalId(input.terminalId),
      workspaceId: parseWorkspaceId(input.workspaceId),
      createdAt,
      updatedAt: Number.isFinite(input.updatedAt) ? (input.updatedAt as number) : createdAt,
    });
  }
  return notes;
}

function cleanTitle(title: string): string {
  return title.trim().slice(0, MAX_TITLE_LENGTH);
}
