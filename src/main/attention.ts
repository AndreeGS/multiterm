import { app, BrowserWindow, Notification } from 'electron';
import type { TerminalSnapshot } from '../domain/terminal/types.js';

const STATUS_TEXT: Partial<Record<TerminalSnapshot['status'], string>> = {
  idle: 'terminou de produzir output e esta aguardando voce',
  exited: 'o processo encerrou',
  error: 'o processo encerrou com erro',
};

/**
 * Traduz o sinal de atencao das sessoes em feedback do sistema operacional:
 * notificacao nativa, contador no icone e piscada na barra de tarefas.
 *
 * So notifica na *transicao* para "precisa de atencao" e apenas quando a janela
 * nao esta em foco — se voce ja esta olhando, o destaque no painel basta.
 */
export class AttentionNotifier {
  private readonly previous = new Map<string, boolean>();
  private readonly notices = new Map<string, string | null>();
  /** Notificacoes na tela: sem referencia o GC as coleta e o clique se perde. */
  private readonly shown = new Set<Notification>();

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    /** Clicou na notificacao: o renderer leva voce ao terminal. */
    private readonly onActivate: (id: string) => void,
  ) {}

  observe(snapshot: TerminalSnapshot): void {
    const before = this.previous.get(snapshot.id) ?? false;
    const noticeBefore = this.notices.get(snapshot.id) ?? null;
    this.previous.set(snapshot.id, snapshot.needsAttention);
    this.notices.set(snapshot.id, snapshot.notice);

    // Um pedido explicito novo avisa mesmo se o terminal ja estava ocioso.
    const newNotice = snapshot.notice !== null && snapshot.notice !== noticeBefore;
    if ((snapshot.needsAttention && !before) || newNotice) this.announce(snapshot);
    this.refreshBadge();
  }

  forget(id: string): void {
    this.previous.delete(id);
    this.notices.delete(id);
    this.refreshBadge();
  }

  private announce(snapshot: TerminalSnapshot): void {
    const window = this.getWindow();
    if (window?.isFocused()) return;

    if (Notification.isSupported()) {
      const notification = new Notification({
        title: snapshot.name,
        body: snapshot.notice ?? STATUS_TEXT[snapshot.status] ?? 'precisa de atencao',
        urgency: snapshot.status === 'error' || snapshot.notice ? 'critical' : 'normal',
      });
      notification.on('click', () => {
        this.shown.delete(notification);
        const target = this.getWindow();
        if (!target) return;
        if (target.isMinimized()) target.restore();
        target.show();
        target.focus();
        this.onActivate(snapshot.id);
      });
      this.shown.add(notification);
      notification.on('close', () => this.shown.delete(notification));
      notification.show();
    }
    window?.flashFrame(true);
  }

  private refreshBadge(): void {
    let pending = 0;
    for (const needsAttention of this.previous.values()) if (needsAttention) pending += 1;

    // No Linux o badge so aparece em ambientes com suporte a Unity launcher;
    // nas demais plataformas e no-op.
    app.setBadgeCount(pending);
    if (pending === 0) this.getWindow()?.flashFrame(false);
  }
}
