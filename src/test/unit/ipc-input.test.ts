import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTerminalSize, parseTerminalSpec } from '../../domain/terminal/spec.js';
import { isSafeExternalUrl } from '../../domain/url.js';

describe('links externos', () => {
  it('aceita so http, https e mailto', () => {
    for (const url of ['https://example.com/a?b=1', 'http://localhost:3000', 'mailto:alguem@example.com']) {
      assert.equal(isSafeExternalUrl(url), true, url);
    }
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'about:blank', 'smb://host/share', 'vscode://x', '', 'lixo']) {
      assert.equal(isSafeExternalUrl(url), false, url);
    }
    assert.equal(isSafeExternalUrl(42), false);
  });
});

describe('spec de terminal vindo do renderer', () => {
  it('mantem os campos validos e descarta worktree e workspace', () => {
    const spec = parseTerminalSpec({
      name: 'api',
      cwd: '/proj',
      command: 'claude',
      color: 'blue',
      worktree: { path: '/outro' },
      workspaceId: 'qualquer',
    });
    assert.deepEqual(spec, { name: 'api', cwd: '/proj', command: 'claude', color: 'blue', claudeSession: null });
  });

  it('nome ausente vira vazio; cor invalida vira null', () => {
    assert.deepEqual(parseTerminalSpec({ cwd: '/p', color: 'rosa' }), {
      name: '',
      cwd: '/p',
      color: null,
      claudeSession: null,
    });
  });

  it('recusa tipos errados e tamanhos absurdos', () => {
    assert.equal(parseTerminalSpec(null), null);
    assert.equal(parseTerminalSpec('x'), null);
    assert.equal(parseTerminalSpec({ name: 'a' }), null);
    assert.equal(parseTerminalSpec({ name: 1, cwd: '/p' }), null);
    assert.equal(parseTerminalSpec({ cwd: '/p', shell: ['/bin/sh'] }), null);
    assert.equal(parseTerminalSpec({ cwd: '/p', command: 'x'.repeat(5000) }), null);
    assert.equal(parseTerminalSpec({ cwd: '/p', claudeSession: 7 }), null);
  });
});

describe('tamanho de terminal', () => {
  it('inteiros entre 1 e 1000', () => {
    assert.deepEqual(parseTerminalSize(80, 24), { cols: 80, rows: 24 });
    assert.equal(parseTerminalSize(0, 24), null);
    assert.equal(parseTerminalSize(80, 1001), null);
    assert.equal(parseTerminalSize(80.5, 24), null);
    assert.equal(parseTerminalSize(Number.NaN, 24), null);
    assert.equal(parseTerminalSize('80', 24), null);
  });
});
