import { basename } from 'node:path';
import type { Pty, PtyFactory } from './pty.js';
import type { TerminalSize, TerminalSnapshot, TerminalSpec, TerminalStatus } from './types.js';

export interface SessionEvents {
  onData(id: string, chunk: string): void;
  onUpdate(snapshot: TerminalSnapshot): void;
}

const DEFAULT_SIZE: TerminalSize = { cols: 80, rows: 24 };
/** Silencio apos o qual um terminal "running" passa a "idle". */
const IDLE_AFTER_MS = 700;
/** Output retido para re-anexar a UI (troca de layout, maximizar, reload). */
const REPLAY_LIMIT_BYTES = 256 * 1024;

/**
 * Uma sessao de terminal: dona do ciclo de vida do pty, do estado de atividade
 * e de um buffer curto de replay. Nao conhece IPC nem UI.
 */
export class TerminalSession {
  readonly id: string;
  readonly createdAt = Date.now();

  private name: string;
  private cwd: string;
  private shell: string;
  private status: TerminalStatus = 'starting';
  private exitCode: number | null = null;
  private size: TerminalSize = DEFAULT_SIZE;

  private pty: Pty | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private replay: string[] = [];
  private replayBytes = 0;
  private pendingRestart = false;
  private attention = false;
  private disposed = false;
  private armed = false;

  constructor(
    id: string,
    spec: TerminalSpec,
    private readonly ptys: PtyFactory,
    private readonly events: SessionEvents,
  ) {
    this.id = id;
    this.cwd = spec.cwd;
    this.shell = spec.shell?.trim() || ptys.defaultShell();
    this.name = spec.name.trim() || basename(spec.cwd) || 'terminal';
  }

  snapshot(): TerminalSnapshot {
    return {
      id: this.id,
      name: this.name,
      cwd: this.cwd,
      shell: this.shell,
      status: this.status,
      exitCode: this.exitCode,
      createdAt: this.createdAt,
      needsAttention: this.attention,
    };
  }

  /** Output recente, para popular a UI quando ela (re)anexa a sessao. */
  replayBuffer(): string {
    return this.replay.join('');
  }

  isAlive(): boolean {
    return this.pty !== null;
  }

  start(size?: TerminalSize): void {
    if (this.pty) return;
    if (size) this.size = size;

    this.exitCode = null;
    this.setStatus('starting');

    try {
      this.pty = this.ptys.spawn({
        shell: this.shell,
        cwd: this.cwd,
        env: buildEnv(),
        size: this.size,
      });
    } catch (error) {
      this.pty = null;
      this.pushReplay(`\r\n\x1b[31mFalha ao iniciar "${this.shell}": ${errorMessage(error)}\x1b[0m\r\n`);
      this.events.onData(this.id, this.replay[this.replay.length - 1]!);
      this.setStatus('error');
      return;
    }

    this.pty.onData((chunk) => {
      if (this.disposed) return;
      this.pushReplay(chunk);
      this.events.onData(this.id, chunk);
      this.markActive();
    });

    this.pty.onExit((code) => {
      this.pty = null;
      this.clearIdleTimer();
      // O `exit` chega depois do dispose(): a sessao ja saiu do workspace e
      // qualquer evento daqui em diante seria sobre um terminal inexistente.
      if (this.disposed) return;
      if (this.pendingRestart) {
        this.pendingRestart = false;
        this.replay = [];
        this.replayBytes = 0;
        this.start();
        return;
      }
      this.exitCode = code;
      this.setStatus(code === 0 ? 'exited' : 'error');
    });
  }

  write(data: string): void {
    // Pedir atencao so faz sentido depois que voce iniciou alguma coisa aqui.
    // Sem isto, o prompt do shell de um terminal recem-criado ja dispararia o
    // aviso, e varias abas novas apareceriam como "aguardando" sem motivo.
    this.armed = true;
    this.pty?.write(data);
  }

  resize(size: TerminalSize): void {
    if (size.cols < 1 || size.rows < 1) return;
    this.size = size;
    this.pty?.resize(size);
  }

  /** Interrompe o processo em foreground sem matar a sessao (Ctrl-C). */
  interrupt(): void {
    this.pty?.write('\x03');
  }

  rename(name: string): void {
    const next = name.trim();
    if (!next || next === this.name) return;
    this.name = next;
    this.emitUpdate();
  }

  /** Mata o pty e sobe um novo, preservando id, nome e cwd. */
  restart(cwd?: string): void {
    if (cwd) this.cwd = cwd;
    this.armed = false;
    if (!this.pty) {
      this.replay = [];
      this.replayBytes = 0;
      this.start();
      return;
    }
    this.pendingRestart = true;
    this.pty.kill();
  }

  /** Encerra definitivamente. Nao emite update: a sessao sai do workspace. */
  dispose(): void {
    this.disposed = true;
    this.pendingRestart = false;
    this.clearIdleTimer();
    const pty = this.pty;
    this.pty = null;
    this.replay = [];
    this.replayBytes = 0;
    try {
      pty?.kill();
    } catch {
      // processo ja morreu
    }
  }

  private markActive(): void {
    if (this.status !== 'running') this.setStatus('running');
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.status === 'running') this.setStatus('idle');
    }, IDLE_AFTER_MS);
    this.idleTimer.unref?.();
  }

  private setStatus(status: TerminalStatus): void {
    if (this.status === status) return;
    const previous = this.status;
    this.status = status;

    if (status === 'running') {
      // Voltou a trabalhar: o pedido de atencao anterior ficou obsoleto.
      this.attention = false;
    } else if (status === 'idle' && previous === 'running') {
      this.attention = this.armed;
    } else if (status === 'exited' || status === 'error') {
      // Um processo que morre sozinho importa mesmo sem voce ter digitado nada.
      this.attention = true;
    }
    this.emitUpdate();
  }

  /** Marca que voce ja viu este terminal. */
  acknowledge(): void {
    if (!this.attention) return;
    this.attention = false;
    this.emitUpdate();
  }

  private emitUpdate(): void {
    if (this.disposed) return;
    this.events.onUpdate(this.snapshot());
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private pushReplay(chunk: string): void {
    this.replay.push(chunk);
    this.replayBytes += chunk.length;
    while (this.replayBytes > REPLAY_LIMIT_BYTES && this.replay.length > 1) {
      this.replayBytes -= this.replay.shift()!.length;
    }
  }
}

function buildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Agentes de CLI inspecionam TERM/COLORTERM para decidir cores e TUI.
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  // Variaveis injetadas pelo Electron que confundem processos filhos.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
