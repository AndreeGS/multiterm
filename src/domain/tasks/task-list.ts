import { parseCanvasRect, type CanvasRect } from '../workspace/layout.js';
import { parseTerminalId } from '../terminal/link.js';

/** Um item da lista. `doneAt` guarda quando foi concluido (null = pendente). */
export interface TaskItem {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
  readonly doneAt: number | null;
  readonly createdAt: number;
}

/** Lista de tarefas. Como as notas, sobrevive ao reinicio do app. */
export interface TaskList {
  readonly id: string;
  readonly title: string;
  /** Na ordem de exibicao; pendentes e concluidas sao separadas na tela. */
  readonly items: TaskItem[];
  /** Posicao na area livre; `null` ate o painel ser posicionado la. */
  readonly rect: CanvasRect | null;
  /** Terminal vinculado: recebe as tarefas enviadas com ▶. `null` = nenhum. */
  readonly terminalId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** O renderer manda a lista de itens inteira: ela e pequena e evita patches por item. */
export interface TaskListPatch {
  title?: string;
  items?: TaskItem[];
  rect?: CanvasRect | null;
  terminalId?: string | null;
}

export const MAX_TITLE_LENGTH = 80;
export const MAX_ITEM_LENGTH = 500;

export function createTaskList(id: string, title: string, now: number): TaskList {
  return { id, title: cleanTitle(title) || 'Tarefas', items: [], rect: null, terminalId: null, createdAt: now, updatedAt: now };
}

/** Aplica so os campos validos do patch; titulo vazio mantem o anterior. */
export function applyTaskListPatch(list: TaskList, patch: TaskListPatch, now: number): TaskList {
  const title = typeof patch.title === 'string' ? cleanTitle(patch.title) : '';
  return {
    ...list,
    title: title || list.title,
    items: Array.isArray(patch.items) ? parseItems(patch.items) : list.items,
    rect: patch.rect === undefined ? list.rect : parseCanvasRect(patch.rect),
    terminalId: patch.terminalId === undefined ? list.terminalId : parseTerminalId(patch.terminalId),
    updatedAt: now,
  };
}

/** Normaliza o arquivo de tarefas: entradas invalidas sao descartadas. */
export function parseTaskLists(raw: unknown): TaskList[] {
  const lists = (raw as { lists?: unknown } | null)?.lists;
  if (!Array.isArray(lists)) return [];
  const result: TaskList[] = [];
  for (const item of lists) {
    if (typeof item !== 'object' || item === null) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.id !== 'string' || !input.id) continue;
    const createdAt = isTimestamp(input.createdAt) ? input.createdAt : 0;
    result.push({
      id: input.id,
      title: (typeof input.title === 'string' && cleanTitle(input.title)) || 'Tarefas',
      items: Array.isArray(input.items) ? parseItems(input.items) : [],
      rect: parseCanvasRect(input.rect),
      terminalId: parseTerminalId(input.terminalId),
      createdAt,
      updatedAt: isTimestamp(input.updatedAt) ? input.updatedAt : createdAt,
    });
  }
  return result;
}

/** Item sem texto nao tem o que mostrar; ids repetidos ficam so com o primeiro. */
function parseItems(raw: unknown[]): TaskItem[] {
  const seen = new Set<string>();
  const items: TaskItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const input = entry as Record<string, unknown>;
    if (typeof input.id !== 'string' || !input.id || seen.has(input.id)) continue;
    const text = typeof input.text === 'string' ? cleanItemText(input.text) : '';
    if (!text) continue;
    seen.add(input.id);
    const done = input.done === true;
    items.push({
      id: input.id,
      text,
      done,
      doneAt: done && isTimestamp(input.doneAt) ? input.doneAt : null,
      createdAt: isTimestamp(input.createdAt) ? input.createdAt : 0,
    });
  }
  return items;
}

/** Item e uma linha so: quebras viram espaco. */
export function cleanItemText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_LENGTH);
}

function cleanTitle(title: string): string {
  return title.trim().slice(0, MAX_TITLE_LENGTH);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
