import { join } from 'node:path';
import { type CanvasFrame, parseFrames } from '../../domain/canvas/frame.js';
import { readJson, saveJson } from './atomic-json.js';

/** Molduras da area livre em um frames.json proprio, como os textos. */
export class JsonFramesStore {
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'frames.json');
  }

  load(): CanvasFrame[] {
    return parseFrames(readJson(this.file));
  }

  /** `false` = nao gravou (ja foi registrado); quem chama tenta de novo. */
  save(frames: CanvasFrame[]): boolean {
    return saveJson(this.file, { frames });
  }
}
