import type { TerminalSize } from './types.js';

/**
 * Porta para um pseudo-terminal do sistema operacional.
 * O dominio depende desta interface, nunca do node-pty diretamente.
 */
export interface Pty {
  readonly pid: number;
  write(data: string): void;
  resize(size: TerminalSize): void;
  /** Envia um sinal ao processo (SIGINT, SIGTERM, ...). */
  kill(signal?: NodeJS.Signals): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (exitCode: number, signal?: number) => void): void;
}

export interface PtyOptions {
  readonly shell: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly size: TerminalSize;
}

export interface PtyFactory {
  /** Shell interativo padrao da plataforma. */
  defaultShell(): string;
  spawn(options: PtyOptions): Pty;
}
