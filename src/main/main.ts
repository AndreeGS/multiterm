import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  screen,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { WorktreeService } from '../application/git/worktree-service.js';
import { TerminalService } from '../application/terminal/terminal-service.js';
import { NotesService } from '../application/notes/notes-service.js';
import { TextsService } from '../application/canvas/texts-service.js';
import { FramesService } from '../application/canvas/frames-service.js';
import { TasksService } from '../application/tasks/tasks-service.js';
import { UsageService } from '../application/usage/usage-service.js';
import { WorkspaceService } from '../application/workspace/workspace-service.js';
import { parseWorktreeInfo } from '../domain/git/worktree.js';
import type { NotePatch } from '../domain/notes/note.js';
import type { CanvasTextPatch } from '../domain/canvas/text.js';
import type { CanvasFramePatch } from '../domain/canvas/frame.js';
import type { TaskListPatch } from '../domain/tasks/task-list.js';
import { isClaudeCommand, withContinue } from '../domain/terminal/command.js';
import { parseTerminalSize, parseTerminalSpec } from '../domain/terminal/spec.js';
import type { TerminalSpec } from '../domain/terminal/types.js';
import { isSafeExternalUrl } from '../domain/url.js';
import type { SavedTerminal } from '../domain/workspace/config.js';
import {
  isGridLayout,
  isLayout,
  parseCanvasRect,
  parseCanvasView,
  parseTrackSizes,
  type CanvasRect,
} from '../domain/workspace/layout.js';
import { parsePaneColor } from '../domain/workspace/colors.js';
import { visibleBounds } from '../domain/workspace/config.js';
import { parseSettings, WINDOW_BACKGROUND } from '../domain/workspace/settings.js';
import { parseTemplate } from '../domain/workspace/template.js';
import { summarize } from '../domain/workspace/workspace.js';
import { takeRecoveredFiles } from '../infrastructure/persistence/atomic-json.js';
import { JsonConfigStore } from '../infrastructure/persistence/json-config-store.js';
import { JsonNotesStore } from '../infrastructure/persistence/json-notes-store.js';
import { JsonTextsStore } from '../infrastructure/persistence/json-texts-store.js';
import { JsonFramesStore } from '../infrastructure/persistence/json-frames-store.js';
import { JsonTasksStore } from '../infrastructure/persistence/json-tasks-store.js';
import { GitCli } from '../infrastructure/git/git-cli.js';
import { NodePtyFactory } from '../infrastructure/terminal/node-pty-adapter.js';
import { hasClaudeTranscript, hasProjectConversations } from '../infrastructure/usage/claude-paths.js';
import { CHANNELS, type BootstrapState, type RestoredSession } from '../shared/contract.js';
import { AttentionNotifier } from './attention.js';
import { FlowControl } from './flow-control.js';
import { OutputBatcher } from './output-batcher.js';

let mainWindow: BrowserWindow | null = null;
let workspace: WorkspaceService;
let terminals: TerminalService;
let attention: AttentionNotifier;
let usage: UsageService;
let notes: NotesService;
let texts: TextsService;
let frames: FramesService;
let tasks: TasksService;
const worktrees = new WorktreeService(new GitCli());
const flow = new FlowControl();
const output = new OutputBatcher((batch) => {
  send(CHANNELS.data, batch);
  for (const [id, data] of batch) {
    if (flow.sent(id, data.length)) pauseOutput(id);
  }
});
/** Pausas sem confirmacao do renderer por mais que isto sao desfeitas (nunca trava um terminal). */
const FLOW_STALL_MS = 5000;
const stallTimers = new Map<string, NodeJS.Timeout>();

function pauseOutput(id: string): void {
  terminals.pause(id);
  clearTimeout(stallTimers.get(id));
  stallTimers.set(id, setTimeout(() => {
    flow.forget(id);
    resumeOutput(id);
  }, FLOW_STALL_MS));
}

