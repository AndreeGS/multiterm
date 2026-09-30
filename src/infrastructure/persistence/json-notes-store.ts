import { join } from 'node:path';
import { type Note, parseNotes } from '../../domain/notes/note.js';
import { readJson, writeJsonAtomic } from './atomic-json.js';

/**
 * Notas ficam em um notes.json separado do config.json: o conteudo pode
 * crescer bastante e nao deve ser reescrito a cada resize de janela.
 */
export class JsonNotesStore {
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'notes.json');
  }

  load(): Note[] {
    return parseNotes(readJson(this.file));
  }

  save(notes: Note[]): void {
    try {
      writeJsonAtomic(this.file, { notes });
    } catch (error) {
      console.error('[notes] falha ao salvar:', error);
    }
  }
}
