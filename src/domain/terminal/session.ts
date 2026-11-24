import { basename } from 'node:path';
import { parseWorktreeInfo, type WorktreeInfo } from '../git/worktree.js';
import { parsePaneColor, type PaneColor } from '../workspace/colors.js';
import { parseWorkspaceId } from '../workspace/workspace.js';
import { PERMISSION_NOTICE, type AgentEvent, type AgentState, type PermissionAnswer, type PermissionAsk } from './agent.js';
import {
  claudeLaunchCommand,
  cleanCommand,
  isClaudeCommand,
  parseSessionId,
  sessionIdOf,
  wantsOwnSession,
  withHookSettings,
} from './command.js';
import type { Pty, PtyFactory } from './pty.js';
import { SignalScanner } from './signals.js';
import type { ReplaySnapshot, TerminalSize, TerminalSnapshot, TerminalSpec, TerminalStatus } from './types.js';
import { busyProgram } from './foreground.js';
import { shellIntegrationEnv, type CommandResult, type ShellMark } from './shell-integration.js';

export interface SessionEvents {
  /** `seq` cresce a cada chunk, inclusive entre restarts. */
  onData(id: string, chunk: string, seq: number): void;
  onUpdate(snapshot: TerminalSnapshot): void;
  /**
   * Um pedido de permissao saiu de cena sem o app responder (voce respondeu no
   * terminal, o agente seguiu, o terminal reiniciou): o hook que espera deve
   * ser solto.
   */
  onAskClosed?(askId: string): void;
}

/** Porta: a conversa do Claude com este id ja foi gravada em disco? */
export type TranscriptCheck = (sessionId: string) => boolean;

/**
 * Ligacao do terminal com os hooks do Claude Code: o argumento de
 * `--settings` (ja com aspas de shell) e as variaveis que o script de hook
 * le para achar o app e se identificar.
 */
export interface HookBinding {
  readonly settingsArg: string;
  readonly env: Readonly<Record<string, string>>;
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
  private command: string;
  private color: PaneColor | null;
  /** Segue a conversa em uso: `/clear` e `/resume` trocam, e os hooks avisam. */
  private claudeSession: string | null;
  private readonly worktree: WorktreeInfo | null;
  private workspaceId: string;
  /** O que de fato e digitado no shell (o comando com a conversa escolhida). */
  private launch = '';
  private status: TerminalStatus = 'starting';
  private exitCode: number | null = null;
  private size: TerminalSize = DEFAULT_SIZE;

  private pty: Pty | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private replay: string[] = [];
  private replayBytes = 0;
  /** Numero do ultimo chunk emitido. */
  private seq = 0;
  private pendingRestart = false;
  private attention = false;
  private disposed = false;
  private armed = false;
  /** Mensagem de um pedido explicito de atencao (BEL/OSC), ate voce olhar. */
  private notice: string | null = null;
  private scanner = new SignalScanner();
  /** O comando inicial espera o shell imprimir algo (o prompt) antes de ser digitado. */
  private commandPending = false;
  private attentionSince: number | null = null;
  private agent: AgentState | null = null;
  /** Pedido de permissao esperando resposta (o hook esta parado esperando). */
  private ask: PermissionAsk | null = null;
  /**
   * Ha um proximo prompt esperando este agente terminar a volta (fila de
   * tarefas): o Stop nao vira pedido de atencao, a fila responde por voce.
   */
  private queued = false;
  /** O ultimo Stop nao avisou porque a fila ia responder; se ela desistir, avisa. */
  private stopSilenced = false;
  private foreground: string | null = null;
  private lastCommand: CommandResult | null = null;
  /** Inicio do comando rodando agora (marca C do OSC 133); `null` = nenhum. */
  private commandStartedAt: number | null = null;

