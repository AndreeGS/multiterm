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

/** Um arquivo que estava corrompido (ou ilegivel) na leitura e foi posto de lado. */
export interface RecoveredFile {
  readonly file: string;
  /** `unreadable` = existe mas nao deu para ler (permissao, arquivo preso). */
  readonly reason: 'corrupt' | 'unreadable';
  /** Para onde o arquivo foi movido (nada e apagado); `null` = nao deu para mover. */
  readonly movedTo: string | null;
  /** O conteudo veio do `.bak`; `false` = comecou vazio. */
  readonly fromBackup: boolean;
}

const recovered: RecoveredFile[] = [];
/**
 * Arquivos que falharam na leitura e nao puderam ser movidos de lado. Gravar
 * neles apagaria o original (e o `.bak`), entao ficam so-leitura ate reabrir.
 */
const protectedFiles = new Set<string>();

/** Arquivos recuperados desde a ultima chamada, para avisar o usuario. */
export function takeRecoveredFiles(): RecoveredFile[] {
  return recovered.splice(0);
}

/**
 * Le e faz parse de um JSON; `undefined` se o arquivo nao existir.
 *
 * Corrompido (ou ilegivel: permissao, antivirus segurando) e diferente de
 * ausente: o arquivo e movido para `<nome>.corrupt-<ts>` e o conteudo vem do
 * `.bak`. Sem isso o app subiria vazio e o proximo save sobrescreveria o que
 * ainda dava para recuperar.
 */
export function readJson(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    console.error(`[persistencia] falha ao ler ${file}:`, error);
    return setAside(file, 'unreadable');
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(`[persistencia] ${file} corrompido:`, error);
  }
  return setAside(file, 'corrupt');
}

/** Guarda o arquivo ruim de lado e devolve o conteudo do `.bak` (se houver). */
function setAside(file: string, reason: RecoveredFile['reason']): unknown {
  const movedTo = `${file}.corrupt-${Date.now()}`;
  let moved = true;
  try {
    renameSync(file, movedTo);
  } catch (error) {
    moved = false;
    protectedFiles.add(file);
    console.error(`[persistencia] falha ao mover ${file}; nao sera regravado nesta sessao:`, error);
  }
  const backup = readBackup(`${file}.bak`);
  // O arquivo volta a existir ja com o backup: sem isso, fechar sem mexer em
  // nada deixaria so o `.bak`, e a proxima abertura comecaria vazia.
  if (moved && backup !== undefined) {
    try {
      copyFileSync(`${file}.bak`, file);
    } catch (error) {
      console.error(`[persistencia] falha ao restaurar ${file} do backup:`, error);
    }
  }
  recovered.push({ file, reason, movedTo: moved ? movedTo : null, fromBackup: backup !== undefined });
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
  if (protectedFiles.has(file)) throw new Error(`${file} nao pode ser lido; gravar por cima apagaria o original.`);
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

/** Quem avisa o usuario de uma gravacao que falhou (o main mostra um dialogo). */
type SaveFailureListener = (file: string, error: unknown) => void;
let onSaveFailure: SaveFailureListener | null = null;
/** Ja avisados: um disco cheio nao vira um dialogo a cada tecla. Sai da lista ao gravar. */
const failing = new Set<string>();

export function setSaveFailureListener(listener: SaveFailureListener | null): void {
  onSaveFailure = listener;
}

/**
 * `writeJsonAtomic` que nunca lanca: registra a falha, avisa uma vez por
 * arquivo e devolve se gravou (quem chama tenta de novo depois).
 */
export function saveJson(file: string, value: unknown): boolean {
  try {
    writeJsonAtomic(file, value);
    failing.delete(file);
    return true;
  } catch (error) {
    console.error(`[persistencia] falha ao salvar ${file}:`, error);
    if (!failing.has(file)) {
      failing.add(file);
      onSaveFailure?.(file, error);
    }
    return false;
  }
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
