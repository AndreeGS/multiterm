import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import type { PtyFactory } from '../../domain/terminal/pty.js';
import { TerminalSession } from '../../domain/terminal/session.js';
import type { TerminalSize, TerminalSnapshot, TerminalSpec } from '../../domain/terminal/types.js';

export interface TerminalServiceListeners {
  /** Bytes crus do pty, destinados ao xterm. */
  onData(id: string, chunk: string): void;
  /** Metadados da sessao mudaram (status, nome, cwd). */
  onUpdate(snapshot: TerminalSnapshot): void;
  /** Sessao removida do workspace. */
  onClose(id: string): void;
}

/**
 * Caso de uso: gerenciar o conjunto de sessoes abertas.
 * Unico ponto do app que cria/destroi terminais.
 */
export class TerminalService {
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(
    private readonly ptys: PtyFactory,
    private readonly listeners: TerminalServiceListeners,
  ) {}

  /**
   * `reuseId` mantem o id de um terminal da sessao anterior, para notas e
   * listas vinculadas a ele continuarem apontando para o lugar certo.
   */
  create(spec: TerminalSpec, size?: TerminalSize, reuseId?: string): TerminalSnapshot {
    const cwd = resolveCwd(spec.cwd);
    const id = reuseId && !this.sessions.has(reuseId) ? reuseId : randomUUID();
    const session = new TerminalSession(id, { ...spec, cwd }, this.ptys, {
      onData: (sid, chunk) => this.listeners.onData(sid, chunk),
      onUpdate: (snapshot) => this.listeners.onUpdate(snapshot),
    });
    this.sessions.set(id, session);
    session.start(size);
    return session.snapshot();
  }

  list(): TerminalSnapshot[] {
    return [...this.sessions.values()].map((session) => session.snapshot());
  }

  snapshot(id: string): TerminalSnapshot | null {
    return this.sessions.get(id)?.snapshot() ?? null;
  }

  /** Output recente, para a UI reconstruir a tela ao (re)anexar. */
  replay(id: string): string {
    return this.sessions.get(id)?.replayBuffer() ?? '';
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data);
  }

  resize(id: string, size: TerminalSize): void {
    this.sessions.get(id)?.resize(size);
  }

  acknowledge(id: string): void {
    this.sessions.get(id)?.acknowledge();
  }

  interrupt(id: string): void {
    this.sessions.get(id)?.interrupt();
  }

  rename(id: string, name: string): void {
    this.sessions.get(id)?.rename(name);
  }

  /** Reinicia o shell. `cwd` opcional troca o diretorio de trabalho. */
  restart(id: string, cwd?: string): void {
    this.sessions.get(id)?.restart(cwd ? resolveCwd(cwd) : undefined);
  }

  close(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    session.dispose();
    this.listeners.onClose(id);
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
  }
}

/** Garante um diretorio existente e absoluto; cai no home se invalido. */
function resolveCwd(cwd: string): string {
  const candidate = cwd && isAbsolute(cwd) ? cwd : resolve(homedir(), cwd || '.');
  try {
    if (statSync(candidate).isDirectory()) return candidate;
  } catch {
    // inexistente
  }
  return homedir();
}