  constructor(
    id: string,
    spec: TerminalSpec,
    private readonly ptys: PtyFactory,
    private readonly events: SessionEvents,
    private readonly hasTranscript: TranscriptCheck = () => false,
    private readonly hooks: HookBinding | null = null,
  ) {
    this.id = id;
    this.cwd = spec.cwd;
    this.shell = spec.shell?.trim() || ptys.defaultShell();
    this.command = cleanCommand(spec.command);
    this.color = parsePaneColor(spec.color);
    this.worktree = parseWorktreeInfo(spec.worktree);
    this.workspaceId = parseWorkspaceId(spec.workspaceId);
    // Um `claude` puro ganha a conversa que o servico escolheu; um que ja
    // escolhe a sua por id (`--resume X`) so e acompanhado.
    this.claudeSession = wantsOwnSession(this.command)
      ? parseSessionId(spec.claudeSession)
      : sessionIdOf(this.command);
    this.name = spec.name.trim() || basename(spec.cwd) || 'terminal';
  }

  snapshot(): TerminalSnapshot {
    return {
      id: this.id,
      name: this.name,
      cwd: this.cwd,
      shell: this.shell,
      command: this.command || null,
      color: this.color,
      claudeSession: this.claudeSession,
      worktree: this.worktree,
      workspaceId: this.workspaceId,
      status: this.status,
      exitCode: this.exitCode,
      createdAt: this.createdAt,
      needsAttention: this.needsAttention(),
      notice: this.notice,
      attentionSince: this.attentionSince,
      agent: this.agent,
      foreground: this.foreground,
      lastCommand: this.lastCommand,
      pendingPermission: this.ask,
    };
  }

  /** Output recente, para popular a UI quando ela (re)anexa a sessao. */
  replayBuffer(): ReplaySnapshot {
    return { data: this.replay.join(''), seq: this.seq };
  }

  isAlive(): boolean {
    return this.pty !== null;
  }

  start(size?: TerminalSize): void {
    if (this.pty) return;
    if (size) this.size = size;

    this.exitCode = null;
    this.scanner = new SignalScanner();
    this.dropAsk();
    this.agent = null;
    this.queued = false;
    this.foreground = null;
    this.lastCommand = null;
    this.commandStartedAt = null;
    this.launch = this.launchCommand();
    this.commandPending = this.launch.length > 0;
    this.setStatus('starting');

    try {
      this.pty = this.ptys.spawn({
        shell: this.shell,
        cwd: this.cwd,
        env: { ...buildEnv(), ...shellIntegrationEnv(this.shell, process.env), ...this.hooks?.env },
        size: this.size,
      });
    } catch (error) {
      this.pty = null;
      this.emitData(`\r\n\x1b[31mFalha ao iniciar "${this.shell}": ${errorMessage(error)}\x1b[0m\r\n`);
      this.setStatus('error');
      return;
    }

    // Os eventos sao deste pty. Depois de um restart, o antigo ainda pode
    // mandar dados ou o exit: entrariam na sessao nova (e o comando inicial
    // seria digitado antes do rc do shell novo carregar).
    const proc = this.pty;
    proc.onData((chunk) => {
      if (this.disposed || this.pty !== proc) return;
      this.emitData(chunk);
      const signal = this.scanner.scan(chunk);
      this.markActive();
      if (signal) this.raiseNotice(signal);
      for (const mark of this.scanner.takeMarks()) this.onShellMark(mark);
      this.followCwd(this.scanner.takeCwd());
      if (this.commandPending) {
        // O rc do shell ja rodou e o prompt apareceu: agora o comando entra
        // como se voce tivesse digitado. Nao arma o aviso de ocioso — um
        // agente recem-aberto esperando instrucao nao e novidade para ninguem.
        this.commandPending = false;
        proc.write(`${this.launch}\r`);
      }
    });

    proc.onExit((code) => {
      if (this.pty !== proc) return;
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
      this.dropAsk();
      this.agent = null;
      this.foreground = null;
      this.setStatus(code === 0 ? 'exited' : 'error');
    });
  }

