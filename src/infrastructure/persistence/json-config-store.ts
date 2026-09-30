import { join } from 'node:path';
import { type AppConfig, parseConfig } from '../../domain/workspace/config.js';
import { readJson, writeJsonAtomic } from './atomic-json.js';

/** Persistencia em um unico config.json, com escrita atomica. */
export class JsonConfigStore {
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'config.json');
  }

  get path(): string {
    return this.file;
  }

  load(): AppConfig {
    return parseConfig(readJson(this.file));
  }

  save(config: AppConfig): void {
    try {
      writeJsonAtomic(this.file, config);
    } catch (error) {
      console.error('[config] falha ao salvar:', error);
    }
  }
}