function resumeOutput(id: string): void {
  clearTimeout(stallTimers.get(id));
  stallTimers.delete(id);
  terminals.resume(id);
}
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
  const { settings } = workspace.current();
  const window = visibleBounds(workspace.current().window, screen.getAllDisplays().map((display) => display.workArea));

  mainWindow = new BrowserWindow({
    x: window.x,
    y: window.y,
    width: window.width,
    height: window.height,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: WINDOW_BACKGROUND[settings.theme],
    title: 'MultiTerm',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Sem o menu padrao do Electron (File/Edit/View/Window): nada nele e do app,
  // e os atalhos que importam o proprio app trata. No macOS o menu e do
  // sistema, fora da janela, e isto nao tem efeito.
  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', () => {
    if (window.maximized) mainWindow?.maximize();
    mainWindow?.show();
  });
  mainWindow.on('close', persistBounds);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Links externos abrem no navegador, nunca dentro do app — e so http(s)/mailto.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // A janela nunca sai do renderer: um arquivo ou URL arrastado para ela
  // carregaria outra pagina com acesso ao preload (e a criar terminais).
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-redirect', (event) => event.preventDefault());
  // Renderer caiu (GPU, memoria): as sessoes seguem vivas no main e o replay
  // reconstroi as telas. Limite para nao entrar em loop se ele cair ao subir.
  const crashes: number[] = [];
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    console.error('[main] renderer caiu:', details.reason);
    const now = Date.now();
    crashes.push(now);
    while (crashes.length > 0 && now - crashes[0]! > RELOAD_WINDOW_MS) crashes.shift();
    if (crashes.length <= MAX_RELOADS) mainWindow?.reload();
  });

  void mainWindow.loadFile(RENDERER_PAGE);
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

/** Recarregamentos automaticos permitidos por janela de tempo, se o renderer cair. */
const MAX_RELOADS = 3;
const RELOAD_WINDOW_MS = 60_000;

/** Pagina do renderer: o unico remetente aceito no IPC. */
const RENDERER_PAGE = join(__dirname, '../renderer/index.html');
const RENDERER_URL = pathToFileURL(RENDERER_PAGE).href;

function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  return typeof url === 'string' && url.split(/[?#]/)[0] === RENDERER_URL;
}

/** `ipcMain.handle` que recusa chamadas de qualquer frame que nao seja o renderer. */
function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) throw new Error('Remetente nao autorizado.');
    return listener(event, ...args);
  });
}

/** `ipcMain.on` que ignora mensagens de qualquer frame que nao seja o renderer. */
function on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void {
  ipcMain.on(channel, (event, ...args: unknown[]) => {
    if (isTrustedSender(event)) listener(event, ...args);
  });
}

/** Permissoes que o renderer usa (copiar/colar no terminal e notas); o resto e negado. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write', 'notifications']);

function persistBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  const { x, y, width, height } = mainWindow.getNormalBounds();
  workspace.setWindowBounds({ x, y, width, height, ...(mainWindow.isMaximized() ? { maximized: true } : {}) });
}

/** Espelha os terminais abertos no config, para reabri-los na proxima vez. */
function persistTerminals(): void {
  if (restoring) return;
  const live = terminals.list().map((snapshot) => ({
    id: snapshot.id,
    name: snapshot.name,
    cwd: snapshot.cwd,
    shell: snapshot.shell,
    ...(snapshot.command ? { command: snapshot.command } : {}),
    ...(snapshot.color ? { color: snapshot.color } : {}),
    ...(snapshot.claudeSession ? { claudeSession: snapshot.claudeSession } : {}),
    ...(snapshot.worktree ? { worktree: snapshot.worktree } : {}),
    workspaceId: snapshot.workspaceId,
    rect: terminalRects.get(snapshot.id) ?? null,
  }));
  const next = [...live, ...pendingSession];
  // Mudancas de status (executando/ocioso, varias por segundo) chegam aqui
  // tambem, mas nao mudam nada do que e salvo: nao reescreve o config por elas.
  const signature = JSON.stringify(next);
  if (signature === persistedTerminals) return;
  persistedTerminals = signature;
  workspace.setTerminals(next);
}
let persistedTerminals = '';