  write(data: string): void {
    // Foco e mouse nao sao resposta: clicar no terminal nao atende o pedido.
    if (isPassiveInput(data)) {
      this.pty?.write(data);
      return;
    }
    // Pedir atencao so faz sentido depois que voce iniciou alguma coisa aqui.
    // Sem isto, o prompt do shell de um terminal recem-criado ja dispararia o
    // aviso, e varias abas novas apareceriam como "aguardando" sem motivo.
    this.armed = true;
    // Alguem (voce, ou a fila) ja respondeu ao agente parado.
    this.stopSilenced = false;
    const phase = this.agent && agentPhaseAfterInput(this.agent.phase, data);
    const changed = (phase !== null && phase !== this.agent?.phase) || this.ask !== null;
    if (phase !== null) this.agent = { ...this.agent!, phase };
    // Respondeu no dialogo do terminal: o cartao do app sai.
    this.dropAsk();
    // Digitar e responder: o pedido explicito ja foi atendido.
    if (this.notice !== null || changed) {
      this.notice = null;
      this.emitUpdate();
    }
    this.pty?.write(data);
  }

  resize(size: TerminalSize): void {
    if (size.cols < 1 || size.rows < 1) return;
    this.size = size;
    this.pty?.resize(size);
  }

  /** Programa rodando alem do shell (`claude`, `npm`...), ou `null`. */
  busyProgram(): string | null {
    if (!this.pty) return null;
    try {
      return busyProgram(this.pty.process, this.shell);
    } catch {
      return null;
    }
  }

  /** Controle de fluxo do output: a tela ficou para tras / alcancou. */
  pause(): void {
    this.pty?.pause();
  }

  resume(): void {
    this.pty?.resume();
  }

  /** Interrompe o processo em foreground sem matar a sessao (Ctrl-C). */
  interrupt(): void {
    if (this.pty) this.write('\x03');
  }

  /**
   * Evento de hook do Claude Code deste terminal. Com o agente conhecido, e
   * ele quem diz quando a volta terminou: o silencio do pty deixa de contar.
   */
  agentEvent(event: AgentEvent): void {
    if (!this.pty) return;
    if (event.sessionId && event.sessionId !== this.claudeSession) this.claudeSession = event.sessionId;
    const agent = this.agent ?? { phase: 'waiting' as const, turns: 0 };
    switch (event.kind) {
      case 'start':
        // Tambem chega no `/clear`, no `/resume` e ao compactar: so muda a conversa.
        this.agent = agent;
        break;
      case 'prompt':
        this.dropAsk();
        this.agent = { ...agent, phase: 'working' };
        this.stopSilenced = false;
        this.armed = true;
        this.attention = false;
        this.notice = null;
        break;
      case 'stop':
        this.dropAsk();
        this.agent = { phase: 'waiting', turns: agent.turns + 1 };
        this.attention = !this.queued;
        this.stopSilenced = this.queued;
        // Um pedido de permissao ainda aberto foi respondido: a volta terminou.
        this.notice = null;
        break;
      case 'permission':
        this.agent = { ...agent, phase: 'permission' };
        // Com o pedido do hook aberto, o texto dele (ferramenta e comando) diz mais.
        if (!this.ask) this.notice = event.message ?? PERMISSION_NOTICE;
        break;
      case 'ask':
        if (!event.ask) return;
        this.dropAsk();
        this.ask = event.ask;
        this.agent = { ...agent, phase: 'permission' };
        this.notice = `quer usar ${event.ask.tool}: ${event.ask.summary}`.slice(0, 200);
        break;
      case 'end':
        this.dropAsk();
        this.agent = null;
        break;
    }
    this.emitUpdate();
  }

  /**
   * Voce respondeu o pedido pelo app. `false` = o pedido ja nao existe (foi
   * respondido no terminal, ou expirou): quem chamou nao deve responder ao hook.
   */
  answerPermission(askId: string, answer: PermissionAnswer): boolean {
    if (!this.ask || this.ask.id !== askId) return false;
    this.ask = null;
    if (answer !== 'release') {
      this.notice = null;
      if (this.agent) this.agent = { ...this.agent, phase: 'working' };
    }
    this.emitUpdate();
    return true;
  }

