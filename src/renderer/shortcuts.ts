/**
 * Atalhos globais do app. Ficam num lugar so porque dois lados precisam
 * concordar: o App executa a acao, e o terminal precisa deixar de mandar a
 * tecla para o shell (senao `Ctrl+Shift+N` abriria uma nota *e* chegaria ao
 * shell como `^N`).
 */
export type Shortcut =
  | { kind: 'new-terminal' }
  | { kind: 'new-note' }
  | { kind: 'new-task-list' }
  | { kind: 'close-pane' }
  | { kind: 'maximize-pane' }
  | { kind: 'settings' }
  | { kind: 'palette' }
  | { kind: 'next-attention' }
  | { kind: 'workspaces' }
  | { kind: 'focus-index'; index: number }
  | { kind: 'focus-step'; delta: 1 | -1 };

/**
 * Atalho correspondente ao evento, ou `null`. `Ctrl+T` sem Shift so conta
 * fora de um terminal: dentro dele pertence ao shell/agente.
 */
export function matchShortcut(event: KeyboardEvent, inTerminal: boolean): Shortcut | null {
  if (event.type !== 'keydown' || event.metaKey) return null;
  const { ctrlKey: ctrl, shiftKey: shift, altKey: alt } = event;

  // Alt+1..9: ir direto para o painel N (o numero aparece segurando Alt).
  if (alt && !ctrl && !shift && /^Digit[1-9]$/.test(event.code)) {
    return { kind: 'focus-index', index: Number(event.code.slice(5)) - 1 };
  }
  if (!ctrl || alt) return null;

  // Ctrl+PageUp/PageDown: painel anterior/seguinte, como abas do navegador.
  if (!shift && event.key === 'PageDown') return { kind: 'focus-step', delta: 1 };
  if (!shift && event.key === 'PageUp') return { kind: 'focus-step', delta: -1 };

  const key = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
  if (shift) {
    switch (key) {
      case 't': return { kind: 'new-terminal' };
      case 'n': return { kind: 'new-note' };
      case 'l': return { kind: 'new-task-list' };
      case 'w': return { kind: 'close-pane' };
      case 'm': return { kind: 'maximize-pane' };
      case 'p': return { kind: 'palette' };
      case 'a': return { kind: 'next-attention' };
      case 'o': return { kind: 'workspaces' };
      default: return null;
    }
  }
  if (key === 't' && !inTerminal) return { kind: 'new-terminal' };
  if (event.key === ',') return { kind: 'settings' };
  return null;
}
