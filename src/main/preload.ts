import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { TerminalSnapshot, TerminalSpec } from '../domain/terminal/types.js';
import type { UsageSummary } from '../domain/usage/types.js';
import type { NotePatch } from '../domain/notes/note.js';
import type { CanvasTextPatch } from '../domain/canvas/text.js';
import type { CanvasFramePatch } from '../domain/canvas/frame.js';
import type { TaskListPatch } from '../domain/tasks/task-list.js';
import type { CanvasRect, CanvasView, GridLayoutId, LayoutId, TrackSizes } from '../domain/workspace/layout.js';
import type { Settings } from '../domain/workspace/settings.js';
import { CHANNELS, type BootstrapState, type MultiTermApi, type TerminalOutput } from '../shared/contract.js';

/** Inscreve um canal e devolve a funcao de cancelamento. */
function subscribe<T extends unknown[]>(
  channel: string,
  listener: (...args: T) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as T));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const api: MultiTermApi = {
  bootstrap: () => ipcRenderer.invoke(CHANNELS.bootstrap) as Promise<BootstrapState>,
  pickDirectory: (startIn) => ipcRenderer.invoke(CHANNELS.pickDirectory, startIn),

  createTerminal: (spec: TerminalSpec, worktreeBranch?: string) =>
    ipcRenderer.invoke(CHANNELS.create, spec, worktreeBranch),
  closeTerminal: (id) => ipcRenderer.invoke(CHANNELS.close, id),
  restartTerminal: (id, cwd) => ipcRenderer.invoke(CHANNELS.restart, id, cwd),
  renameTerminal: (id, name) => ipcRenderer.invoke(CHANNELS.rename, id, name),
  setTerminalColor: (id, color) => ipcRenderer.invoke(CHANNELS.setColor, id, color),
  interruptTerminal: (id) => ipcRenderer.invoke(CHANNELS.interrupt, id),
  replayTerminal: (id) => ipcRenderer.invoke(CHANNELS.replay, id),

  acknowledgeTerminal: (id) => ipcRenderer.send(CHANNELS.acknowledge, id),
  writeTerminal: (id, data) => ipcRenderer.send(CHANNELS.write, id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send(CHANNELS.resize, id, cols, rows),
  setTerminalRect: (id, rect: CanvasRect | null) => ipcRenderer.send(CHANNELS.setRect, id, rect),
  gitInfo: (cwd) => ipcRenderer.invoke(CHANNELS.gitInfo, cwd),
  worktreeDirty: (worktree) => ipcRenderer.invoke(CHANNELS.worktreeDirty, worktree),
  removeWorktree: (worktree, force) => ipcRenderer.invoke(CHANNELS.worktreeRemove, worktree, force),
  saveTemplate: (input) => ipcRenderer.invoke(CHANNELS.templateSave, input),
  deleteTemplate: (id) => ipcRenderer.invoke(CHANNELS.templateDelete, id),
  restoreSession: () => ipcRenderer.invoke(CHANNELS.sessionRestore),
  discardSession: () => ipcRenderer.invoke(CHANNELS.sessionDiscard),
  setLayout: (layout: LayoutId) => ipcRenderer.send(CHANNELS.setLayout, layout),
  setLayoutSizes: (layout: GridLayoutId, sizes: TrackSizes) =>
    ipcRenderer.send(CHANNELS.setLayoutSizes, layout, sizes),
  setCanvasView: (view: CanvasView) => ipcRenderer.send(CHANNELS.setCanvasView, view),
  setSettings: (settings: Settings) => ipcRenderer.send(CHANNELS.setSettings, settings),

  createNote: () => ipcRenderer.invoke(CHANNELS.noteCreate),
  updateNote: (id: string, patch: NotePatch) => ipcRenderer.send(CHANNELS.noteUpdate, id, patch),
  deleteNote: (id: string) => ipcRenderer.invoke(CHANNELS.noteDelete, id),

  createTaskList: () => ipcRenderer.invoke(CHANNELS.taskListCreate),
  updateTaskList: (id: string, patch: TaskListPatch) => ipcRenderer.send(CHANNELS.taskListUpdate, id, patch),
  deleteTaskList: (id: string) => ipcRenderer.invoke(CHANNELS.taskListDelete, id),

  createText: (x: number, y: number) => ipcRenderer.invoke(CHANNELS.textCreate, x, y),
  updateText: (id: string, patch: CanvasTextPatch) => ipcRenderer.send(CHANNELS.textUpdate, id, patch),
  deleteText: (id: string) => ipcRenderer.invoke(CHANNELS.textDelete, id),

  createFrame: (rect: CanvasRect) => ipcRenderer.invoke(CHANNELS.frameCreate, rect),
  updateFrame: (id: string, patch: CanvasFramePatch) => ipcRenderer.send(CHANNELS.frameUpdate, id, patch),
  deleteFrame: (id: string) => ipcRenderer.invoke(CHANNELS.frameDelete, id),

  getUsage: () => ipcRenderer.invoke(CHANNELS.usageGet) as Promise<UsageSummary>,
  refreshUsage: () => ipcRenderer.send(CHANNELS.usageRefresh),

  onTerminalData: (listener) => subscribe<[TerminalOutput[]]>(CHANNELS.data, listener),
  onTerminalUpdate: (listener) => subscribe<[TerminalSnapshot]>(CHANNELS.update, listener),
  onTerminalClose: (listener) => subscribe<[string]>(CHANNELS.closed, listener),
  onUsageUpdate: (listener) => subscribe<[UsageSummary]>(CHANNELS.usageUpdate, listener),
};

contextBridge.exposeInMainWorld('multiterm', api);
