import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TerminalService } from '../application/terminal/terminal-service.js';
import { NotesService } from '../application/notes/notes-service.js';
import { UsageService } from '../application/usage/usage-service.js';
import { WorkspaceService } from '../application/workspace/workspace-service.js';
import type { NotePatch } from '../domain/notes/note.js';
import type { TerminalSpec } from '../domain/terminal/types.js';
import type { SavedTerminal } from '../domain/workspace/config.js';
import {
  isGridLayout,
  isLayout,
  parseCanvasRect,
  parseCanvasView,
  parseTrackSizes,
  type CanvasRect,
} from '../domain/workspace/layout.js';
import { JsonConfigStore } from '../infrastructure/persistence/json-config-store.js';
import { JsonNotesStore } from '../infrastructure/persistence/json-notes-store.js';
import { NodePtyFactory } from '../infrastructure/terminal/node-pty-adapter.js';
import { CHANNELS, type BootstrapState, type RestoredSession } from '../shared/contract.js';
import { AttentionNotifier } from './attention.js';

let mainWindow: BrowserWindow | null = null;
let workspace: WorkspaceService;
let terminals: TerminalService;
let attention: AttentionNotifier;
let usage: UsageService;
let notes: NotesService;
/** Posicao de cada terminal na area livre. Vive aqui porque a sessao nao sabe de layout. */
const terminalRects = new Map<string, CanvasRect>();
/**
 * Terminais da sessao anterior que o usuario ainda nao restaurou nem
 * descartou. Continuam no config, para nao se perderem se o app fechar antes.
 */
