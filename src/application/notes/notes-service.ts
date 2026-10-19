import { randomUUID } from 'node:crypto';
import { applyNotePatch, createNote, type Note, type NotePatch } from '../../domain/notes/note.js';
import type { JsonNotesStore } from '../../infrastructure/persistence/json-notes-store.js';
import { orphanIds } from '../../domain/workspace/workspace.js';
import { DebouncedSave } from '../debounced-save.js';

const SAVE_DEBOUNCE_MS = 600;

/**
 * Caso de uso: blocos de notas. O renderer manda cada tecla; o disco so e
 * escrito depois de uma pausa na digitacao (e no encerramento).
 */
export class NotesService {
  private readonly notes = new Map<string, Note>();
  private readonly saver = new DebouncedSave(SAVE_DEBOUNCE_MS, () => this.store.save(this.list()));

  constructor(private readonly store: JsonNotesStore) {
    for (const note of store.load()) this.notes.set(note.id, note);
  }

  list(): Note[] {
    return [...this.notes.values()];
  }

  create(workspaceId: string): Note {
    const note = createNote(randomUUID(), `Nota ${this.notes.size + 1}`, workspaceId, Date.now());
    this.notes.set(note.id, note);
    this.scheduleSave();
    return note;
  }

  update(id: string, patch: NotePatch): void {
    const note = this.notes.get(id);
    if (!note) return;
    this.notes.set(id, applyNotePatch(note, patch, Date.now()));
    this.scheduleSave();
  }

  remove(id: string): void {
    if (this.notes.delete(id)) this.scheduleSave();
  }

  /** Move para `target` o que esta num workspace que nao existe. Devolve quantos. */
  adoptOrphans(validIds: ReadonlySet<string>, target: string): number {
    const ids = orphanIds(this.notes.values(), validIds);
    for (const id of ids) {
      const item = this.notes.get(id);
      if (item) this.notes.set(id, { ...item, workspaceId: target });
    }
    if (ids.length > 0) this.scheduleSave();
    return ids.length;
  }

  /** Apaga tudo de um workspace que esta sendo removido. */
  removeWorkspace(workspaceId: string): void {
    let changed = false;
    for (const [id, item] of this.notes) {
      if (item.workspaceId !== workspaceId) continue;
      this.notes.delete(id);
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
