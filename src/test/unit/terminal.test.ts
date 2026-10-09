import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import {
  claudeProjectKey,
  cleanCommand,
  isClaudeCommand,
  MAX_COMMAND_LENGTH,
  withContinue,
} from '../../domain/terminal/command.js';
import { parseTerminalId } from '../../domain/terminal/link.js';
import type { Pty, PtyFactory, PtyOptions } from '../../domain/terminal/pty.js';
import { TerminalSession } from '../../domain/terminal/session.js';
import { BELL, notificationText, SignalScanner } from '../../domain/terminal/signals.js';
import type { TerminalSize, TerminalSnapshot } from '../../domain/terminal/types.js';

describe('SignalScanner', () => {
  it('BEL solto vira pedido', () => {
    assert.equal(new SignalScanner().scan('pronto\x07'), BELL);
  });

  it('OSC partido entre chunks', () => {
    const scanner = new SignalScanner();
    assert.equal(scanner.scan('\x1b]9;fe'), null);
    assert.equal(scanner.scan('ito\x07'), 'feito');
  });

  it('titulo (OSC 0/2) terminado em BEL nao e sinal', () => {
    assert.equal(new SignalScanner().scan('\x1b]2;titulo\x07texto'), null);
  });

  it('OSC terminado em ST', () => {
    assert.equal(new SignalScanner().scan('\x1b]99;i=1;pronto\x1b\\'), 'pronto');
  });

  it('mensagem tem prioridade sobre BEL no mesmo chunk', () => {
    assert.equal(new SignalScanner().scan('\x07\x1b]9;olha aqui\x07'), 'olha aqui');
  });

  it('ESC seguido de outra coisa aborta o OSC', () => {
    const scanner = new SignalScanner();
    assert.equal(scanner.scan('\x1b]9;nada\x1b[0m'), null);
    assert.equal(scanner.scan('\x07'), BELL);
  });
});

describe('notificationText', () => {
  it('OSC 9 com mensagem', () => assert.equal(notificationText('9;oi'), 'oi'));
  it('OSC 9;4 e progresso, nao notificacao', () => assert.equal(notificationText('9;4;1;50'), null));
  it('OSC 777 usa o corpo, depois o titulo', () => {
    assert.equal(notificationText('777;notify;Claude;precisa de permissao'), 'precisa de permissao');
    assert.equal(notificationText('777;notify;Claude'), 'Claude');
    assert.equal(notificationText('777;outro;x'), null);
  });
  it('OSC 99 sem texto vira BEL', () => assert.equal(notificationText('99;i=1'), BELL));
  it('limpa caracteres de controle e espacos', () => assert.equal(notificationText('9;a\x01\n  b'), 'a b'));
  it('outros codigos sao ignorados', () => assert.equal(notificationText('0;titulo'), null));
});

describe('comando inicial', () => {
  it('cleanCommand: uma linha, sem espacos nas pontas, com limite', () => {
    assert.equal(cleanCommand('  npm run dev\r\n'), 'npm run dev');
    assert.equal(cleanCommand('a\nb'), 'a b');
    assert.equal(cleanCommand(42), '');
    assert.equal(cleanCommand('x'.repeat(MAX_COMMAND_LENGTH + 10)).length, MAX_COMMAND_LENGTH);
  });

  it('isClaudeCommand', () => {
    assert.ok(isClaudeCommand('claude'));
    assert.ok(isClaudeCommand('  ~/bin/claude --model opus'));
    assert.ok(!isClaudeCommand('claudette'));
    assert.ok(!isClaudeCommand('npm run dev'));
  });

  it('withContinue retoma a conversa', () => {
    assert.equal(withContinue('claude'), 'claude --continue');
    assert.equal(withContinue('claude --model opus'), 'claude --continue --model opus');
  });

  it('withContinue nao mexe em quem ja escolhe a conversa', () => {
    for (const command of ['claude -c', 'claude --resume x', 'claude -p oi', 'claude --session-id=abc']) {
      assert.equal(withContinue(command), command);
    }
    assert.equal(withContinue('npm run dev'), 'npm run dev');
  });

  it('claudeProjectKey troca tudo que nao e alfanumerico por hifen', () => {
    assert.equal(claudeProjectKey('/home/ana/meu.projeto'), '-home-ana-meu-projeto');
  });

  it('parseTerminalId', () => {
    assert.equal(parseTerminalId('abc'), 'abc');
    assert.equal(parseTerminalId(''), null);
    assert.equal(parseTerminalId('x'.repeat(65)), null);
    assert.equal(parseTerminalId(1), null);
  });
});

/* ---------- TerminalSession com PTY falso ---------- */

class FakePty implements Pty {
  readonly pid = 1;
  readonly written: string[] = [];
  killed = false;
  private dataListener: (chunk: string) => void = () => {};
  private exitListener: (code: number) => void = () => {};

  write(data: string): void {
    this.written.push(data);
  }
  resize(_size: TerminalSize): void {}
  kill(): void {
    this.killed = true;
  }
  onData(listener: (chunk: string) => void): void {
    this.dataListener = listener;
  }
  onExit(listener: (code: number) => void): void {
    this.exitListener = listener;
  }

