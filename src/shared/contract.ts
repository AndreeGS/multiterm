/**
 * Contrato entre main e renderer. Compartilhado pelos tres bundles
 * (main, preload, renderer) para manter o IPC tipado em um lugar so.
 */
import type { ReplaySnapshot, TerminalSnapshot, TerminalSpec } from '../domain/terminal/types.js';
import type { UsageSummary } from '../domain/usage/types.js';
import type { Note, NotePatch } from '../domain/notes/note.js';
import type { CanvasText, CanvasTextPatch } from '../domain/canvas/text.js';
import type { CanvasFrame, CanvasFramePatch } from '../domain/canvas/frame.js';
import type { TaskList, TaskListPatch } from '../domain/tasks/task-list.js';
import type { LayoutSizes, SavedTerminal } from '../domain/workspace/config.js';
import type { CanvasRect, CanvasView, GridLayoutId, LayoutId, TrackSizes } from '../domain/workspace/layout.js';
import type { Settings } from '../domain/workspace/settings.js';
import type { PaneColor } from '../domain/workspace/colors.js';
import type { TemplateInput, TerminalTemplate } from '../domain/workspace/template.js';
import type { GitInfo, WorktreeInfo } from '../domain/git/worktree.js';

export interface BootstrapState {
  readonly layout: LayoutId;
  readonly layoutSizes: LayoutSizes;
  readonly notes: Note[];
  readonly taskLists: TaskList[];
  /** Textos soltos da area livre. */
  readonly texts: CanvasText[];
  /** Molduras (grupos) da area livre. */
  readonly frames: CanvasFrame[];
  readonly recentDirs: string[];
  /** Comandos iniciais usados recentemente, mais recente primeiro. */
  readonly recentCommands: string[];
  readonly templates: TerminalTemplate[];
  readonly terminals: TerminalSnapshot[];
  /** Posicao de cada terminal na area livre, por id. */
  readonly terminalRects: Record<string, CanvasRect>;
  readonly canvasView: CanvasView | null;
  readonly settings: Settings;
  /** Terminais da sessao anterior, esperando o usuario restaurar ou descartar. */
  readonly pendingSession: SavedTerminal[];
  readonly defaultDir: string;
  readonly homeDir: string;
  readonly configPath: string;
}

export interface RestoredSession {
  readonly terminals: TerminalSnapshot[];
  readonly terminalRects: Record<string, CanvasRect>;
}

export interface MultiTermApi {
  bootstrap(): Promise<BootstrapState>;
  /** Abre o seletor de diretorio nativo. `null` se cancelado. */
  pickDirectory(startIn?: string): Promise<string | null>;

  /**
   * Com `worktreeBranch`, o main cria (ou reaproveita) um worktree com essa
   * branch e o terminal abre nele. Rejeita com a mensagem do git se falhar.
   */
  createTerminal(spec: TerminalSpec, worktreeBranch?: string): Promise<TerminalSnapshot>;
  closeTerminal(id: string): Promise<void>;
  restartTerminal(id: string, cwd?: string): Promise<void>;
  renameTerminal(id: string, name: string): Promise<void>;
  setTerminalColor(id: string, color: PaneColor | null): Promise<void>;
  interruptTerminal(id: string): Promise<void>;
  /** Marca que voce ja viu este terminal (limpa o pedido de atencao). */
  acknowledgeTerminal(id: string): void;
  writeTerminal(id: string, data: string): void;
  resizeTerminal(id: string, cols: number, rows: number): void;
  /** Output retido, para preencher o xterm ao anexar. */
  replayTerminal(id: string): Promise<ReplaySnapshot>;
  /** Persiste a posicao do terminal na area livre. */
  setTerminalRect(id: string, rect: CanvasRect | null): void;

  /** Repo e branch do diretorio (para oferecer o worktree no dialogo). */
  gitInfo(cwd: string): Promise<GitInfo>;
  /** O worktree tem mudancas nao commitadas? */
  worktreeDirty(worktree: WorktreeInfo): Promise<boolean>;
  /** Apaga a pasta do worktree (a branch fica). `force` descarta mudancas. */
  removeWorktree(worktree: WorktreeInfo, force: boolean): Promise<void>;

