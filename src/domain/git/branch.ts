/** Regras de nome de branch, sem dependencia de Node: o renderer tambem usa. */

export const MAX_BRANCH_LENGTH = 100;

/**
 * Subconjunto das regras do `git check-ref-format --branch`, o bastante para
 * barrar no dialogo o que o git recusaria (ou o que viraria um caminho estranho).
 */
export function isValidBranchName(name: string): boolean {
  if (!name || name.length > MAX_BRANCH_LENGTH) return false;
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false;
  if (name.endsWith('.lock') || name === '@') return false;
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false;
  if (name.includes('..') || name.includes('//') || name.includes('@{')) return false;
  return name.split('/').every((part) => part.length > 0 && !part.startsWith('.'));
}

/** Sugestao de branch a partir do nome do terminal: `Agente Pagamentos` -> `agente-pagamentos`. */
export function suggestBranch(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-./]+|[-./]+$/g, '')
    .slice(0, 60);
  return isValidBranchName(slug) ? slug : '';
}
