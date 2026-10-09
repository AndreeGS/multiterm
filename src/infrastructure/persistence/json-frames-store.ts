import { join } from 'node:path';
import { type CanvasFrame, parseFrames } from '../../domain/canvas/frame.js';
import { readJson, writeJsonAtomic } from './atomic-json.js';

/** Molduras da area livre em um frames.json proprio, como os textos. */
export class JsonFramesStore {
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'frames.json');
  }

  load(): CanvasFrame[] {
    return parseFrames(readJson(this.file));
  }

  save(frames: CanvasFrame[]): void {
    try {
      writeJsonAtomic(this.file, { frames });
    } catch (error) {
      console.error('[frames] falha ao salvar:', error);
    }
  }
}
