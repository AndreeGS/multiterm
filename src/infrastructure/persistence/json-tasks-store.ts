import { join } from 'node:path';
import { parseTaskLists, type TaskList } from '../../domain/tasks/task-list.js';
import { readJson, saveJson } from './atomic-json.js';

/** Listas de tarefas em um tasks.json proprio, como as notas. */
export class JsonTasksStore {
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'tasks.json');
  }

  load(): TaskList[] {
    return parseTaskLists(readJson(this.file));
  }

  /** `false` = nao gravou (ja foi registrado); quem chama tenta de novo. */
  save(lists: TaskList[]): boolean {
    return saveJson(this.file, { lists });
  }
}
