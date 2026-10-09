import { randomUUID } from 'node:crypto';
import {
  applyTaskListPatch,
  createTaskList,
  type TaskList,
  type TaskListPatch,
} from '../../domain/tasks/task-list.js';
import type { JsonTasksStore } from '../../infrastructure/persistence/json-tasks-store.js';

const SAVE_DEBOUNCE_MS = 600;

/**
 * Caso de uso: listas de tarefas. Mesmo esquema das notas: o renderer manda
 * cada mudanca e o disco so e escrito depois de uma pausa.
 */
export class TasksService {
  private readonly lists = new Map<string, TaskList>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly store: JsonTasksStore) {
    for (const list of store.load()) this.lists.set(list.id, list);
  }

  list(): TaskList[] {
    return [...this.lists.values()];
  }

  create(workspaceId: string): TaskList {
    const title = this.lists.size === 0 ? 'Tarefas' : `Tarefas ${this.lists.size + 1}`;
    const list = createTaskList(randomUUID(), title, workspaceId, Date.now());
    this.lists.set(list.id, list);
    this.scheduleSave();
    return list;
  }

  update(id: string, patch: TaskListPatch): void {
    const list = this.lists.get(id);
    if (!list) return;
    this.lists.set(id, applyTaskListPatch(list, patch, Date.now()));
    this.scheduleSave();
  }

  remove(id: string): void {
    if (this.lists.delete(id)) this.scheduleSave();
  }

  /** Apaga tudo de um workspace que esta sendo removido. */
  removeWorkspace(workspaceId: string): void {
    let changed = false;
    for (const [id, item] of this.lists) {
      if (item.workspaceId !== workspaceId) continue;
      this.lists.delete(id);
      changed = true;
    }
    if (changed) this.scheduleSave();
  }

  /** Grava imediatamente (usado no encerramento do app). */
  flush(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.store.save(this.list());
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.store.save(this.list());
    }, SAVE_DEBOUNCE_MS);
    this.timer.unref?.();
  }
}
