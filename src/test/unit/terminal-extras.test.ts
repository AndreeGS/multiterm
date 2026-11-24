import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { quotePath } from '../../domain/terminal/agent.js';
import type { Pty, PtyFactory } from '../../domain/terminal/pty.js';
import { TerminalSession } from '../../domain/terminal/session.js';
import { parseOsc7 } from '../../domain/terminal/shell-integration.js';
import { SignalScanner } from '../../domain/terminal/signals.js';
import type { TerminalSnapshot } from '../../domain/terminal/types.js';
import { cleanFontFamily, DEFAULT_FONT_FAMILY, parseSettings } from '../../domain/workspace/settings.js';
import { MAX_SCROLLBACK_BYTES, ScrollbackStore, trimStart } from '../../infrastructure/persistence/scrollback-store.js';

describe('OSC 7 (diretorio atual)', () => {
  it('parseOsc7: host local, %XX decodificado, so caminho absoluto', () => {
    assert.equal(parseOsc7('file://maq/home/a/dir%20com%20espaco%25x', 'maq'), '/home/a/dir com espaco%x');
    assert.equal(parseOsc7('file:///tmp', 'maq'), '/tmp');
    assert.equal(parseOsc7('file://localhost/tmp', 'maq'), '/tmp');
    assert.equal(parseOsc7('file://MAQ/tmp', 'maq.local'), '/tmp');
    // Dentro de um ssh: caminho de outra maquina.
    assert.equal(parseOsc7('file://servidor/srv/app', 'maq'), null);
    assert.equal(parseOsc7('http://maq/tmp', 'maq'), null);
    assert.equal(parseOsc7('file://maq/%E0%A4%A', 'maq'), null);
  });

  it('scanner guarda o ultimo diretorio, mesmo partido entre chunks', () => {
    const scanner = new SignalScanner('maq');
    assert.equal(scanner.scan('\x1b]7;file://maq/tm'), null);
    scanner.scan('p\x07\x1b]7;file://maq/home\x1b\\');
    assert.equal(scanner.takeCwd(), '/home');
    assert.equal(scanner.takeCwd(), null);
  });
});

class FakePty implements Pty {
  readonly pid = 1;
  readonly process = 'bash';
  private listener: (chunk: string) => void = () => {};
  write(): void {}
  pause(): void {}
  resume(): void {}
  resize(): void {}
  kill(): void {}
  onData(listener: (chunk: string) => void): void {
    this.listener = listener;
  }
  onExit(): void {}
  emit(chunk: string): void {
    this.listener(chunk);
  }
}

describe('TerminalSession segue o diretorio do shell', () => {
  // O scanner usa o hostname da maquina: o teste usa o mesmo.
  const host = hostname;
  const make = (command?: string) => {
    let pty!: FakePty;
    const updates: TerminalSnapshot[] = [];
    const factory: PtyFactory = { defaultShell: () => '/bin/bash', spawn: () => (pty = new FakePty()) };
    const session = new TerminalSession('t', { name: 'a', cwd: '/inicio', command }, factory, {
      onData: () => {},
      onUpdate: (snapshot) => updates.push(snapshot),
    });
    session.start();
    return { session, pty, updates };
  };

  it('cd no shell muda o cwd do terminal (restart e restore abrem ali)', () => {
    const { session, pty } = make();
    pty.emit(`\x1b]7;file://${host()}/tmp/outro\x07$ `);
    assert.equal(session.snapshot().cwd, '/tmp/outro');
  });

  it('terminal do Claude fica no diretorio em que abriu', () => {
    const { session, pty } = make('claude');
    pty.emit(`\x1b]7;file://${host()}/tmp/outro\x07$ `);
    assert.equal(session.snapshot().cwd, '/inicio');
  });
});

describe('arrastar arquivo', () => {
  it('quotePath: aspas so quando precisa', () => {
    assert.equal(quotePath('/home/a/b-c_d.txt'), '/home/a/b-c_d.txt');
    assert.equal(quotePath('/home/a/meu arquivo.txt'), "'/home/a/meu arquivo.txt'");
    assert.equal(quotePath("/tmp/it's"), "'/tmp/it'\\''s'");
    assert.equal(quotePath('/tmp/$(rm)'), "'/tmp/$(rm)'");
  });
});

describe('configuracoes do terminal', () => {
  it('padroes e limites', () => {
    const base = parseSettings({});
    assert.equal(base.fontFamily, DEFAULT_FONT_FAMILY);
    assert.equal(base.cursorStyle, 'block');
    assert.equal(base.cursorBlink, true);
    assert.equal(base.scrollback, 10_000);
    const custom = parseSettings({ fontFamily: '"Iosevka", monospace', cursorStyle: 'bar', cursorBlink: false, scrollback: 999_999 });
    assert.equal(custom.fontFamily, '"Iosevka", monospace');
    assert.equal(custom.cursorStyle, 'bar');
    assert.equal(custom.cursorBlink, false);
    assert.equal(custom.scrollback, 100_000);
    assert.equal(parseSettings({ cursorStyle: 'grande', scrollback: 10 }).cursorStyle, 'block');
    assert.equal(parseSettings({ scrollback: 10 }).scrollback, 1000);
  });

  it('fonte sem nada que vire outra declaracao CSS', () => {
    assert.equal(cleanFontFamily('  '), DEFAULT_FONT_FAMILY);
    assert.equal(cleanFontFamily('mono; color: red'), DEFAULT_FONT_FAMILY);
    assert.equal(cleanFontFamily('x}'), DEFAULT_FONT_FAMILY);
    assert.equal(cleanFontFamily('Fira Code'), 'Fira Code');
  });
});

describe('ScrollbackStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'multiterm-sb-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('salva so para o usuario, le, apaga e poda', () => {
    const store = new ScrollbackStore(dir);
    assert.ok(store.save('a1', '\x1b[31mola\x1b[0m'));
    assert.equal(store.load('a1'), '\x1b[31mola\x1b[0m');
    assert.equal(statSync(join(dir, 'scrollback', 'a1.txt')).mode & 0o777, 0o600);
    assert.equal(store.save('../fora', 'x'), false);
    assert.equal(store.load('../fora'), null);
    store.save('b2', 'b');
    store.prune(new Set(['b2']));
    assert.deepEqual(readdirSync(join(dir, 'scrollback')), ['b2.txt']);
    store.remove('b2');
    assert.equal(store.load('b2'), null);
  });

  it('acima do limite fica o fim, a partir de uma linha inteira', () => {
    const text = Array.from({ length: 50 }, (_, i) => `linha ${i}`).join('\r\n');
    const trimmed = trimStart(text, 100);
    assert.ok(Buffer.byteLength(trimmed) <= 100 + 4);
    assert.ok(trimmed.startsWith('\x1b[0mlinha '));
    assert.ok(trimmed.endsWith('linha 49'));
    assert.equal(trimStart('curto'), 'curto');
    assert.ok(MAX_SCROLLBACK_BYTES >= 1024 * 1024);
  });
});
