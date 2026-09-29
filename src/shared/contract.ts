/**
 * Contrato entre main e renderer. Compartilhado pelos tres bundles
 * (main, preload, renderer) para manter o IPC tipado em um lugar so.
 */
import type { TerminalSnapshot, TerminalSpec } from '../domain/terminal/types.js';
import type { UsageSummary } from '../domain/usage/types.js';
import type { LayoutId } from '../domain/workspace/layout.js';

export interface BootstrapState {
  readonly layout: LayoutId;
  readonly recentDirs: string[];
  readonly terminals: TerminalSnapshot[];
  readonly defaultDir: string;
  readonly homeDir: string;
  readonly configPath: string;
}

export interface MultiTermApi {
  bootstrap(): Promise<BootstrapState>;
  /** Abre o seletor de diretorio nativo. `null` se cancelado. */
  pickDirectory(startIn?: string): Promise<string | null>;

  createTerminal(spec: TerminalSpec): Promise<TerminalSnapshot>;
  closeTerminal(id: string): Promise<void>;
  restartTerminal(id: string, cwd?: string): Promise<void>;
  renameTerminal(id: string, name: string): Promise<void>;
  interruptTerminal(id: string): Promise<void>;
  /** Marca que voce ja viu este terminal (limpa o pedido de atencao). */
  acknowledgeTerminal(id: string): void;
  writeTerminal(id: string, data: string): void;
  resizeTerminal(id: string, cols: number, rows: number): void;
  /** Output retido, para preencher o xterm ao anexar. */
  replayTerminal(id: string): Promise<string>;

  setLayout(layout: LayoutId): void;

  /** Consumo local de tokens (nao e percentual do limite do plano). */
  getUsage(): Promise<UsageSummary>;
  refreshUsage(): void;

  onTerminalData(listener: (id: string, chunk: string) => void): () => void;
  onTerminalUpdate(listener: (snapshot: TerminalSnapshot) => void): () => void;
  onTerminalClose(listener: (id: string) => void): () => void;
  onUsageUpdate(listener: (summary: UsageSummary) => void): () => void;
}

export const CHANNELS = {
  bootstrap: 'app:bootstrap',
  pickDirectory: 'app:pick-directory',
  setLayout: 'workspace:set-layout',

  usageGet: 'usage:get',
  usageRefresh: 'usage:refresh',
  usageUpdate: 'usage:update',

  create: 'terminal:create',
  close: 'terminal:close',
  restart: 'terminal:restart',
  rename: 'terminal:rename',
  interrupt: 'terminal:interrupt',
  acknowledge: 'terminal:acknowledge',
  write: 'terminal:write',
  resize: 'terminal:resize',
  replay: 'terminal:replay',

  data: 'terminal:data',
  update: 'terminal:update',
  closed: 'terminal:closed',
} as const;