  /** Salva (ou substitui, pelo nome) um template; devolve a lista atualizada. */
  saveTemplate(input: TemplateInput): Promise<TerminalTemplate[]>;
  deleteTemplate(id: string): Promise<TerminalTemplate[]>;

  /** Sobe de novo os terminais da sessao anterior, nas mesmas posicoes. */
  restoreSession(): Promise<RestoredSession>;
  discardSession(): Promise<void>;

  setLayout(layout: LayoutId): void;
  /** Persiste as proporcoes de uma grade depois de arrastar um divisor. */
  setLayoutSizes(layout: GridLayoutId, sizes: TrackSizes): void;
  /** Persiste pan/zoom da area livre (o main agrupa as escritas). */
  setCanvasView(view: CanvasView): void;
  /** Persiste tema e tamanhos de fonte (o renderer ja aplicou). */
  setSettings(settings: Settings): void;

  createNote(): Promise<Note>;
  /** Fire-and-forget: chamado a cada tecla; o main agrupa as escritas. */
  updateNote(id: string, patch: NotePatch): void;
  deleteNote(id: string): Promise<void>;

  createTaskList(): Promise<TaskList>;
  /** Fire-and-forget, como as notas. */
  updateTaskList(id: string, patch: TaskListPatch): void;
  deleteTaskList(id: string): Promise<void>;

  /** Cria um texto vazio na area livre, na posicao do mundo dada. */
  createText(x: number, y: number): Promise<CanvasText>;
  /** Fire-and-forget, como as notas. */
  updateText(id: string, patch: CanvasTextPatch): void;
  deleteText(id: string): Promise<void>;

  /** Cria uma moldura na area livre, no retangulo do mundo dado. */
  createFrame(rect: CanvasRect): Promise<CanvasFrame>;
  /** Fire-and-forget, como os textos. */
  updateFrame(id: string, patch: CanvasFramePatch): void;
  deleteFrame(id: string): Promise<void>;

  /** Consumo local de tokens (nao e percentual do limite do plano). */
  getUsage(): Promise<UsageSummary>;
  refreshUsage(): void;

  /** Output de todos os terminais, agrupado a cada ~16ms: `[id, data, seq]`. */
  onTerminalData(listener: (batch: TerminalOutput[]) => void): () => void;
  onTerminalUpdate(listener: (snapshot: TerminalSnapshot) => void): () => void;
  onTerminalClose(listener: (id: string) => void): () => void;
  onUsageUpdate(listener: (summary: UsageSummary) => void): () => void;
}

/** Output de um terminal num lote; `seq` e o do ultimo chunk incluido. */
export type TerminalOutput = readonly [id: string, data: string, seq: number];

export const CHANNELS = {
  bootstrap: 'app:bootstrap',
  pickDirectory: 'app:pick-directory',
  setLayout: 'workspace:set-layout',
  setLayoutSizes: 'workspace:set-layout-sizes',
  setCanvasView: 'workspace:set-canvas-view',
  setSettings: 'workspace:set-settings',
  sessionRestore: 'session:restore',
  sessionDiscard: 'session:discard',

  noteCreate: 'note:create',
  noteUpdate: 'note:update',
  noteDelete: 'note:delete',

  taskListCreate: 'tasks:create',
  taskListUpdate: 'tasks:update',
  taskListDelete: 'tasks:delete',

  textCreate: 'text:create',
  textUpdate: 'text:update',
  textDelete: 'text:delete',

  frameCreate: 'frame:create',
  frameUpdate: 'frame:update',
  frameDelete: 'frame:delete',

  gitInfo: 'git:info',
  worktreeDirty: 'git:worktree-dirty',
  worktreeRemove: 'git:worktree-remove',

  templateSave: 'template:save',
  templateDelete: 'template:delete',

  usageGet: 'usage:get',
  usageRefresh: 'usage:refresh',
  usageUpdate: 'usage:update',

  create: 'terminal:create',
  close: 'terminal:close',
  restart: 'terminal:restart',
  rename: 'terminal:rename',
  setColor: 'terminal:set-color',
  interrupt: 'terminal:interrupt',
  acknowledge: 'terminal:acknowledge',
  write: 'terminal:write',
  resize: 'terminal:resize',
  replay: 'terminal:replay',
  setRect: 'terminal:set-rect',

  data: 'terminal:data',
  update: 'terminal:update',
  closed: 'terminal:closed',
} as const;
