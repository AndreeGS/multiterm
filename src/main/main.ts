import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TerminalService } from '../application/terminal/terminal-service.js';
import { UsageService } from '../application/usage/usage-service.js';
import { WorkspaceService } from '../application/workspace/workspace-service.js';
import type { TerminalSpec } from '../domain/terminal/types.js';
import { isLayout } from '../domain/workspace/layout.js';
import { JsonConfigStore } from '../infrastructure/persistence/json-config-store.js';
import { NodePtyFactory } from '../infrastructure/terminal/node-pty-adapter.js';
import { CHANNELS, type BootstrapState } from '../shared/contract.js';
import { AttentionNotifier } from './attention.js';

let mainWindow: BrowserWindow | null = null;
let workspace: WorkspaceService;
let terminals: TerminalService;
let attention: AttentionNotifier;
let usage: UsageService;

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

function registerIpc(): void {
  ipcMain.handle(CHANNELS.bootstrap, (): BootstrapState => {
    const config = workspace.current();
    return {
      layout: config.layout,
      recentDirs: config.recentDirs,
      terminals: terminals.list(),
      defaultDir: config.recentDirs[0] ?? homedir(),
      homeDir: homedir(),
      configPath: join(app.getPath('userData'), 'config.json'),
    };
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
    return snapshot;
  });

  ipcMain.handle(CHANNELS.close, (_event, id: string) => terminals.close(id));
  ipcMain.handle(CHANNELS.restart, (_event, id: string, cwd?: string) => {
    terminals.restart(id, cwd);
    if (cwd) workspace.rememberDir(cwd);
  });
  ipcMain.handle(CHANNELS.rename, (_event, id: string, name: string) => terminals.rename(id, name));
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
    attention = new AttentionNotifier(() => mainWindow);
    terminals = new TerminalService(new NodePtyFactory(), {
      onData: (id, chunk) => send(CHANNELS.data, id, chunk),
      onUpdate: (snapshot) => {
        attention.observe(snapshot);
        send(CHANNELS.update, snapshot);
      },
      onClose: (id) => {
        attention.forget(id);
        send(CHANNELS.closed, id);
      },
    });

    usage = new UsageService(undefined, (summary) => send(CHANNELS.usageUpdate, summary));

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
  });
}
