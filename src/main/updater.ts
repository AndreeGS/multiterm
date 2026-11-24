import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

/** Primeira consulta um pouco depois de abrir: nao disputa a subida dos terminais. */
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

/**
 * Atualizacao automatica pelas Releases do GitHub (electron-updater).
 *
 * So no app empacotado (.deb ou AppImage): instalado pelo codigo, quem
 * atualiza e o `git pull`. Baixa em segundo plano e avisa; instalar e sempre
 * uma escolha sua (botao na barra), que passa pela confirmacao de sair quando
 * ha programas rodando. No AppImage o arquivo e trocado; no .deb o sistema
 * pede a senha de administrador (pkexec) para instalar o pacote.
 */
export class Updater {
  private timer: NodeJS.Timeout | null = null;
  private ready: string | null = null;

  constructor(
    private readonly enabled: () => boolean,
    private readonly onReady: (version: string) => void,
  ) {}

  /** Ha como atualizar este app? */
  static supported(): boolean {
    return app.isPackaged && process.platform === 'linux';
  }

  start(): void {
    if (!Updater.supported()) return;
    autoUpdater.autoDownload = true;
    // Instalar ao sair sem perguntar pediria a senha do .deb numa hora qualquer.
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = { info: () => {}, warn: (m: unknown) => console.warn('[update]', m), error: (m: unknown) => console.error('[update]', m), debug: () => {} };
    // So para testar com um servidor local: aponta para outra pasta de releases.
    const feed = process.env.MULTITERM_UPDATE_FEED;
    if (feed) autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    autoUpdater.on('update-downloaded', (info) => {
      this.ready = info.version;
      this.onReady(info.version);
    });
    autoUpdater.on('error', (error) => console.error('[update] falhou:', error.message));
    const first = setTimeout(() => this.check(), Number(process.env.MULTITERM_UPDATE_DELAY_MS) || FIRST_CHECK_MS);
    first.unref();
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS);
    this.timer.unref();
  }

  /** Versao ja baixada, esperando reiniciar (para a janela recarregada). */
  get pending(): string | null {
    return this.ready;
  }

  /** Reinicia instalando a versao baixada. */
  install(): void {
    if (this.ready) autoUpdater.quitAndInstall();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private check(): void {
    if (!this.enabled() || this.ready) return;
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      console.error('[update] nao consultou:', error instanceof Error ? error.message : error);
    });
  }
}
