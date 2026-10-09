import { cleanCommand } from '../terminal/command.js';
import { parsePaneColor, type PaneColor } from './colors.js';

/**
 * Receita de terminal para abrir com um clique: diretorio, comando inicial,
 * nome e cor. Fica no config global, valendo para qualquer sessao.
 */
export interface TerminalTemplate {
  readonly id: string;
  readonly name: string;
  readonly cwd: string;
  /** Vazio = so o shell. */
  readonly command: string;
  readonly color: PaneColor | null;
}

/** O que o usuario preenche; o id vem de quem cria. */
export type TemplateInput = Omit<TerminalTemplate, 'id'>;

export const MAX_TEMPLATES = 20;
export const MAX_TEMPLATE_NAME = 60;

/** `null` se faltar nome ou diretorio — sem eles o template nao abre nada. */
export function parseTemplate(raw: unknown, id: string): TerminalTemplate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, MAX_TEMPLATE_NAME) : '';
  const cwd = typeof input.cwd === 'string' ? input.cwd.trim() : '';
  if (!name || !cwd) return null;
  return { id, name, cwd, command: cleanCommand(input.command), color: parsePaneColor(input.color) };
}

/** Lista vinda do config: invalidos e ids/nomes repetidos ficam de fora. */
export function parseTemplates(raw: unknown): TerminalTemplate[] {
  if (!Array.isArray(raw)) return [];
  const result: TerminalTemplate[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of raw) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !id || ids.has(id)) continue;
    const template = parseTemplate(item, id);
    if (!template || names.has(template.name)) continue;
    ids.add(id);
    names.add(template.name);
    result.push(template);
    if (result.length === MAX_TEMPLATES) break;
  }
  return result;
}

/**
 * Salva um template. O nome e a identidade para o usuario: salvar com um nome
 * que ja existe substitui aquele template (mantendo o id e a posicao).
 */
export function withTemplate(templates: readonly TerminalTemplate[], template: TerminalTemplate): TerminalTemplate[] {
  const index = templates.findIndex((t) => t.name === template.name);
  if (index >= 0) {
    const next = [...templates];
    next[index] = { ...template, id: templates[index]!.id };
    return next;
  }
  return [...templates, template].slice(-MAX_TEMPLATES);
}
