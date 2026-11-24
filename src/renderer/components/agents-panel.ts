import type { PermissionAnswer } from '../../domain/terminal/agent.js';
import { sortForOverview } from '../../domain/terminal/overview.js';
import { formatWaiting } from '../../domain/terminal/shell-integration.js';
import type { TerminalSnapshot } from '../../domain/terminal/types.js';
import { button, el } from './panel.js';
import { permissionCard } from './permission-card.js';

/** O que o painel precisa saber de cada terminal; o App monta a partir dos paineis. */
export interface AgentRow {
  readonly info: TerminalSnapshot;
  /** Nome do workspace, quando nao e o em uso (`null` = o em uso). */
  readonly workspace: string | null;
  /** `48k · US$ 0,62`, ou `null` sem consumo. */
  readonly usage: string | null;
  /** Ponto de estado e descricao, como no cabecalho do terminal. */
  readonly dotStatus: string;
  readonly stateLabel: string;
}

export interface AgentsPanelCallbacks {
  onGo(id: string): void;
  onAnswer(id: string, askId: string, answer: PermissionAnswer): void;
  onClose(): void;
}

/**
 * Barra lateral com todos os terminais de todos os workspaces, na ordem do
 * que precisa de voce: pedidos de permissao (respondiveis ali mesmo),
 * aguardando (o mais antigo primeiro), trabalhando, o resto.
 */
export class AgentsPanel {
  readonly element = el('aside', 'agents-panel');
  private readonly countEl = el('span', 'agents-count');
  private readonly list = el('ul', 'agents-list');
  private rows: readonly AgentRow[] = [];

  constructor(private readonly callbacks: AgentsPanelCallbacks) {
    const head = el('div', 'agents-head');
    const title = el('span', 'agents-title');
    title.textContent = 'Agentes';
    head.append(title, this.countEl, button('✕', 'Fechar o painel (Ctrl+Shift+G)', () => this.callbacks.onClose()));
    this.element.append(head, this.list);
    this.element.hidden = true;
  }

  get open(): boolean {
    return !this.element.hidden;
  }

  setOpen(open: boolean): void {
    this.element.hidden = !open;
    if (open) this.draw();
  }

  /** Guarda as linhas; so desenha com o painel aberto. */
  render(rows: readonly AgentRow[]): void {
    this.rows = rows;
    if (this.open) this.draw();
  }

  private draw(now = Date.now()): void {
    const rows = sortForOverview(this.rows);
    const waiting = rows.filter((row) => row.info.needsAttention).length;
    this.countEl.textContent = waiting > 0 ? `${waiting} aguardando` : `${rows.length}`;
    if (rows.length === 0) {
      const empty = el('li', 'agents-empty');
      empty.textContent = 'Nenhum terminal aberto.';
      this.list.replaceChildren(empty);
      return;
    }
    this.list.replaceChildren(...rows.map((row) => this.item(row, now)));
  }

  private item(row: AgentRow, now: number): HTMLLIElement {
    const { info } = row;
    const item = el('li', 'agents-item');
    item.classList.toggle('attention', info.needsAttention);
    item.classList.toggle('notice', info.notice !== null);
    item.tabIndex = 0;
    item.title = 'Ir para o terminal';
    item.addEventListener('click', () => this.callbacks.onGo(info.id));
    item.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.target !== item) return;
      event.preventDefault();
      this.callbacks.onGo(info.id);
    });

    const dot = el('span', 'status-dot');
    dot.dataset.status = row.dotStatus;
    const name = el('span', 'agents-name');
    name.textContent = info.name;
    const usage = el('span', 'agents-usage');
    usage.textContent = row.usage ?? '';
    const top = el('div', 'agents-row');
    top.append(dot, name, usage);

    const waited = info.attentionSince !== null ? formatWaiting(now - info.attentionSince) : null;
    const detail = el('div', 'agents-detail');
    detail.textContent = [row.stateLabel, waited, row.workspace ? `▤ ${row.workspace}` : null].filter(Boolean).join(' · ');
    item.append(top, detail);

    const ask = info.pendingPermission;
    if (ask) {
      item.append(permissionCard(ask, (answer) => this.callbacks.onAnswer(info.id, ask.id, answer), true));
    } else if (info.notice) {
      const notice = el('div', 'agents-notice');
      notice.textContent = `🔔 ${info.notice}`;
      item.append(notice);
    }
    return item;
  }
}
