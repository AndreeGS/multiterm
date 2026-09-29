import os from 'node:os';
import * as pty from 'node-pty';
import type { Pty, PtyFactory, PtyOptions } from '../../domain/terminal/pty.js';
import type { TerminalSize } from '../../domain/terminal/types.js';

class NodePty implements Pty {
  constructor(private readonly proc: pty.IPty) {}

  get pid(): number {
    return this.proc.pid;
  }

  write(data: string): void {
    this.proc.write(data);
  }

  resize({ cols, rows }: TerminalSize): void {
    try {
      this.proc.resize(cols, rows);
    } catch {
      // pty ja encerrado entre o resize da UI e o exit do processo
    }
  }

  kill(signal?: NodeJS.Signals): void {
    this.proc.kill(signal);
  }

  onData(listener: (chunk: string) => void): void {
    this.proc.onData(listener);
  }

  onExit(listener: (exitCode: number, signal?: number) => void): void {
    this.proc.onExit(({ exitCode, signal }) => listener(exitCode, signal));
  }
}

export class NodePtyFactory implements PtyFactory {
  defaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC ?? 'powershell.exe';
    }
    return process.env.SHELL ?? os.userInfo().shell ?? '/bin/bash';
  }

  spawn({ shell, cwd, env, size }: PtyOptions): Pty {
    const proc = pty.spawn(shell, shellArgs(shell), {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd,
      env: env as Record<string, string>,
      // Melhora o throughput de agentes que imprimem muito (Linux/macOS).
      useConpty: process.platform === 'win32' ? true : undefined,
    });
    return new NodePty(proc);
  }
}

/** Login shell para que .bashrc/.zshrc e PATH de ferramentas estejam carregados. */
function shellArgs(shell: string): string[] {
  if (process.platform === 'win32') return [];
  return shell.endsWith('/fish') ? ['--login'] : ['-l'];
}
