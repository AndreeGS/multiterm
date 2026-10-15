/**
 * Programa rodando no terminal alem do proprio shell, a partir do nome do
 * processo em foreground do pty. `null` = so o shell (fechar nao perde nada).
 *
 * Login shells aparecem como `-bash`; o shell pode vir como caminho completo.
 */
export function busyProgram(foreground: string | null | undefined, shell: string): string | null {
  if (!foreground) return null;
  const name = baseName(foreground).replace(/^-/, '');
  if (!name || name === baseName(shell).replace(/\.exe$/i, '')) return null;
  return name;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