function restoreSession(): RestoredSession {
  const saved = pendingSession;
  const restored: RestoredSession = { terminals: [], terminalRects: {} };
  restoring = true;
  try {
    pendingSession = [];
    for (const entry of saved) {
      const snapshot = terminals.create({
        name: entry.name,
        cwd: entry.cwd,
        shell: entry.shell,
        // Com a conversa salva, o proprio terminal a retoma (`--resume <id>`).
        command: entry.command && !entry.claudeSession ? resumeCommand(entry.command, entry.cwd) : entry.command,
        color: entry.color ?? null,
        claudeSession: entry.claudeSession ?? null,
        // Pasta removida por fora: o terminal abre no home, sem worktree.
        worktree: entry.worktree && existsSync(entry.worktree.path) ? entry.worktree : null,
        workspaceId: entry.workspaceId,
      }, undefined, entry.id);
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

/**
 * Terminal salvo antes de existir a conversa por terminal: um `claude` volta
 * para a ultima conversa do diretorio (`--continue`). So quando ha conversa
 * salva para o diretorio: sem ela o `--continue` falha.
 */
function resumeCommand(command: string, cwd: string): string {
  if (!isClaudeCommand(command)) return command;
  return hasProjectConversations(cwd) ? withContinue(command) : command;
}

function registerIpc(): void {
  handle(CHANNELS.bootstrap, (): BootstrapState => {
    // Renderer novo (ou recarregado): o que estava em voo nunca sera confirmado.
    for (const id of flow.reset()) resumeOutput(id);
    const config = workspace.current();
    const active = workspace.active();
    return {
      workspaces: config.workspaces.map(summarize),
      activeWorkspace: active.id,
      layout: active.layout,
      layoutSizes: active.layoutSizes,
      notes: notes.list(),
      taskLists: tasks.list(),
      texts: texts.list(),
      frames: frames.list(),
      recentDirs: config.recentDirs,
      recentCommands: config.recentCommands,
      templates: config.templates,
      terminals: terminals.list(),
      terminalRects: Object.fromEntries(terminalRects),
      canvasView: active.canvasView,
      settings: config.settings,
      pendingSession,
      defaultDir: config.recentDirs[0] ?? homedir(),
      homeDir: homedir(),
      configPath: join(app.getPath('userData'), 'config.json'),
      recoveredFiles: takeRecoveredFiles(),
    };
  });

  handle(CHANNELS.sessionRestore, () => restoreSession());
  handle(CHANNELS.sessionDiscard, () => {
    pendingSession = [];
    persistTerminals();
  });

  handle(CHANNELS.pickDirectory, async (_event, startIn?: string) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Diretorio do projeto',
      defaultPath: startIn || workspace.current().recentDirs[0] || homedir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle(CHANNELS.create, async (_event, raw: unknown, worktreeBranch?: unknown) => {
    const spec = parseTerminalSpec(raw);
    if (!spec) throw new Error('Terminal invalido.');
    // Worktree e workspace do spec so podem vir daqui: o renderer pede o
    // worktree pela branch, e o terminal nasce no workspace em uso.
    let resolved: TerminalSpec = { ...spec, worktree: null };
    if (typeof worktreeBranch === 'string' && worktreeBranch.trim()) {
      const worktree = await worktrees.create(spec.cwd, worktreeBranch.trim());
      resolved = { ...resolved, cwd: worktree.path, worktree };
    }
    // Lido depois do git: trocar de workspace enquanto o worktree e criado
    // poe o terminal no workspace em que voce esta agora.
    resolved = { ...resolved, workspaceId: workspace.active().id };
    const snapshot = terminals.create(resolved);
    // O recente e o diretorio que voce escolheu, nao a pasta do worktree.
    workspace.rememberDir(snapshot.worktree ? snapshot.worktree.repo : snapshot.cwd);
    if (snapshot.command) workspace.rememberCommand(snapshot.command);
    persistTerminals();
    return snapshot;
  });

  handle(CHANNELS.close, (_event, id: string) => terminals.close(id));
  handle(CHANNELS.restart, (_event, id: string, raw?: unknown) => {
    const cwd = typeof raw === 'string' && raw ? raw : undefined;
    terminals.restart(id, cwd);
    if (cwd) workspace.rememberDir(cwd);
  });
  handle(CHANNELS.rename, (_event, id: string, name: unknown) => {
    if (typeof name === 'string' && name.length <= 200) terminals.rename(id, name);
  });
  handle(CHANNELS.moveTerminal, (_event, id: string, workspaceId: unknown) => {
    if (typeof workspaceId === 'string' && workspace.has(workspaceId)) terminals.moveToWorkspace(id, workspaceId);
  });
  handle(CHANNELS.workspaceSwitch, (_event, id: string) => workspace.activate(id));
  handle(CHANNELS.workspaceCreate, (_event, name: unknown) =>
    workspace.createWorkspace(typeof name === 'string' ? name : ''));
  handle(CHANNELS.workspaceRename, (_event, id: string, name: unknown) => {
    if (typeof name === 'string') workspace.renameWorkspace(id, name);
    return workspace.current().workspaces.map(summarize);
  });
  handle(CHANNELS.workspaceDelete, (_event, id: string) => {
    if (!workspace.removeWorkspace(id)) return null;
    for (const snapshot of terminals.list()) {
      if (snapshot.workspaceId === id) terminals.close(snapshot.id);
    }
    pendingSession = pendingSession.filter((entry) => entry.workspaceId !== id);
    notes.removeWorkspace(id);
    tasks.removeWorkspace(id);
    texts.removeWorkspace(id);
    frames.removeWorkspace(id);
    persistTerminals();
    return workspace.active();
  });
  handle(CHANNELS.setColor, (_event, id: string, color: unknown) => {
    terminals.setColor(id, parsePaneColor(color));
  });
  handle(CHANNELS.gitInfo, (_event, cwd: unknown) =>
    typeof cwd === 'string' && cwd ? worktrees.info(cwd) : { repo: null, branch: null });
  handle(CHANNELS.worktreeDirty, (_event, raw: unknown) => {
    const worktree = parseWorktreeInfo(raw);
    return worktree ? worktrees.isDirty(worktree) : false;
  });
  handle(CHANNELS.worktreeRemove, async (_event, raw: unknown, force: unknown) => {
    const worktree = parseWorktreeInfo(raw);
    if (!worktree) throw new Error('Worktree invalido.');
    await worktrees.remove(worktree, force === true);
  });
  handle(CHANNELS.templateSave, (_event, input: unknown) => {
    const template = parseTemplate(input, randomUUID());
    if (template) workspace.saveTemplate(template);
    return workspace.current().templates;
  });
  handle(CHANNELS.templateDelete, (_event, id: string) => {
    workspace.removeTemplate(id);
    return workspace.current().templates;
  });
  on(CHANNELS.setRect, (_event, id: string, rect: unknown) => {
    const parsed = parseCanvasRect(rect);
    if (parsed) terminalRects.set(id, parsed);
    else terminalRects.delete(id);
    persistTerminals();
  });
  handle(CHANNELS.busyProgram, (_event, id: string) => terminals.busyProgram(id));
  on(CHANNELS.ackOutput, (_event, id: unknown, bytes: unknown) => {
    if (typeof id !== 'string' || !Number.isFinite(bytes)) return;
    if (flow.acked(id, bytes as number)) resumeOutput(id);
    else if (flow.isPaused(id)) pauseOutput(id); // ainda alcancando: renova o prazo
  });
  on(CHANNELS.openExternal, (_event, url: unknown) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });
  handle(CHANNELS.interrupt, (_event, id: string) => terminals.interrupt(id));
  handle(CHANNELS.replay, (_event, id: string) => {
    // O que esta no lote entra no replay; entregar antes garante que nenhum
    // lote misture chunks de antes e de depois dele.
    output.flush();
    return terminals.replay(id);
  });

  on(CHANNELS.acknowledge, (_event, id: string) => terminals.acknowledge(id));
  on(CHANNELS.write, (_event, id: string, data: unknown) => {
    if (typeof data === 'string') terminals.write(id, data);
  });
  on(CHANNELS.resize, (_event, id: string, cols: unknown, rows: unknown) => {
    const size = parseTerminalSize(cols, rows);
    if (size) terminals.resize(id, size);
  });
  handle(CHANNELS.usageGet, () => usage.current());
  on(CHANNELS.usageRefresh, () => void usage.refresh());
  on(CHANNELS.setLayout, (_event, layout: unknown) => {
    if (isLayout(layout)) workspace.setLayout(layout);
  });
  on(CHANNELS.setLayoutSizes, (_event, layout: unknown, sizes: unknown) => {
    if (!isGridLayout(layout)) return;
    const parsed = parseTrackSizes(layout, sizes);
    if (parsed) workspace.setLayoutSizes(layout, parsed);
  });
  on(CHANNELS.setCanvasView, (_event, view: unknown) => {
    const parsed = parseCanvasView(view);
    if (parsed) workspace.setCanvasView(parsed);
  });
  on(CHANNELS.setSettings, (_event, settings: unknown) => {
    const parsed = parseSettings(settings);
    workspace.setSettings(parsed);
    mainWindow?.setBackgroundColor(WINDOW_BACKGROUND[parsed.theme]);
  });

  handle(CHANNELS.noteCreate, () => notes.create(workspace.active().id));
  on(CHANNELS.noteUpdate, (_event, id: string, patch: NotePatch) => {
    if (typeof patch === 'object' && patch !== null) notes.update(id, withKnownWorkspace(patch));
  });
  handle(CHANNELS.noteDelete, (_event, id: string) => notes.remove(id));

  handle(CHANNELS.taskListCreate, () => tasks.create(workspace.active().id));
  on(CHANNELS.taskListUpdate, (_event, id: string, patch: TaskListPatch) => {
    if (typeof patch === 'object' && patch !== null) tasks.update(id, withKnownWorkspace(patch));
  });
  handle(CHANNELS.taskListDelete, (_event, id: string) => tasks.remove(id));

  handle(CHANNELS.textCreate, (_event, x: unknown, y: unknown) =>
    texts.create(Number.isFinite(x) ? (x as number) : 0, Number.isFinite(y) ? (y as number) : 0, workspace.active().id),
  );
  on(CHANNELS.textUpdate, (_event, id: string, patch: CanvasTextPatch) => {
    if (typeof patch === 'object' && patch !== null) texts.update(id, patch);
  });
  handle(CHANNELS.textDelete, (_event, id: string) => texts.remove(id));

  handle(CHANNELS.frameCreate, (_event, rect: unknown) => {
    const parsed = parseCanvasRect(rect);
    if (!parsed) throw new Error('Retangulo invalido.');
    return frames.create(parsed, workspace.active().id);
  });
  on(CHANNELS.frameUpdate, (_event, id: string, patch: CanvasFramePatch) => {
    if (typeof patch === 'object' && patch !== null) frames.update(id, patch);
  });
  handle(CHANNELS.frameDelete, (_event, id: string) => frames.remove(id));
}

let shutDown = false;

/** Grava tudo e encerra os terminais. Idempotente: varios caminhos levam aqui. */
function shutdown(): void {
  if (shutDown) return;
  shutDown = true;
  persistBounds();
  usage?.stop();
  output.dispose();
  terminals?.closeAll();
  flushData();
}

/** Grava agora o que esta esperando o debounce. */
function flushData(): void {
  workspace?.flush();
  notes?.flush();
  texts?.flush();
  frames?.flush();
  tasks?.flush();
}

/**
 * Itens de um workspace que nao existe mais (config resetado ou editado por
 * fora) vao para o workspace ativo, em vez de ficarem invisiveis.
 */
function adoptOrphans(): void {
  const validIds = new Set(workspace.current().workspaces.map((item) => item.id));
  const target = workspace.active().id;
  notes.adoptOrphans(validIds, target);
  tasks.adoptOrphans(validIds, target);
  texts.adoptOrphans(validIds, target);
  frames.adoptOrphans(validIds, target);
  if (pendingSession.every((entry) => validIds.has(entry.workspaceId))) return;
  pendingSession = pendingSession.map((entry) => (validIds.has(entry.workspaceId) ? entry : { ...entry, workspaceId: target }));
  persistTerminals();
}

/** Mover para um workspace que nao existe deixaria o item invisivel para sempre. */
function withKnownWorkspace<T extends { workspaceId?: string }>(patch: T): T {
  if (patch.workspaceId === undefined || workspace.has(patch.workspaceId)) return patch;
  const { workspaceId: _ignored, ...rest } = patch;
  return rest as T;
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
    texts = new TextsService(new JsonTextsStore(app.getPath('userData')));
    frames = new FramesService(new JsonFramesStore(app.getPath('userData')));
    tasks = new TasksService(new JsonTasksStore(app.getPath('userData')));
    attention = new AttentionNotifier(() => mainWindow, (id) => send(CHANNELS.focusTerminal, id));
    terminals = new TerminalService(new NodePtyFactory(), {
      onData: (id, chunk, seq) => output.push(id, chunk, seq),
      onUpdate: (snapshot) => {
        attention.observe(snapshot);
        send(CHANNELS.update, snapshot);
        // Renomear e reiniciar em outro diretorio chegam por aqui.
        persistTerminals();
      },
      onClose: (id) => {
        attention.forget(id);
        terminalRects.delete(id);
        flow.forget(id);
        clearTimeout(stallTimers.get(id));
        stallTimers.delete(id);
        persistTerminals();
        output.flush();
        send(CHANNELS.closed, id);
      },
    }, (sessionId) => hasClaudeTranscript(sessionId));

    usage = new UsageService(undefined, (summary) => send(CHANNELS.usageUpdate, summary));

    pendingSession = workspace.current().terminals;
    adoptOrphans();
    const permitted = (permission: string) => ALLOWED_PERMISSIONS.has(permission);
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permitted(permission)));
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => permitted(permission));
    registerIpc();
    createWindow();
    usage.start();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', shutdown);
  // Nenhum destes passa pelo before-quit: sem o flush, as ultimas edicoes
  // (ainda no debounce) se perderiam.
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(signal, () => {
      shutdown();
      app.quit();
    });
  }
  void app.whenReady().then(() => powerMonitor.on('shutdown', shutdown));
  // Um erro solto nao derruba os terminais, mas o que esta no debounce ja vai
  // para o disco, caso o processo morra logo depois.
  process.on('uncaughtException', (error) => {
    console.error('[main] erro nao tratado:', error);
    flushData();
  });
}
