import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { hookSettings, parseAgentEvent, PERMISSION_NOTICE, shellQuote, type AgentEvent } from '../../domain/terminal/agent.js';
import { withHookSettings } from '../../domain/terminal/command.js';
import type { Pty, PtyFactory, PtyOptions } from '../../domain/terminal/pty.js';
import { agentPhaseAfterInput, buildEnv, TerminalSession } from '../../domain/terminal/session.js';
import {
  formatDuration,
  formatWaiting,
  parseShellMark,
  shellIntegrationEnv,
} from '../../domain/terminal/shell-integration.js';
import { SignalScanner } from '../../domain/terminal/signals.js';
import type { TerminalSnapshot } from '../../domain/terminal/types.js';
import { handleLine } from '../../infrastructure/agent/claude-hooks.js';

const SESSION = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const OTHER = '11111111-2222-4333-8444-555555555555';

describe('parseAgentEvent', () => {
  it('traduz os hooks que o app escuta', () => {
    assert.deepEqual(parseAgentEvent({ event: 'Stop', sessionId: SESSION }), { kind: 'stop', sessionId: SESSION, message: null });
    assert.equal(parseAgentEvent({ event: 'SessionStart' })?.kind, 'start');
    assert.equal(parseAgentEvent({ event: 'UserPromptSubmit' })?.kind, 'prompt');
    assert.equal(parseAgentEvent({ event: 'SessionEnd' })?.kind, 'end');
    assert.equal(parseAgentEvent({ event: 'SessionEnd', reason: 'clear' }), null);
  });

  it('notificacao so conta quando pede uma decisao', () => {
    const permission = parseAgentEvent({ event: 'Notification', notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
    assert.deepEqual(permission, { kind: 'permission', sessionId: null, message: 'Claude needs your permission to use Bash' });
    assert.equal(parseAgentEvent({ event: 'Notification', notificationType: 'elicitation_dialog' })?.kind, 'permission');
    assert.equal(parseAgentEvent({ event: 'Notification', notificationType: 'idle_prompt', message: 'waiting' }), null);
    // Versao sem notification_type: decide pelo texto.
    assert.equal(parseAgentEvent({ event: 'Notification', message: 'Claude needs your permission' })?.kind, 'permission');
    assert.equal(parseAgentEvent({ event: 'Notification', message: 'Claude is waiting for your input' }), null);
  });

  it('descarta o resto e limpa o texto', () => {
    assert.equal(parseAgentEvent({ event: 'PreToolUse' }), null);
    assert.equal(parseAgentEvent(null), null);
    assert.equal(parseAgentEvent({ event: 'Stop', sessionId: 'nao-e-uuid' })?.sessionId, null);
    assert.equal(parseAgentEvent({ event: 'Notification', notificationType: 'permission_prompt', message: 'a\x1b[31m\n b' })?.message, 'a [31m b');
  });
});

describe('hooks no comando', () => {
  it('liga --settings so no claude interativo', () => {
    assert.equal(withHookSettings('claude', "'/d/h.json'"), "claude --settings '/d/h.json'");
    assert.equal(withHookSettings('claude --session-id x --model opus', 'S'), 'claude --settings S --session-id x --model opus');
    assert.equal(withHookSettings('npm run dev', 'S'), 'npm run dev');
    assert.equal(withHookSettings('claude -p oi', 'S'), 'claude -p oi');
    assert.equal(withHookSettings('claude --settings meu.json', 'S'), 'claude --settings meu.json');
  });

  it('settings tem um hook por evento, com o comando dado', () => {
    const settings = hookSettings('run') as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    assert.deepEqual(Object.keys(settings.hooks).sort(), ['Notification', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']);
    assert.equal(settings.hooks.Stop?.[0]?.hooks[0]?.command, 'run');
  });

  it('shellQuote', () => {
    assert.equal(shellQuote('/a b/c'), "'/a b/c'");
    assert.equal(shellQuote("it's"), "'it'\\''s'");
  });

  it('linha do socket: token e evento validos', () => {
    const got: Array<[string, AgentEvent]> = [];
    const push = (token: string, event: AgentEvent) => got.push([token, event]);
    handleLine(JSON.stringify({ token: 't', event: 'Stop' }), push);
    handleLine('nao e json', push);
    handleLine(JSON.stringify({ event: 'Stop' }), push);
    handleLine(JSON.stringify({ token: 't', event: 'Outro' }), push);
    assert.deepEqual(got.map(([token, event]) => [token, event.kind]), [['t', 'stop']]);
  });
});

describe('marcas de prompt (OSC 133)', () => {
  it('parseShellMark', () => {
    assert.deepEqual(parseShellMark('A'), { kind: 'prompt' });
    assert.deepEqual(parseShellMark('C'), { kind: 'command-start' });
    assert.deepEqual(parseShellMark('D;1'), { kind: 'command-end', exitCode: 1 });
    assert.deepEqual(parseShellMark('D'), { kind: 'command-end', exitCode: null });
    assert.equal(parseShellMark('B'), null);
  });

  it('scanner separa as marcas e nao as confunde com notificacao', () => {
    const scanner = new SignalScanner();
    assert.equal(scanner.scan('\x1b]133;C\x07saida\x1b]133;D;'), null);
    assert.equal(scanner.scan('2\x1b\\\x1b]133;A\x07$ '), null);
    assert.deepEqual(scanner.takeMarks().map((mark) => mark.kind), ['command-start', 'command-end', 'prompt']);
    assert.deepEqual(scanner.takeMarks(), []);
  });

  it('bash ganha PROMPT_COMMAND e PS0; outros shells, nada', () => {
    const env = shellIntegrationEnv('/bin/bash', {});
    assert.match(env.PROMPT_COMMAND ?? '', /133;D/);
    assert.match(env.PS0 ?? '', /133;C/);
    assert.deepEqual(shellIntegrationEnv('/usr/bin/zsh', {}), {});
    // Um PROMPT_COMMAND herdado continua rodando depois do nosso; um PS0 herdado fica.
    const kept = shellIntegrationEnv('bash', { PROMPT_COMMAND: 'history -a', PS0: 'x' });
    assert.match(kept.PROMPT_COMMAND ?? '', /;history -a$/);
    assert.equal(kept.PS0, undefined);
  });

  it('buildEnv tira o VTE_VERSION herdado', () => {
    assert.equal(buildEnv({ VTE_VERSION: '7600' }, 'linux').VTE_VERSION, undefined);
  });

  it('formatDuration e formatWaiting', () => {
    assert.equal(formatDuration(4200), '4s');
    assert.equal(formatDuration(123_000), '2m 3s');
    assert.equal(formatDuration(3_900_000), '1h 5m');
    assert.equal(formatWaiting(30_000), null);
    assert.equal(formatWaiting(5 * 60_000), 'ha 5 min');
    assert.equal(formatWaiting(130 * 60_000), 'ha 2 h');
  });
});

describe('agentPhaseAfterInput', () => {
  it('responder a permissao volta ao trabalho; Esc recusa', () => {
    assert.equal(agentPhaseAfterInput('permission', '1'), 'working');
    assert.equal(agentPhaseAfterInput('permission', '\x1b'), 'waiting');
  });
  it('Esc ou Ctrl+C no meio da volta interrompe; o resto nao muda', () => {
    assert.equal(agentPhaseAfterInput('working', '\x03'), 'waiting');
    assert.equal(agentPhaseAfterInput('working', 'a'), null);
    assert.equal(agentPhaseAfterInput('working', '\x1b[A'), null);
    assert.equal(agentPhaseAfterInput('waiting', '\x1b'), null);
  });
});

/* ---------- sessao com agente ---------- */

class FakePty implements Pty {
  readonly pid = 1;
  process: string | null = 'bash';
  readonly written: string[] = [];
  private dataListener: (chunk: string) => void = () => {};
  write(data: string): void {
    this.written.push(data);
  }
  pause(): void {}
  resume(): void {}
  resize(): void {}
  kill(): void {}
  onData(listener: (chunk: string) => void): void {
    this.dataListener = listener;
  }
  onExit(): void {}
  emit(chunk: string): void {
    this.dataListener(chunk);
  }
}

class FakeFactory implements PtyFactory {
  readonly spawned: FakePty[] = [];
  readonly options: PtyOptions[] = [];
  defaultShell(): string {
    return '/bin/bash';
  }
  spawn(options: PtyOptions): Pty {
    const pty = new FakePty();
    this.spawned.push(pty);
    this.options.push(options);
    return pty;
  }
}

describe('TerminalSession com hooks', () => {
  let factory: FakeFactory;
  let updates: TerminalSnapshot[];
  const event = (kind: AgentEvent['kind'], extra: Partial<AgentEvent> = {}): AgentEvent =>
    ({ kind, sessionId: null, message: null, ...extra });
  const last = (): TerminalSnapshot => updates[updates.length - 1]!;

  const session = (): TerminalSession => {
    const s = new TerminalSession('t1', { name: 'a', cwd: '/tmp', command: 'claude', claudeSession: SESSION }, factory, {
      onData: () => {},
      onUpdate: (snapshot) => updates.push(snapshot),
    }, () => false, { settingsArg: "'/d/h.json'", env: { MULTITERM_HOOK_TOKEN: 'tok', MULTITERM_HOOK_SOCKET: '/s' } });
    s.start();
    return s;
  };

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    factory = new FakeFactory();
    updates = [];
  });
  afterEach(() => mock.timers.reset());

  it('o claude abre com os hooks, e o pty recebe o token', () => {
    session();
    factory.spawned[0]!.emit('$ ');
    assert.equal(factory.spawned[0]!.written[0], `claude --settings '/d/h.json' --session-id ${SESSION}\r`);
    assert.equal(factory.options[0]!.env.MULTITERM_HOOK_TOKEN, 'tok');
    assert.match(factory.options[0]!.env.PROMPT_COMMAND ?? '', /133/);
  });

  it('o aviso segue os hooks, nao o silencio do pty', () => {
    const s = session();
    const pty = factory.spawned[0]!;
    s.agentEvent(event('start'));
    s.agentEvent(event('prompt'));
    assert.deepEqual(last().agent, { phase: 'working', turns: 0 });
    // TUI parada no meio do trabalho (ferramenta lenta): nao e "aguardando".
    pty.emit('spinner');
    mock.timers.tick(1000);
    assert.equal(last().needsAttention, false);
    s.agentEvent(event('stop'));
    assert.deepEqual(last().agent, { phase: 'waiting', turns: 1 });
    assert.equal(last().needsAttention, true);
    assert.equal(last().attentionSince, Date.now());
    // A TUI redesenha depois do Stop: o aviso fica.
    pty.emit('redesenho');
    assert.equal(last().needsAttention, true);
    s.agentEvent(event('prompt'));
    assert.equal(last().needsAttention, false);
    assert.equal(last().attentionSince, null);
  });

  it('pedido de permissao vira aviso explicito; responder volta ao trabalho', () => {
    const s = session();
    s.agentEvent(event('prompt'));
    s.agentEvent(event('permission', { message: 'usar Bash?' }));
    assert.equal(last().notice, 'usar Bash?');
    assert.equal(last().agent?.phase, 'permission');
    s.write('1');
    assert.equal(last().notice, null);
    assert.equal(last().agent?.phase, 'working');
    s.agentEvent(event('permission'));
    assert.equal(last().notice, PERMISSION_NOTICE);
  });

  it('com a fila esperando, o Stop nao avisa; se ela desistir, avisa', () => {
    const s = session();
    s.agentEvent(event('prompt'));
    s.setQueued(true);
    s.agentEvent(event('stop'));
    assert.equal(last().needsAttention, false);
    s.setQueued(false);
    assert.equal(last().needsAttention, true);
  });

  it('a fila mandou o proximo antes de desligar: nada de aviso', () => {
    const s = session();
    s.agentEvent(event('prompt'));
    s.setQueued(true);
    s.agentEvent(event('stop'));
    s.write('ultima tarefa\r');
    s.setQueued(false);
    assert.equal(last().needsAttention, false);
  });

  it('a conversa segue o /clear (e o restart retoma a nova)', () => {
    const s = session();
    s.agentEvent(event('start', { sessionId: OTHER }));
    assert.equal(last().claudeSession, OTHER);
    assert.equal(s.snapshot().claudeSession, OTHER);
  });

  it('agente que some do foreground deixa de ser acompanhado', () => {
    const s = session();
    const pty = factory.spawned[0]!;
    pty.process = 'claude';
    s.agentEvent(event('start'));
    s.refreshForeground();
    assert.equal(last().foreground, 'claude');
    pty.process = 'bash';
    s.refreshForeground();
    assert.equal(last().foreground, null);
    assert.equal(last().agent, null);
  });

  it('marcas do shell viram o resultado do ultimo comando', () => {
    session();
    const pty = factory.spawned[0]!;
    pty.emit('\x1b]133;D;0\x07\x1b]133;A\x07$ ');
    assert.equal(last().lastCommand, null);
    pty.emit('\x1b]133;C\x07');
    mock.timers.tick(4000);
    pty.emit('erro\x1b]133;D;2\x07');
    assert.deepEqual(last().lastCommand, { exitCode: 2, durationMs: 4000, endedAt: Date.now() });
    pty.emit('\x1b]133;C\x07');
    assert.equal(last().lastCommand, null);
  });
});
