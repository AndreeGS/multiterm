import { join } from 'node:path';
import { type CanvasText, parseCanvasTexts } from '../../domain/canvas/text.js';
import { readJson, saveJson } from './atomic-json.js';

/** Textos da area livre em um texts.json proprio, como as notas. */
export class JsonTextsStore {
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'texts.json');
  }

  load(): CanvasText[] {
    return parseCanvasTexts(readJson(this.file));
  }

  /** `false` = nao gravou (ja foi registrado); quem chama tenta de novo. */
  save(texts: CanvasText[]): boolean {
    return saveJson(this.file, { texts });
  }
}
