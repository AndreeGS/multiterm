import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

/** Um arquivo que estava corrompido na leitura e foi posto de lado. */
export interface RecoveredFile {
  readonly file: string;
  /** Para onde o arquivo corrompido foi movido (nada e apagado). */
  readonly movedTo: string | null;
  /** O conteudo veio do `.bak`; `false` = comecou vazio. */
  readonly fromBackup: boolean;
}

const recovered: RecoveredFile[] = [];

/** Arquivos recuperados desde a ultima chamada, para avisar o usuario. */
export function takeRecoveredFiles(): RecoveredFile[] {
  return recovered.splice(0);
}

/**
 * Le e faz parse de um JSON; `undefined` se o arquivo nao existir.
 *
 * Corrompido e diferente de ausente: o arquivo e movido para
 * `<nome>.corrupt-<ts>` e o conteudo vem do `.bak`. Sem isso o app subiria
 * vazio e o proximo save sobrescreveria o que ainda dava para recuperar.
 */
export function readJson(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`[persistencia] falha ao ler ${file}:`, error);
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(`[persistencia] ${file} corrompido:`, error);
  }
  const movedTo = `${file}.corrupt-${Date.now()}`;
  let moved = true;
  try {
    renameSync(file, movedTo);
  } catch (error) {
    moved = false;
    console.error(`[persistencia] falha ao mover ${file}:`, error);
  }
  const backup = readBackup(`${file}.bak`);
  recovered.push({ file, movedTo: moved ? movedTo : null, fromBackup: backup !== undefined });
  return backup;
}

function readBackup(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Escrita atomica (tmp + fsync + rename) para nao corromper o arquivo se o app
 * for fechado ou a energia cair durante o save. A versao anterior fica em
 * `.bak`, que o `readJson` usa se o arquivo principal estragar.
 */
export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // O arquivo atual so e escrito por aqui (sempre JSON valido): pode virar o backup.
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  renameWithRetry(tmp, file);
}

const RENAME_ATTEMPTS = 3;
const RENAME_RETRY_MS = 50;

/** No Windows, antivirus e indexador seguram o arquivo por instantes (EPERM/EBUSY). */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= RENAME_ATTEMPTS || (code !== 'EPERM' && code !== 'EBUSY')) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_RETRY_MS);
    }
  }
}
