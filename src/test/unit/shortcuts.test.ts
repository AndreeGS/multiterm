import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchShortcut } from '../../renderer/shortcuts.js';

/** So o que o matchShortcut le de um KeyboardEvent. */
function key(init: { key: string; code?: string; ctrl?: boolean; shift?: boolean; alt?: boolean }): KeyboardEvent {
  return {
    type: 'keydown',
    key: init.key,
    code: init.code ?? '',
    ctrlKey: init.ctrl ?? false,
    shiftKey: init.shift ?? false,
    altKey: init.alt ?? false,
    metaKey: false,
  } as KeyboardEvent;
}

describe('atalhos globais', () => {
  it('F2 renomeia o painel, so sem modificador', () => {
    assert.deepEqual(matchShortcut(key({ key: 'F2' }), true), { kind: 'rename-pane' });
    assert.deepEqual(matchShortcut(key({ key: 'F2' }), false), { kind: 'rename-pane' });
    assert.equal(matchShortcut(key({ key: 'F2', ctrl: true }), false), null);
    assert.equal(matchShortcut(key({ key: 'F2', shift: true }), false), null);
  });

  it('Ctrl+T so fora do terminal; Ctrl+Shift+T sempre', () => {
    assert.deepEqual(matchShortcut(key({ key: 't', code: 'KeyT', ctrl: true }), false), { kind: 'new-terminal' });
    assert.equal(matchShortcut(key({ key: 't', code: 'KeyT', ctrl: true }), true), null);
    assert.deepEqual(matchShortcut(key({ key: 'T', code: 'KeyT', ctrl: true, shift: true }), true), { kind: 'new-terminal' });
  });

  it('Alt+N vai ao painel N', () => {
    assert.deepEqual(matchShortcut(key({ key: '3', code: 'Digit3', alt: true }), true), { kind: 'focus-index', index: 2 });
  });
});
