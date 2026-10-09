import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { TerminalService } from '../../application/terminal/terminal-service.js';
import {
  claudeLaunchCommand,
  parseSessionId,
  sessionIdOf,
  wantsOwnSession,
  withContinue,
} from '../../domain/terminal/command.js';
import type { Pty, PtyFactory } from '../../domain/terminal/pty.js';
import { TerminalSession } from '../../domain/terminal/session.js';
import { parseUsageLine } from '../../domain/usage/transcript.js';
import { parseConfig } from '../../domain/workspace/config.js';
import { hasClaudeTranscript } from '../../infrastructure/usage/claude-paths.js';
import { ClaudeTranscriptReader } from '../../infrastructure/usage/claude-transcript-reader.js';

const ID = '0f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
const OTHER = '11111111-2222-4333-8444-555555555555';

describe('comando com conversa propria', () => {
  it('parseSessionId aceita so UUID', () => {
    assert.equal(parseSessionId(ID.toUpperCase()), ID);
    assert.equal(parseSessionId('abc'), null);
    assert.equal(parseSessionId(42), null);
  });

  it('sessionIdOf le --session-id, --resume e -r com id', () => {
    assert.equal(sessionIdOf(`claude --session-id ${ID}`), ID);
    assert.equal(sessionIdOf(`claude --resume=${ID} --model x`), ID);
    assert.equal(sessionIdOf(`claude -r ${ID}`), ID);
    assert.equal(sessionIdOf('claude --resume'), null);
    assert.equal(sessionIdOf('claude --continue'), null);
  });

  it('wantsOwnSession: so claude interativo que nao escolhe conversa', () => {
    assert.ok(wantsOwnSession('claude --model opus'));
    assert.ok(!wantsOwnSession('claude -c'));
    assert.ok(!wantsOwnSession('claude -p oi'));
    assert.ok(!wantsOwnSession('npm run dev'));
  });

  it('claudeLaunchCommand: cria a conversa na primeira vez, retoma depois', () => {
    assert.equal(claudeLaunchCommand('claude --model opus', ID, false), `claude --session-id ${ID} --model opus`);
    assert.equal(claudeLaunchCommand('claude', ID, true), `claude --resume ${ID}`);
  });

  it('withContinue continua igual', () => {
    assert.equal(withContinue('claude --model opus'), 'claude --continue --model opus');
  });

  it('config guarda o id da conversa, so se for UUID', () => {
    const config = parseConfig({ terminals: [{ cwd: '/a', claudeSession: ID }, { cwd: '/b', claudeSession: 'x' }] });
    assert.equal(config.terminals[0]?.claudeSession, ID);
    assert.equal('claudeSession' in config.terminals[1]!, false);
  });
});

/* ---------- sessao e servico com PTY falso ---------- */

class FakePty implements Pty {
  readonly pid = 1;
  readonly written: string[] = [];
  data: (chunk: string) => void = () => {};
  exit: (code: number) => void = () => {};
  write(data: string): void {
    this.written.push(data);
  }
  resize(): void {}
  kill(): void {}
  onData(listener: (chunk: string) => void): void {
    this.data = listener;
  }
  onExit(listener: (code: number) => void): void {
    this.exit = listener;
  }
}

class FakeFactory implements PtyFactory {
  readonly spawned: FakePty[] = [];
  defaultShell(): string {
    return '/bin/sh';
  }
  spawn(): Pty {
    const pty = new FakePty();
    this.spawned.push(pty);
    return pty;
  }
}

const noop = { onData: () => {}, onUpdate: () => {} };