  /** O hook que esperava desistiu (expirou ou morreu): o pedido segue so no terminal. */
  permissionGone(askId: string): void {
    if (this.ask?.id !== askId) return;
    this.ask = null;
    this.emitUpdate();
  }

  get pendingAskId(): string | null {
    return this.ask?.id ?? null;
  }

  /** A fila de tarefas tem (ou deixou de ter) um proximo prompt para este agente. */
  setQueued(queued: boolean): void {
    this.queued = queued;
    // A fila parou sem mandar o proximo (desligada, lista apagada): o agente
    // esta parado esperando voce, e ninguem avisou.
    if (queued || !this.stopSilenced || this.agent?.phase !== 'waiting') return;
    this.stopSilenced = false;
    this.attention = true;
    this.emitUpdate();
  }

  /**
   * Confere o programa em foreground (o main chama de tempos em tempos). O
   * agente que sumiu sem SessionEnd (caiu, `kill`) deixa de ser acompanhado.
   */
  refreshForeground(): void {
    if (!this.pty) return;
    const program = this.busyProgram();
    const agentGone = this.agent !== null && program === null;
    if (program === this.foreground && !agentGone) return;
    this.foreground = program;
    if (agentGone) {
      this.dropAsk();
      this.agent = null;
    }
    this.emitUpdate();
  }

  rename(name: string): void {
    const next = name.trim();
    if (!next || next === this.name) return;
    this.name = next;
    this.emitUpdate();
  }

  moveToWorkspace(workspaceId: string): void {
    if (workspaceId === this.workspaceId) return;
    this.workspaceId = workspaceId;
    this.emitUpdate();
  }

  setColor(color: PaneColor | null): void {
    if (color === this.color) return;
    this.color = color;
    this.emitUpdate();
  }

