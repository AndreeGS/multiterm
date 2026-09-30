import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { TerminalSnapshot, TerminalSpec } from '../domain/terminal/types.js';
import type { UsageSummary } from '../domain/usage/types.js';
import type { NotePatch } from '../domain/notes/note.js';
import type { CanvasRect, CanvasView, GridLayoutId, LayoutId, TrackSizes } from '../domain/workspace/layout.js';
import { CHANNELS, type BootstrapState, type MultiTermApi } from '../shared/contract.js';

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

  createTerminal: (spec: TerminalSpec) => ipcRenderer.invoke(CHANNELS.create, spec),
  closeTerminal: (id) => ipcRenderer.invoke(CHANNELS.close, id),
  restartTerminal: (id, cwd) => ipcRenderer.invoke(CHANNELS.restart, id, cwd),
  renameTerminal: (id, name) => ipcRenderer.invoke(CHANNELS.rename, id, name),
  interruptTerminal: (id) => ipcRenderer.invoke(CHANNELS.interrupt, id),
  replayTerminal: (id) => ipcRenderer.invoke(CHANNELS.replay, id),

  acknowledgeTerminal: (id) => ipcRenderer.send(CHANNELS.acknowledge, id),
  writeTerminal: (id, data) => ipcRenderer.send(CHANNELS.write, id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send(CHANNELS.resize, id, cols, rows),
  setTerminalRect: (id, rect: CanvasRect | null) => ipcRenderer.send(CHANNELS.setRect, id, rect),
  restoreSession: () => ipcRenderer.invoke(CHANNELS.sessionRestore),
  discardSession: () => ipcRenderer.invoke(CHANNELS.sessionDiscard),
  setLayout: (layout: LayoutId) => ipcRenderer.send(CHANNELS.setLayout, layout),
  setLayoutSizes: (layout: GridLayoutId, sizes: TrackSizes) =>
    ipcRenderer.send(CHANNELS.setLayoutSizes, layout, sizes),
  setCanvasView: (view: CanvasView) => ipcRenderer.send(CHANNELS.setCanvasView, view),

  createNote: () => ipcRenderer.invoke(CHANNELS.noteCreate),
  updateNote: (id: string, patch: NotePatch) => ipcRenderer.send(CHANNELS.noteUpdate, id, patch),
  deleteNote: (id: string) => ipcRenderer.invoke(CHANNELS.noteDelete, id),

  getUsage: () => ipcRenderer.invoke(CHANNELS.usageGet) as Promise<UsageSummary>,
  refreshUsage: () => ipcRenderer.send(CHANNELS.usageRefresh),

  onTerminalData: (listener) => subscribe<[string, string]>(CHANNELS.data, listener),
  onTerminalUpdate: (listener) => subscribe<[TerminalSnapshot]>(CHANNELS.update, listener),
  onTerminalClose: (listener) => subscribe<[string]>(CHANNELS.closed, listener),
  onUsageUpdate: (listener) => subscribe<[UsageSummary]>(CHANNELS.usageUpdate, listener),
};

contextBridge.exposeInMainWorld('multiterm', api);
