import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { busyProgram } from '../../domain/terminal/foreground.js';

describe('programa rodando no terminal', () => {
  it('so o shell: nada a perder', () => {
    assert.equal(busyProgram('bash', '/bin/bash'), null);
    assert.equal(busyProgram('-zsh', '/usr/bin/zsh'), null, 'login shell');
    assert.equal(busyProgram('/bin/bash', 'bash'), null);
    assert.equal(busyProgram('powershell', 'C:\\Windows\\powershell.exe'), null);
  });

  it('outro programa em foreground', () => {
    assert.equal(busyProgram('claude', '/bin/bash'), 'claude');
    assert.equal(busyProgram('/usr/bin/node', '/bin/zsh'), 'node');
  });

  it('sem informacao: nao pergunta', () => {
    assert.equal(busyProgram(null, '/bin/bash'), null);
    assert.equal(busyProgram('', '/bin/bash'), null);
  });
});