  /** Mata o pty e sobe um novo, preservando id, nome e cwd. */
  restart(cwd?: string): void {
    if (cwd) this.cwd = cwd;
    this.armed = false;
    this.notice = null;
    this.attention = false;
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
    this.dropAsk();
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

  /** Decidido a cada start: depois que a conversa existe, reiniciar a retoma. */
  private launchCommand(): string {
    const command = this.claudeSession && wantsOwnSession(this.command)
      ? claudeLaunchCommand(this.command, this.claudeSession, this.hasTranscript(this.claudeSession))
      : this.command;
    return this.hooks ? withHookSettings(command, this.hooks.settingsArg) : command;
  }

  /**
   * O shell mudou de diretorio (OSC 7): o terminal passa a reiniciar e a ser
   * restaurado ali. Um terminal do Claude fica no diretorio em que abriu: a
   * conversa dele e daquele projeto, e retoma-la em outro falharia.
   */
  private followCwd(cwd: string | null): void {
    if (!cwd || cwd === this.cwd || isClaudeCommand(this.command)) return;
    this.cwd = cwd;
    this.emitUpdate();
  }

  private onShellMark(mark: ShellMark): void {
    if (mark.kind === 'command-start') {
      this.commandStartedAt = Date.now();
      if (this.lastCommand === null) return;
      this.lastCommand = null;
      this.emitUpdate();
    } else if (mark.kind === 'command-end') {
      // D sem C: Enter num prompt vazio, Ctrl+C no prompt, o primeiro prompt.
      if (this.commandStartedAt === null) return;
      const now = Date.now();
      this.lastCommand = { exitCode: mark.exitCode, durationMs: now - this.commandStartedAt, endedAt: now };
      this.commandStartedAt = null;
      this.emitUpdate();
    }
  }

  /** Tira o pedido de cena e solta o hook que o esperava. */
  private dropAsk(): void {
    const ask = this.ask;
    if (!ask) return;
    this.ask = null;
    this.events.onAskClosed?.(ask.id);
  }

  private needsAttention(): boolean {
    return this.attention || this.notice !== null;
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

    // Com o agente conhecido pelos hooks, quem liga e desliga o aviso sao os
    // eventos dele: a TUI redesenha e silencia no meio do trabalho.
    if (status === 'running') {
      // Voltou a trabalhar: o pedido de atencao anterior ficou obsoleto.
      if (!this.agent) this.attention = false;
    } else if (status === 'idle' && previous === 'running') {
      if (!this.agent) this.attention = this.armed;
    } else if (status === 'exited' || status === 'error') {
      // Um processo que morre sozinho importa mesmo sem voce ter digitado nada.
      this.attention = true;
    }
    this.emitUpdate();
  }

  /** Marca que voce ja viu este terminal. */
  acknowledge(): void {
    if (!this.attention && this.notice === null) return;
    this.attention = false;
    this.notice = null;
    this.emitUpdate();
  }

  /**
   * Pedido explicito (BEL/OSC). Vale mesmo sem o aviso armado, e nao e
   * apagado pelo output seguinte: TUIs redesenham a tela depois de avisar.
   */
  private raiseNotice(message: string): void {
    if (this.notice === message) return;
    this.notice = message;
    this.emitUpdate();
  }

  private emitUpdate(): void {
    if (this.disposed) return;
    const needs = this.needsAttention();
    if (!needs) this.attentionSince = null;
    else this.attentionSince ??= Date.now();
    this.events.onUpdate(this.snapshot());
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private emitData(chunk: string): void {
    this.seq += 1;
    this.pushReplay(chunk);
    this.events.onData(this.id, chunk, this.seq);
  }

  private pushReplay(chunk: string): void {
    this.replay.push(chunk);
    this.replayBytes += chunk.length;
    while (this.replayBytes > REPLAY_LIMIT_BYTES && this.replay.length > 1) {
      this.replayBytes -= this.replay.shift()!.length;
    }
  }
}

export function buildEnv(base: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  // Agentes de CLI inspecionam TERM/COLORTERM para decidir cores e TUI.
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'MultiTerm';
  // Variaveis injetadas pelo Electron que confundem processos filhos.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  // Herdado de quem abriu o app (gnome-terminal...): o rc do VTE trocaria o
  // PROMPT_COMMAND pelo dele, e nao somos o VTE.
  delete env.VTE_VERSION;
  // Aberto por `npm start`, o app herda o ambiente do npm; o nvm, por exemplo,
  // reclama de `npm_config_prefix` em todo shell novo.
  for (const key of Object.keys(env)) {
    if (key.startsWith('npm_') || key === 'INIT_CWD') delete env[key];
  }
  // Aberto pelo Finder/Dock (ou um .desktop sem locale), o shell cairia no
  // locale C e acentos e caracteres das TUIs sairiam quebrados. O macOS nao
  // tem C.UTF-8; no Linux ele existe sempre (en_US pode nao estar gerado).
  if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8';
  return env;
}

/**
 * O que uma tecla faz com o agente: responder ao pedido de permissao o poe
 * para trabalhar de novo (Esc recusa e ele para); Esc ou Ctrl+C no meio da
 * volta interrompe, e ai nenhum Stop vem. `null` = nao muda.
 */
export function agentPhaseAfterInput(phase: AgentState['phase'], data: string): AgentState['phase'] | null {
  const interrupt = data === '\x1b' || data === '\x03';
  if (phase === 'permission') return interrupt ? 'waiting' : 'working';
  if (phase === 'working' && interrupt) return 'waiting';
  return null;
}

/**
 * Entrada que o xterm gera sozinho quando o programa pede: aviso de foco
 * (`ESC [ I` / `ESC [ O`) e relatos de mouse (SGR `ESC [ < ... M|m` e o
 * classico `ESC [ M` + 3 bytes).
 */
export function isPassiveInput(data: string): boolean {
  return /^(\x1b\[[IO]|\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[M[\s\S]{3})+$/.test(data);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
