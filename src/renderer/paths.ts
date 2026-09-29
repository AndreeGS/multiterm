let homeDir = '';

export function setHomeDir(dir: string): void {
  homeDir = dir;
}

/**
 * Caminho curto para cabecalhos estreitos: `~` no lugar do home e elisao do
 * meio, preservando o nome do projeto (que fica no fim). O caminho completo
 * continua disponivel no `title` do elemento.
 */
export function shortenPath(path: string, maxSegments = 3): string {
  const withHome = homeDir && path.startsWith(homeDir) ? `~${path.slice(homeDir.length)}` : path;
  const segments = withHome.split('/').filter(Boolean);
  if (segments.length <= maxSegments) return withHome;
  return `…/${segments.slice(-maxSegments).join('/')}`;
}
