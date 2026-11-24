import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import type { AgentEvent, PermissionAnswer } from '../../domain/terminal/agent.js';
import { cleanCommand, wantsOwnSession } from '../../domain/terminal/command.js';
import type { PtyFactory } from '../../domain/terminal/pty.js';
import type { PaneColor } from '../../domain/workspace/colors.js';
import { TerminalSession, type HookBinding, type TranscriptCheck } from '../../domain/terminal/session.js';
import type { ReplaySnapshot, TerminalSize, TerminalSnapshot, TerminalSpec } from '../../domain/terminal/types.js';

export interface TerminalServiceListeners {
  /** Bytes crus do pty, destinados ao xterm. `seq` numera os chunks da sessao. */
  onData(id: string, chunk: string, seq: number): void;
  /** Metadados da sessao mudaram (status, nome, cwd). */
  onUpdate(snapshot: TerminalSnapshot): void;
  /** Sessao removida do workspace. */
  onClose(id: string): void;
  /** Um pedido de permissao saiu de cena sem resposta do app: soltar o hook. */
  onAskClosed?(askId: string): void;
}

/**
 * Hooks do Claude Code ligados: o arquivo de `--settings` e as variaveis com
 * que o script de hook acha o app. Cada terminal ganha ainda um token proprio
 * (`MULTITERM_HOOK_TOKEN`), que e como o evento chega ao terminal certo.
 */
export interface HookConfig {
  readonly settingsArg: string;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Caso de uso: gerenciar o conjunto de sessoes abertas.
 * Unico ponto do app que cria/destroi terminais.
 */
export class TerminalService {
  private readonly sessions = new Map<string, TerminalSession>();
  /** Token de hook -> id do terminal. */
  private readonly hookTokens = new Map<string, string>();

  constructor(
    private readonly ptys: PtyFactory,
    private readonly listeners: TerminalServiceListeners,
    private readonly hasTranscript: TranscriptCheck = () => false,
    private readonly hooks: HookConfig | null = null,
  ) {}

  /**
   * `reuseId` mantem o id de um terminal da sessao anterior, para notas e
   * listas vinculadas a ele continuarem apontando para o lugar certo.
   */
  create(spec: TerminalSpec, size?: TerminalSize, reuseId?: string): TerminalSnapshot {
    const cwd = resolveCwd(spec.cwd);
    const id = reuseId && !this.sessions.has(reuseId) ? reuseId : randomUUID();
    // Cada `claude` ganha uma conversa propria; restaurar traz a mesma de volta.
    const claudeSession = wantsOwnSession(cleanCommand(spec.command))
      ? (spec.claudeSession ?? randomUUID())
      : null;
    const session = new TerminalSession(id, { ...spec, cwd, claudeSession }, this.ptys, {
      onData: (sid, chunk, seq) => this.listeners.onData(sid, chunk, seq),
      onUpdate: (snapshot) => this.listeners.onUpdate(snapshot),
      onAskClosed: (askId) => this.listeners.onAskClosed?.(askId),
    }, this.hasTranscript, this.bindHooks(id));
    this.sessions.set(id, session);
    session.start(size);
    return session.snapshot();
  }

  /** Evento de hook do Claude Code; o token diz de qual terminal. */
  agentEvent(token: string, event: AgentEvent): boolean {
    const id = this.hookTokens.get(token);
    const session = id ? this.sessions.get(id) : undefined;
    if (!session?.isAlive()) return false;
    session.agentEvent(event);
    return true;
  }

  /**
   * Resposta do app a um pedido de permissao do terminal `id`. `true` = o
   * pedido ainda estava aberto, e o hook deve receber a resposta.
   */
  answerPermission(id: string, askId: string, answer: PermissionAnswer): boolean {
    return this.sessions.get(id)?.answerPermission(askId, answer) ?? false;
  }

  /** O hook desistiu de esperar o pedido `askId`. */
  permissionGone(askId: string): void {
    for (const session of this.sessions.values()) session.permissionGone(askId);
  }

  setQueued(id: string, queued: boolean): void {
    this.sessions.get(id)?.setQueued(queued);
  }

  /** Confere o programa em foreground de todos os terminais vivos. */
  refreshForeground(): void {
    for (const session of this.sessions.values()) session.refreshForeground();
  }

  list(): TerminalSnapshot[] {
    return [...this.sessions.values()].map((session) => session.snapshot());
  }

  snapshot(id: string): TerminalSnapshot | null {
    return this.sessions.get(id)?.snapshot() ?? null;
  }

  /** Output recente, para a UI reconstruir a tela ao (re)anexar. */
  replay(id: string): ReplaySnapshot {
    return this.sessions.get(id)?.replayBuffer() ?? { data: '', seq: 0 };
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

  busyProgram(id: string): string | null {
    return this.sessions.get(id)?.busyProgram() ?? null;
  }

  pause(id: string): void {
    this.sessions.get(id)?.pause();
  }

  resume(id: string): void {
    this.sessions.get(id)?.resume();
  }

  interrupt(id: string): void {
    this.sessions.get(id)?.interrupt();
  }

  rename(id: string, name: string): void {
    this.sessions.get(id)?.rename(name);
  }

  moveToWorkspace(id: string, workspaceId: string): void {
    this.sessions.get(id)?.moveToWorkspace(workspaceId);
  }

  setColor(id: string, color: PaneColor | null): void {
    this.sessions.get(id)?.setColor(color);
  }

  /** Reinicia o shell. `cwd` opcional troca o diretorio de trabalho. */
  restart(id: string, cwd?: string): void {
    this.sessions.get(id)?.restart(cwd ? resolveCwd(cwd) : undefined);
  }

  close(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    this.forgetHooks(id);
    session.dispose();
    this.listeners.onClose(id);
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
    this.hookTokens.clear();
  }

  private bindHooks(id: string): HookBinding | null {
    if (!this.hooks) return null;
    const token = randomUUID();
    this.hookTokens.set(token, id);
    return { settingsArg: this.hooks.settingsArg, env: { ...this.hooks.env, MULTITERM_HOOK_TOKEN: token } };
  }

  private forgetHooks(id: string): void {
    for (const [token, owner] of this.hookTokens) if (owner === id) this.hookTokens.delete(token);
  }
}

/** Garante um diretorio existente e absoluto; cai no home se invalido. */
export function resolveCwd(cwd: string): string {
  const candidate = cwd && isAbsolute(cwd) ? cwd : resolve(homedir(), cwd || '.');
  try {
    if (statSync(candidate).isDirectory()) return candidate;
  } catch {
    // inexistente
  }
  return homedir();
}
