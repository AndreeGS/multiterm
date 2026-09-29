import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type AppConfig, defaultConfig, parseConfig } from '../../domain/workspace/config.js';

/**
 * Persistencia em um unico config.json. Escrita atomica (tmp + rename) para
 * nao corromper o arquivo se o app for fechado durante o save.
 */
export class JsonConfigStore {
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'config.json');
  }

  get path(): string {
    return this.file;
  }

  load(): AppConfig {
    try {
      return parseConfig(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      return defaultConfig();
    }
  }

  save(config: AppConfig): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      renameSync(tmp, this.file);
    } catch (error) {
      console.error('[config] falha ao salvar:', error);
    }
  }
}
