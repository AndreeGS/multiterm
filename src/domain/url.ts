/**
 * Esquemas que podem ser entregues ao sistema (`shell.openExternal`). Qualquer
 * outro (`file:`, `smb:`, handlers de apps instalados) abriria arquivos ou
 * programas locais a partir de um link clicado num terminal.
 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function isSafeExternalUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  try {
    return SAFE_PROTOCOLS.has(new URL(raw).protocol);
  } catch {
    return false;
  }
}