describe('sessao com conversa do Claude', () => {
  it('digita --session-id na primeira vez e --resume depois que a conversa existe', () => {
    const factory = new FakeFactory();
    const recorded = new Set<string>();
    const session = new TerminalSession('t', { name: '', cwd: '/tmp', command: 'claude', claudeSession: ID }, factory, noop,
      (id) => recorded.has(id));
    session.start();
    factory.spawned[0]!.data('$ ');
    assert.deepEqual(factory.spawned[0]!.written, [`claude --session-id ${ID}\r`]);
    assert.equal(session.snapshot().command, 'claude');
    assert.equal(session.snapshot().claudeSession, ID);

    recorded.add(ID);
    session.restart();
    factory.spawned[0]!.exit(0);
    factory.spawned[1]!.data('$ ');
    assert.deepEqual(factory.spawned[1]!.written, [`claude --resume ${ID}\r`]);
    session.dispose();
  });

  it('comando que ja escolhe a conversa por id e so acompanhado', () => {
    const factory = new FakeFactory();
    const session = new TerminalSession('t', { name: '', cwd: '/tmp', command: `claude -r ${OTHER}`, claudeSession: ID }, factory, noop);
    session.start();
    factory.spawned[0]!.data('$ ');
    assert.deepEqual(factory.spawned[0]!.written, [`claude -r ${OTHER}\r`]);
    assert.equal(session.snapshot().claudeSession, OTHER);
    session.dispose();
  });

  it('servico gera uma conversa por terminal claude e reusa a salva', () => {
    const service = new TerminalService(new FakeFactory(), { onData: () => {}, onUpdate: () => {}, onClose: () => {} });
    const a = service.create({ name: '', cwd: tmpdir(), command: 'claude' });
    const b = service.create({ name: '', cwd: tmpdir(), command: 'claude' });
    const restored = service.create({ name: '', cwd: tmpdir(), command: 'claude', claudeSession: ID });
    const shell = service.create({ name: '', cwd: tmpdir(), command: 'npm run dev' });
    assert.ok(parseSessionId(a.claudeSession));
    assert.notEqual(a.claudeSession, b.claudeSession);
    assert.equal(restored.claudeSession, ID);
    assert.equal(shell.claudeSession, null);
    service.closeAll();
  });
});

/* ---------- transcricoes ---------- */

const line = (fields: Record<string, unknown>): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-09T12:00:00Z',
    requestId: 'req',
    sessionId: ID,
    message: {
      id: 'msg',
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 },
    },
    ...fields,
  });

describe('parseUsageLine', () => {
  it('le tokens, modelo, dia e conversa', () => {
    const record = parseUsageLine(line({}));
    assert.equal(record?.sessionId, ID);
    assert.equal(record?.key, 'msg:req');
    assert.equal(record?.model, 'claude-sonnet-4-6');
    assert.equal(record?.totals.inputTokens, 10);
    assert.equal(record?.totals.cacheWriteTokens, 30);
    assert.ok((record?.totals.costUsd ?? 0) > 0);
  });

  it('ignora o que nao e resposta com usage', () => {
    assert.equal(parseUsageLine(JSON.stringify({ type: 'user' })), null);
    assert.equal(parseUsageLine('{"type":"assistant","mess'), null);
    assert.equal(parseUsageLine(line({ timestamp: 'ontem' })), null);
  });
});

describe('ClaudeTranscriptReader', () => {
  const root = mkdtempSync(join(tmpdir(), 'multiterm-usage-'));
  after(() => rmSync(root, { recursive: true, force: true }));

  it('linha pela metade fica para a proxima passada; totais por conversa', async () => {
    const project = join(root, '-home-ana-proj');
    mkdirSync(project, { recursive: true });
    const file = join(project, `${ID}.jsonl`);
    const now = new Date().toISOString();
    const second = line({ timestamp: now, message: { id: 'm2', model: 'claude-sonnet-4-6', usage: { input_tokens: 5, output_tokens: 5 } } });
    writeFileSync(file, `${line({ timestamp: now })}\n${second.slice(0, 40)}`);

    const reader = new ClaudeTranscriptReader(root);
    await reader.refresh();
    assert.equal(reader.bySession.get(ID)?.requests, 1);

    appendFileSync(file, `${second.slice(40)}\n`);
    await reader.refresh();
    assert.equal(reader.bySession.get(ID)?.requests, 2);
    assert.equal(reader.bySession.get(ID)?.inputTokens, 15);
  });

  it('hasClaudeTranscript procura o id em qualquer projeto', () => {
    assert.ok(hasClaudeTranscript(ID, root));
    assert.ok(!hasClaudeTranscript(OTHER, root));
    assert.ok(!hasClaudeTranscript(ID, join(root, 'nao-existe')));
  });
});