  emit(chunk: string): void {
    this.dataListener(chunk);
  }
  exit(code: number): void {
    this.exitListener(code);
  }
}

class FakeFactory implements PtyFactory {
  readonly spawned: FakePty[] = [];
  readonly options: PtyOptions[] = [];
  fail = false;

  defaultShell(): string {
    return '/bin/sh';
  }
  spawn(options: PtyOptions): Pty {
    if (this.fail) throw new Error('sem shell');
    const pty = new FakePty();
    this.spawned.push(pty);
    this.options.push(options);
    return pty;
  }
  get last(): FakePty {
    return this.spawned[this.spawned.length - 1]!;
  }
}

describe('TerminalSession', () => {
  let factory: FakeFactory;
  let data: string[];
  let updates: TerminalSnapshot[];

  const session = (command?: string): TerminalSession => {
    const s = new TerminalSession('t1', { name: '', cwd: '/tmp/projeto', command }, factory, {
      onData: (_id, chunk) => data.push(chunk),
      onUpdate: (snapshot) => updates.push(snapshot),
    });
    s.start();
    return s;
  };
  const last = (): TerminalSnapshot => updates[updates.length - 1]!;

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
    factory = new FakeFactory();
    data = [];
    updates = [];
  });
  afterEach(() => mock.timers.reset());

  it('nome padrao vem do basename do cwd; shell padrao da fabrica', () => {
    const s = session();
    assert.equal(s.snapshot().name, 'projeto');
    assert.equal(s.snapshot().shell, '/bin/sh');
    assert.equal(factory.options[0]?.env.TERM, 'xterm-256color');
  });

  it('output -> running; silencio -> idle sem atencao enquanto nao armado', () => {
    session();
    factory.last.emit('$ ');
    assert.equal(last().status, 'running');
    mock.timers.tick(700);
    assert.equal(last().status, 'idle');
    assert.equal(last().needsAttention, false);
  });

  it('depois de digitar, ficar ocioso pede atencao; voltar a imprimir limpa', () => {
    const s = session();
    s.write('ls\r');
    factory.last.emit('a b c');
    mock.timers.tick(700);
    assert.equal(last().needsAttention, true);
    factory.last.emit('mais');
    assert.equal(last().needsAttention, false);
  });

  it('acknowledge limpa a atencao', () => {
    const s = session();
    s.write('x');
    factory.last.emit('y');
    mock.timers.tick(700);
    s.acknowledge();
    assert.equal(last().needsAttention, false);
  });

  it('comando inicial e digitado no primeiro output, uma vez so', () => {
    session('claude');
    assert.deepEqual(factory.last.written, []);
    factory.last.emit('$ ');
    factory.last.emit('mais');
    assert.deepEqual(factory.last.written, ['claude\r']);
  });

  it('pedido explicito vale sem armar e so some quando voce digita', () => {
    const s = session();
    factory.last.emit('\x1b]9;precisa de permissao\x07');
    assert.equal(last().notice, 'precisa de permissao');
    assert.equal(last().needsAttention, true);
    factory.last.emit('redesenho da TUI');
    assert.equal(last().notice, 'precisa de permissao');
    s.write('1');
    assert.equal(last().notice, null);
  });

  it('processo que sai pede atencao, com status pelo codigo', () => {
    session();
    factory.last.exit(0);
    assert.equal(last().status, 'exited');
    assert.equal(last().needsAttention, true);
  });

  it('codigo != 0 vira error', () => {
    session();
    factory.last.exit(2);
    assert.equal(last().status, 'error');
    assert.equal(last().exitCode, 2);
  });

  it('falha ao iniciar vira error com a mensagem no replay', () => {
    factory.fail = true;
    const s = session();
    assert.equal(last().status, 'error');
    assert.match(s.replayBuffer(), /sem shell/);
  });

  it('replay guarda o output recente', () => {
    const s = session();
    factory.last.emit('a');
    factory.last.emit('b');
    assert.equal(s.replayBuffer(), 'ab');
    assert.deepEqual(data, ['a', 'b']);
  });

  it('replay descarta os chunks mais antigos acima do limite', () => {
    const s = session();
    const big = 'x'.repeat(200 * 1024);
    factory.last.emit(big);
    factory.last.emit(big);
    assert.equal(s.replayBuffer(), big);
  });

  it('restart mata o pty, limpa o replay e sobe outro', () => {
    const s = session();
    const first = factory.last;
    first.emit('antes');
    s.restart();
    assert.ok(first.killed);
    first.exit(0);
    assert.equal(factory.spawned.length, 2);
    assert.equal(s.replayBuffer(), '');
    assert.notEqual(last().status, 'exited');
  });

  it('dispose: o exit tardio nao emite nada', () => {
    const s = session();
    const pty = factory.last;
    s.dispose();
    const before = updates.length;
    pty.exit(0);
    pty.emit('tarde demais');
    assert.equal(updates.length, before);
    assert.deepEqual(data, []);
  });

  it('rename ignora nome vazio ou igual', () => {
    const s = session();
    const before = updates.length;
    s.rename('  ');
    s.rename('projeto');
    assert.equal(updates.length, before);
    s.rename('api');
    assert.equal(last().name, 'api');
  });
});