let pendingSession: SavedTerminal[] = [];
/** Durante a restauracao a lista muda aos poucos: grava so no final. */
let restoring = false;

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function createWindow(): void {
  const { window } = workspace.current();

  mainWindow = new BrowserWindow({
    x: window.x,
    y: window.y,
    width: window.width,
    height: window.height,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0f1116',
    title: 'MultiTerm',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', persistBounds);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Links externos abrem no navegador, nunca dentro do app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function persistBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  const { x, y, width, height } = mainWindow.getNormalBounds();
  workspace.setWindowBounds({ x, y, width, height });
}

/** Espelha os terminais abertos no config, para reabri-los na proxima vez. */
function persistTerminals(): void {
  if (restoring) return;
  const live = terminals.list().map((snapshot) => ({
    name: snapshot.name,
    cwd: snapshot.cwd,
    shell: snapshot.shell,
    rect: terminalRects.get(snapshot.id) ?? null,
  }));
  workspace.setTerminals([...live, ...pendingSession]);
}

function restoreSession(): RestoredSession {
  const saved = pendingSession;
  const restored: RestoredSession = { terminals: [], terminalRects: {} };
  restoring = true;
  try {
    pendingSession = [];
    for (const entry of saved) {
      const snapshot = terminals.create({ name: entry.name, cwd: entry.cwd, shell: entry.shell });
      restored.terminals.push(snapshot);
      if (entry.rect) {
        terminalRects.set(snapshot.id, entry.rect);
        restored.terminalRects[snapshot.id] = entry.rect;
      }
    }
  } finally {
    restoring = false;
  }
  persistTerminals();
  return restored;
}

function registerIpc(): void {
  ipcMain.handle(CHANNELS.bootstrap, (): BootstrapState => {
    const config = workspace.current();
    return {
      layout: config.layout,
      layoutSizes: config.layoutSizes,
      notes: notes.list(),
      recentDirs: config.recentDirs,
      terminals: terminals.list(),
      terminalRects: Object.fromEntries(terminalRects),
      canvasView: config.canvasView,
      pendingSession,
      defaultDir: config.recentDirs[0] ?? homedir(),
      homeDir: homedir(),
      configPath: join(app.getPath('userData'), 'config.json'),
    };
  });

  ipcMain.handle(CHANNELS.sessionRestore, () => restoreSession());
  ipcMain.handle(CHANNELS.sessionDiscard, () => {
    pendingSession = [];
    persistTerminals();
  });

  ipcMain.handle(CHANNELS.pickDirectory, async (_event, startIn?: string) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Diretorio do projeto',
      defaultPath: startIn || workspace.current().recentDirs[0] || homedir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(CHANNELS.create, (_event, spec: TerminalSpec) => {
    const snapshot = terminals.create(spec);
    workspace.rememberDir(snapshot.cwd);
    persistTerminals();
    return snapshot;
  });

  ipcMain.handle(CHANNELS.close, (_event, id: string) => terminals.close(id));
  ipcMain.handle(CHANNELS.restart, (_event, id: string, cwd?: string) => {
    terminals.restart(id, cwd);
    if (cwd) workspace.rememberDir(cwd);
  });
  ipcMain.handle(CHANNELS.rename, (_event, id: string, name: string) => terminals.rename(id, name));
  ipcMain.on(CHANNELS.setRect, (_event, id: string, rect: unknown) => {
    const parsed = parseCanvasRect(rect);
    if (parsed) terminalRects.set(id, parsed);
    else terminalRects.delete(id);
    persistTerminals();
  });
  ipcMain.handle(CHANNELS.interrupt, (_event, id: string) => terminals.interrupt(id));
  ipcMain.handle(CHANNELS.replay, (_event, id: string) => terminals.replay(id));

  ipcMain.on(CHANNELS.acknowledge, (_event, id: string) => terminals.acknowledge(id));
  ipcMain.on(CHANNELS.write, (_event, id: string, data: string) => terminals.write(id, data));
  ipcMain.on(CHANNELS.resize, (_event, id: string, cols: number, rows: number) => {
    terminals.resize(id, { cols, rows });
  });
  ipcMain.handle(CHANNELS.usageGet, () => usage.current());
  ipcMain.on(CHANNELS.usageRefresh, () => void usage.refresh());
  ipcMain.on(CHANNELS.setLayout, (_event, layout: unknown) => {
    if (isLayout(layout)) workspace.setLayout(layout);
  });
  ipcMain.on(CHANNELS.setLayoutSizes, (_event, layout: unknown, sizes: unknown) => {
    if (!isGridLayout(layout)) return;
    const parsed = parseTrackSizes(layout, sizes);
    if (parsed) workspace.setLayoutSizes(layout, parsed);
  });
  ipcMain.on(CHANNELS.setCanvasView, (_event, view: unknown) => {
    const parsed = parseCanvasView(view);
    if (parsed) workspace.setCanvasView(parsed);
  });

  ipcMain.handle(CHANNELS.noteCreate, () => notes.create());
  ipcMain.on(CHANNELS.noteUpdate, (_event, id: string, patch: NotePatch) => {
    if (typeof patch === 'object' && patch !== null) notes.update(id, patch);
  });
  ipcMain.handle(CHANNELS.noteDelete, (_event, id: string) => notes.remove(id));
}

// Uma unica instancia: abrir de novo apenas foca a janela existente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    workspace = new WorkspaceService(new JsonConfigStore(app.getPath('userData')));
    notes = new NotesService(new JsonNotesStore(app.getPath('userData')));
    attention = new AttentionNotifier(() => mainWindow);
    terminals = new TerminalService(new NodePtyFactory(), {
      onData: (id, chunk) => send(CHANNELS.data, id, chunk),
      onUpdate: (snapshot) => {
        attention.observe(snapshot);
        send(CHANNELS.update, snapshot);
        // Renomear e reiniciar em outro diretorio chegam por aqui.
        persistTerminals();
      },
      onClose: (id) => {
        attention.forget(id);
        terminalRects.delete(id);
        persistTerminals();
        send(CHANNELS.closed, id);
      },
    });

    usage = new UsageService(undefined, (summary) => send(CHANNELS.usageUpdate, summary));

    pendingSession = workspace.current().terminals;
    registerIpc();
    createWindow();
    usage.start();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    persistBounds();
    usage?.stop();
    terminals?.closeAll();
    workspace?.flush();
    notes?.flush();
  });
}
