import { join } from 'node:path';
import { type CanvasText, parseCanvasTexts } from '../../domain/canvas/text.js';
import { readJson, writeJsonAtomic } from './atomic-json.js';

/** Textos da area livre em um texts.json proprio, como as notas. */
export class JsonTextsStore {
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'texts.json');
  }

  load(): CanvasText[] {
    return parseCanvasTexts(readJson(this.file));
  }

  save(texts: CanvasText[]): void {
    try {
      writeJsonAtomic(this.file, { texts });
    } catch (error) {
      console.error('[texts] falha ao salvar:', error);
    }
  }
}
