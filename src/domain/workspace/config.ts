import { cleanCommand, parseSessionId } from '../terminal/command.js';
import { isLayout, parseCanvasRect, parseCanvasView, type CanvasRect } from './layout.js';
import { parseWorktreeInfo, type WorktreeInfo } from '../git/worktree.js';
import { parsePaneColor, type PaneColor } from './colors.js';
import { defaultSettings, parseSettings, type Settings } from './settings.js';
import { parseTemplates, type TerminalTemplate } from './template.js';
import {
  createWorkspace,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  MAX_WORKSPACES,
  parseLayoutSizes,
  parseWorkspace,
  parseWorkspaceId,
  type Workspace,
} from './workspace.js';

export type { LayoutSizes } from './workspace.js';

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

/**
 * Terminal aberto no encerramento. O processo nao sobrevive; na proxima
 * abertura sobe um shell novo com o mesmo nome, diretorio e posicao.
 */
export interface SavedTerminal {
  /** Reusado ao restaurar: e por ele que notas e listas se vinculam. */
  id?: string;
  name: string;
  cwd: string;
  shell?: string;
  /** Comando inicial (ex.: `claude`); ausente = so o shell. */
  command?: string;
  /** Cor de destaque; ausente = sem cor. */
  color?: PaneColor;
  /** Conversa do Claude Code do terminal: restaurar retoma exatamente ela. */
  claudeSession?: string;
  /** Worktree do terminal; restaurar volta para ele, se a pasta ainda existir. */
  worktree?: WorktreeInfo;
  /** Workspace a que o terminal pertence. */
  workspaceId: string;
  rect: CanvasRect | null;
}

export interface AppConfig {
  window: WindowBounds;
  /** Nunca vazio. Layout, proporcoes e vista ficam em cada um. */
  workspaces: Workspace[];
  /** Id de um dos `workspaces`. */
  activeWorkspace: string;
  /** Diretorios usados recentemente, mais recente primeiro. */
  recentDirs: string[];
  /** Comandos iniciais usados recentemente, mais recente primeiro. */
  recentCommands: string[];
  /** Terminais para reabrir, na ordem de criacao. */
  terminals: SavedTerminal[];
  /** Tema e tamanhos de fonte. */
  settings: Settings;
  /** Terminais prontos para abrir com um clique. */
  templates: TerminalTemplate[];
}

export const MAX_RECENT_DIRS = 12;
export const MAX_RECENT_COMMANDS = 8;

export function defaultConfig(): AppConfig {
  return {
    window: { width: 1400, height: 900 },
    workspaces: [defaultWorkspace()],
    activeWorkspace: DEFAULT_WORKSPACE_ID,
    recentDirs: [],
    recentCommands: [],
    terminals: [],
    settings: defaultSettings(),
    templates: [],
  };
}

/** Normaliza conteudo vindo do disco: qualquer campo invalido cai no padrao. */
export function parseConfig(raw: unknown): AppConfig {
  const base = defaultConfig();
  if (typeof raw !== 'object' || raw === null) return base;
  const input = raw as Record<string, unknown>;

  const window = input.window as Record<string, unknown> | undefined;
  if (window && typeof window === 'object') {
    if (isFinitePositive(window.width)) base.window.width = window.width;
    if (isFinitePositive(window.height)) base.window.height = window.height;
    if (Number.isFinite(window.x)) base.window.x = window.x as number;
    if (Number.isFinite(window.y)) base.window.y = window.y as number;
  }

  base.workspaces = parseWorkspaces(input);
  base.activeWorkspace = base.workspaces.some((w) => w.id === input.activeWorkspace)
    ? (input.activeWorkspace as string)
    : base.workspaces[0]!.id;

  if (Array.isArray(input.recentDirs)) {
    base.recentDirs = input.recentDirs
      .filter((dir): dir is string => typeof dir === 'string' && dir.length > 0)
      .slice(0, MAX_RECENT_DIRS);
  }

  if (Array.isArray(input.recentCommands)) {
    base.recentCommands = input.recentCommands
      .map(cleanCommand)
      .filter((command) => command.length > 0)
      .slice(0, MAX_RECENT_COMMANDS);
  }

  if (Array.isArray(input.terminals)) {
    base.terminals = input.terminals
      .map(parseSavedTerminal)
      .filter((t): t is SavedTerminal => t !== null);
  }

  base.settings = parseSettings(input.settings);
  base.templates = parseTemplates(input.templates);

  return base;
}

function parseSavedTerminal(raw: unknown): SavedTerminal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.cwd !== 'string' || !input.cwd) return null;
  const saved: SavedTerminal = {
    ...(typeof input.id === 'string' && input.id ? { id: input.id } : {}),
    name: typeof input.name === 'string' ? input.name : '',
    cwd: input.cwd,
    workspaceId: parseWorkspaceId(input.workspaceId),
    rect: parseCanvasRect(input.rect),
  };
  if (typeof input.shell === 'string' && input.shell) saved.shell = input.shell;
  const command = cleanCommand(input.command);
  if (command) saved.command = command;
  const color = parsePaneColor(input.color);
  if (color) saved.color = color;
  const claudeSession = parseSessionId(input.claudeSession);
  if (claudeSession) saved.claudeSession = claudeSession;
  const worktree = parseWorktreeInfo(input.worktree);
  if (worktree) saved.worktree = worktree;
  return saved;
}

export function withRecentCommand(config: AppConfig, command: string): AppConfig {
  const recentCommands = [command, ...config.recentCommands.filter((c) => c !== command)]
    .slice(0, MAX_RECENT_COMMANDS);
  return { ...config, recentCommands };
}

export function withRecentDir(config: AppConfig, dir: string): AppConfig {
  const recentDirs = [dir, ...config.recentDirs.filter((d) => d !== dir)].slice(0, MAX_RECENT_DIRS);
  return { ...config, recentDirs };
}

function defaultWorkspace(): Workspace {
  return createWorkspace(DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME);
}

/**
 * Config de antes dos workspaces tem layout, proporcoes e vista no topo: eles
 * viram o workspace padrao, onde tambem caem todos os terminais e notas antigos.
 */
function parseWorkspaces(input: Record<string, unknown>): Workspace[] {
  const seen = new Set<string>();
  const workspaces: Workspace[] = [];
  for (const raw of Array.isArray(input.workspaces) ? input.workspaces : []) {
    const workspace = parseWorkspace(raw);
    if (!workspace || seen.has(workspace.id)) continue;
    seen.add(workspace.id);
    workspaces.push(workspace);
    if (workspaces.length === MAX_WORKSPACES) break;
  }
  if (workspaces.length > 0) return workspaces;
  return [{
    ...defaultWorkspace(),
    ...(isLayout(input.layout) ? { layout: input.layout } : {}),
    layoutSizes: parseLayoutSizes(input.layoutSizes),
    canvasView: parseCanvasView(input.canvasView),
  }];
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
