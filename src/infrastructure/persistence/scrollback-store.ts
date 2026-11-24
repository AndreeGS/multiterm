import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Historico serializado de um terminal, no maximo (o comeco e cortado). */
export const MAX_SCROLLBACK_BYTES = 2 * 1024 * 1024;
const ID = /^[\w-]{1,64}$/;

/**
 * Historico de cada terminal (o buffer do xterm serializado com cores), para
 * restaurar a sessao com o que estava na tela. Um arquivo por terminal em
 * `<userData>/scrollback/<id>.txt`, so do usuario (0600): o historico pode
 * ter qualquer coisa que passou pelo terminal.
 *
 * Diferente dos JSON do app, nao guarda `.bak`: perder o historico de um
 * terminal nao perde nada do que voce configurou.
 */
export class ScrollbackStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'scrollback');
  }

  save(id: string, text: string): boolean {
    if (!ID.test(id)) return false;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const file = this.file(id);
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, trimStart(text), { mode: 0o600 });
      renameSync(tmp, file);
      return true;
    } catch (error) {
      console.error('[scrollback] nao gravou', id, error);
      return false;
    }
  }

  load(id: string): string | null {
    if (!ID.test(id)) return null;
    try {
      return readFileSync(this.file(id), 'utf8');
    } catch {
      return null;
    }
  }

  remove(id: string): void {
    if (!ID.test(id)) return;
    rmSync(this.file(id), { force: true });
  }

  /** Apaga os historicos de terminais que nao existem mais (nem abertos, nem na sessao a restaurar). */
  prune(keep: ReadonlySet<string>): void {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const id = name.replace(/\.txt(\.tmp)?$/, '');
      if (name.endsWith('.tmp') || !keep.has(id)) rmSync(join(this.dir, name), { force: true });
    }
  }

  private file(id: string): string {
    return join(this.dir, `${id}.txt`);
  }
}

/**
 * Acima do limite, fica o fim (o mais recente), comecando numa linha inteira
 * e com as cores zeradas: cortar no meio de uma sequencia de escape deixaria
 * lixo no comeco.
 */
export function trimStart(text: string, max = MAX_SCROLLBACK_BYTES): string {
  if (Buffer.byteLength(text) <= max) return text;
  let tail = text.slice(-Math.floor(max / 2));
  while (Buffer.byteLength(tail) > max) tail = tail.slice(Math.floor(tail.length / 10));
  const line = tail.indexOf('\n');
  return `\x1b[0m${line >= 0 ? tail.slice(line + 1) : tail}`;
}
