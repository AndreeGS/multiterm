import { randomUUID } from 'node:crypto';
import {
  applyTaskListPatch,
  createTaskList,
  type TaskList,
  type TaskListPatch,
} from '../../domain/tasks/task-list.js';
import type { JsonTasksStore } from '../../infrastructure/persistence/json-tasks-store.js';
import { orphanIds } from '../../domain/workspace/workspace.js';
import { DebouncedSave } from '../debounced-save.js';

const SAVE_DEBOUNCE_MS = 600;

/**
 * Caso de uso: listas de tarefas. Mesmo esquema das notas: o renderer manda
 * cada mudanca e o disco so e escrito depois de uma pausa.
 */
export class TasksService {
  private readonly lists = new Map<string, TaskList>();
  private readonly saver = new DebouncedSave(SAVE_DEBOUNCE_MS, () => this.store.save(this.list()));

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

  /** Move para `target` o que esta num workspace que nao existe. Devolve quantos. */
  adoptOrphans(validIds: ReadonlySet<string>, target: string): number {
    const ids = orphanIds(this.lists.values(), validIds);
    for (const id of ids) {
      const item = this.lists.get(id);
      if (item) this.lists.set(id, { ...item, workspaceId: target });
    }
    if (ids.length > 0) this.scheduleSave();
    return ids.length;
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
    this.saver.flush();
  }

  private scheduleSave(): void {
    this.saver.schedule();
  }
}
