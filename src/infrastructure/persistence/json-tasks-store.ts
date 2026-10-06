import { join } from 'node:path';
import { parseTaskLists, type TaskList } from '../../domain/tasks/task-list.js';
import { readJson, writeJsonAtomic } from './atomic-json.js';

/** Listas de tarefas em um tasks.json proprio, como as notas. */
export class JsonTasksStore {
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'tasks.json');
  }

  load(): TaskList[] {
    return parseTaskLists(readJson(this.file));
  }

  save(lists: TaskList[]): void {
    try {
      writeJsonAtomic(this.file, { lists });
    } catch (error) {
      console.error('[tasks] falha ao salvar:', error);
    }
  }
}
