import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeProjectKey } from '../../domain/terminal/command.js';

/** `~/.claude/projects` (ou `$CLAUDE_CONFIG_DIR/projects`): onde ficam as conversas. */
export function claudeProjectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  return join(base, 'projects');
}

/** Ha conversa salva para este diretorio (o `--continue` tem o que retomar)? */
export function hasProjectConversations(cwd: string, projectsDir = claudeProjectsDir()): boolean {
  return existsSync(join(projectsDir, claudeProjectKey(cwd)));
}

/**
 * A conversa com este id ja foi gravada? Procura em todos os projetos: o
 * diretorio onde o `claude` rodou pode nao ser o cwd do terminal, e o nome da
 * pasta e uma codificacao do caminho que o Claude Code pode mudar.
 */
export function hasClaudeTranscript(sessionId: string, projectsDir = claudeProjectsDir()): boolean {
  let projects: string[];
  try {
    projects = readdirSync(projectsDir);
  } catch {
    return false;
  }
  return projects.some((project) => existsSync(join(projectsDir, project, `${sessionId}.jsonl`)));
}
