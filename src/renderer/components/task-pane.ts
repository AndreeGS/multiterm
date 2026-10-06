import { cleanItemText, type TaskItem, type TaskList } from '../../domain/tasks/task-list.js';
import type { CanvasRect } from '../../domain/workspace/layout.js';
import type { MultiTermApi } from '../../shared/contract.js';
import type { Appearance } from '../theme.js';
import { beginRename, button, el, type Panel } from './panel.js';

export interface TaskCallbacks {
  onFocus(id: string): void;
  onMaximize(id: string): void;
  onClose(id: string): void;
}

/**
 * Lista de tarefas: pendentes em cima (na ordem que voce escolher), concluidas
 * embaixo, da mais recente para a mais antiga. Cada mudanca vai inteira para o
 * main, que agrupa as escritas no disco como faz com as notas.
 */
export class TaskPane implements Panel {
  readonly element: HTMLElement;
  readonly header: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly infoEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly progress: HTMLElement;
  private readonly pendingEl: HTMLUListElement;
  private readonly doneToggle: HTMLButtonElement;
  private readonly doneEl: HTMLUListElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly maximizeBtn: HTMLButtonElement;
  private list: TaskList;
  private doneCollapsed = false;
  /** Item sendo arrastado para reordenar. */
  private draggingId: string | null = null;
  private fontSize: number;
  private scale = 1;

  constructor(
    list: TaskList,
    private readonly api: MultiTermApi,
    private readonly callbacks: TaskCallbacks,
    appearance: Appearance,
  ) {
    this.list = list;
    this.fontSize = appearance.fontSize;

    this.element = el('div', 'pane tasks');
    this.element.dataset.id = list.id;

    this.header = el('div', 'pane-header');
    const icon = el('span', 'note-icon');
    icon.textContent = '☑';
    this.nameEl = el('div', 'pane-name');
    this.infoEl = el('div', 'pane-cwd');

    const title = el('div', 'pane-title');
    title.append(this.nameEl, this.infoEl);
    title.title = 'Duplo clique para renomear';
    title.addEventListener('dblclick', () =>
      beginRename(this.nameEl, this.list.title, (name) => {
        this.list = { ...this.list, title: name.trim() };
        this.api.updateTaskList(this.id, { title: name });
        this.render();
      }),
    );

    const actions = el('div', 'pane-actions');
    this.clearBtn = button('⌫', 'Apagar as tarefas concluidas', () => this.clearDone());
    this.maximizeBtn = button('⤢', 'Maximizar / restaurar', () => this.callbacks.onMaximize(this.id));
    actions.append(
      this.clearBtn,
      this.maximizeBtn,
      button('✕', 'Fechar e apagar lista', () => this.callbacks.onClose(this.id)),
    );
    this.header.append(icon, title, actions);

    this.progress = el('div', 'tasks-progress');
    this.progress.append(el('div', 'tasks-progress-fill'));

    this.input = el('input', 'tasks-input');
    this.input.type = 'text';
    this.input.placeholder = 'Nova tarefa… (Enter adiciona)';
    this.input.spellcheck = false;
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.add(this.input.value);
      }
      if (event.key === 'Escape') this.input.value = '';
    });

    this.pendingEl = el('ul', 'tasks-list');
    this.doneToggle = el('button', 'tasks-done-toggle');
    this.doneToggle.addEventListener('click', () => {
      this.doneCollapsed = !this.doneCollapsed;
      this.render();
    });
    this.doneEl = el('ul', 'tasks-list done');

    const scroll = el('div', 'tasks-scroll');
    scroll.append(this.pendingEl, this.doneToggle, this.doneEl);

    this.body = el('div', 'pane-body tasks-body');
    this.body.append(this.progress, this.input, scroll);
    this.element.append(this.header, this.body);
    this.element.addEventListener('mousedown', () => this.callbacks.onFocus(this.id));

    this.render();
    this.applyFontSize();
  }

  get id(): string {
    return this.list.id;
  }

  get isEmpty(): boolean {
    return this.list.items.length === 0;
  }

  get canvasRect(): CanvasRect | null {
    return this.list.rect;
  }

  /** A area livre chama isto ao terminar de mover/redimensionar. */
  set canvasRect(rect: CanvasRect | null) {
    this.list = { ...this.list, rect };
    this.api.updateTaskList(this.id, { rect });
  }

  refit(): void {
    // A lista rola sozinha dentro do painel.
  }

  focus(): void {
    // Nao rouba o foco de quem ja esta digitando aqui (renomeando, editando um item).
    if (!this.element.contains(document.activeElement)) this.input.focus();
  }

  setFocused(focused: boolean): void {
    this.element.classList.toggle('focused', focused);
  }

  setScale(scale: number): void {
    this.scale = scale;
    this.applyFontSize();
  }

  setAppearance(appearance: Appearance): void {
    this.fontSize = appearance.fontSize;
    this.applyFontSize();
  }

  setMaximized(maximized: boolean): void {
    this.maximizeBtn.textContent = maximized ? '⤡' : '⤢';
  }

  dispose(): void {
    this.element.remove();
  }

  private applyFontSize(): void {
    // Tudo dentro do corpo e em `em`: muda a fonte aqui e o resto acompanha.
    this.body.style.fontSize = `${(this.fontSize + 0.5) * this.scale}px`;
  }

  private add(raw: string): void {
    const text = cleanItemText(raw);
    if (!text) return;
    const item: TaskItem = { id: crypto.randomUUID(), text, done: false, doneAt: null, createdAt: Date.now() };
    this.input.value = '';
    this.commit([...this.list.items, item]);
  }

  private toggle(id: string): void {
    const now = Date.now();
    this.commit(this.list.items.map((item) =>
      item.id === id ? { ...item, done: !item.done, doneAt: item.done ? null : now } : item,
    ));
  }

  private edit(id: string, raw: string): void {
    const text = cleanItemText(raw);
    if (!text) {
      this.remove(id);
      return;
    }
    this.commit(this.list.items.map((item) => (item.id === id ? { ...item, text } : item)));
  }

  private remove(id: string): void {
    this.commit(this.list.items.filter((item) => item.id !== id));
  }

  private clearDone(): void {
    const done = this.list.items.filter((item) => item.done).length;
    if (done === 0) return;
    if (!window.confirm(`Apagar ${done} ${done === 1 ? 'tarefa concluida' : 'tarefas concluidas'}?`)) return;
    this.commit(this.list.items.filter((item) => !item.done));
  }

  /** Coloca `id` logo antes de `beforeId` (ou no fim, se null). */
  private move(id: string, beforeId: string | null): void {
    if (id === beforeId) return;
    const item = this.list.items.find((entry) => entry.id === id);
    if (!item) return;
    const rest = this.list.items.filter((entry) => entry.id !== id);
    const index = beforeId ? rest.findIndex((entry) => entry.id === beforeId) : -1;
    if (index < 0) rest.push(item);
    else rest.splice(index, 0, item);
    this.commit(rest);
  }

  private commit(items: TaskItem[]): void {
    this.list = { ...this.list, items };
    this.api.updateTaskList(this.id, { items });
    this.render();
  }

  private render(): void {
    const pending = this.list.items.filter((item) => !item.done);
    // Concluida ha pouco fica no topo da secao: e a que voce acabou de marcar.
    const done = this.list.items.filter((item) => item.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    const total = this.list.items.length;

    this.nameEl.textContent = this.list.title;
    this.infoEl.textContent = total === 0
      ? 'tarefas · vazia'
      : `tarefas · ${done.length}/${total} concluidas`;
    const fill = this.progress.firstElementChild as HTMLElement;
    fill.style.width = total === 0 ? '0' : `${(done.length / total) * 100}%`;
    this.progress.hidden = total === 0;
    this.clearBtn.disabled = done.length === 0;

    this.pendingEl.replaceChildren(...pending.map((item) => this.renderItem(item, true)));
    if (pending.length === 0 && total > 0) {
      const empty = el('li', 'tasks-empty');
      empty.textContent = 'Tudo concluido.';
      this.pendingEl.append(empty);
    }

    this.doneToggle.hidden = done.length === 0;
    this.doneToggle.textContent = `${this.doneCollapsed ? '▸' : '▾'} Concluidas (${done.length})`;
    this.doneEl.hidden = this.doneCollapsed || done.length === 0;
    this.doneEl.replaceChildren(...done.map((item) => this.renderItem(item, false)));
  }

  private renderItem(item: TaskItem, sortable: boolean): HTMLLIElement {
    const row = el('li', 'tasks-item');
    row.dataset.id = item.id;

    const check = el('input', 'tasks-check');
    check.type = 'checkbox';
    check.checked = item.done;
    check.title = item.done ? 'Voltar para pendentes' : 'Concluir';
    check.addEventListener('change', () => this.toggle(item.id));

    const text = el('span', 'tasks-text');
    text.textContent = item.text;
    text.title = item.done && item.doneAt
      ? `Concluida em ${new Date(item.doneAt).toLocaleString()} · duplo clique para editar`
      : 'Duplo clique para editar';
    text.addEventListener('dblclick', () => this.beginEdit(row, text, item));

    row.append(check, text, button('✕', 'Apagar tarefa', () => this.remove(item.id)));
    if (sortable) this.makeSortable(row, item.id);
    return row;
  }

  private beginEdit(row: HTMLLIElement, target: HTMLElement, item: TaskItem): void {
    row.draggable = false;
    const input = el('input', 'tasks-edit');
    input.value = item.text;
    target.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      if (commit && input.value !== item.text) this.edit(item.id, input.value);
      else this.render();
    };
    input.addEventListener('blur', () => finish(true), { once: true });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
      if (event.key === 'Escape') finish(false);
      event.stopPropagation();
    });
  }

  /** Arrastar um pendente sobre outro o coloca antes (metade de cima) ou depois. */
  private makeSortable(row: HTMLLIElement, id: string): void {
    row.draggable = true;
    row.addEventListener('dragstart', (event) => {
      this.draggingId = id;
      row.classList.add('dragging');
      event.dataTransfer?.setData('text/plain', id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      this.draggingId = null;
      this.clearDropMarks();
    });
    row.addEventListener('dragover', (event) => {
      if (!this.draggingId || this.draggingId === id) return;
      event.preventDefault();
      const after = this.isLowerHalf(row, event);
      this.clearDropMarks();
      row.classList.add(after ? 'drop-after' : 'drop-before');
    });
    row.addEventListener('drop', (event) => {
      const dragged = this.draggingId;
      if (!dragged || dragged === id) return;
      event.preventDefault();
      const after = this.isLowerHalf(row, event);
      this.move(dragged, after ? this.nextPendingId(id) : id);
    });
  }

  private isLowerHalf(row: HTMLElement, event: DragEvent): boolean {
    const box = row.getBoundingClientRect();
    return event.clientY > box.top + box.height / 2;
  }

  /** O pendente seguinte na lista inteira (concluidos no meio nao contam). */
  private nextPendingId(id: string): string | null {
    const pending = this.list.items.filter((item) => !item.done && item.id !== this.draggingId);
    const index = pending.findIndex((item) => item.id === id);
    return pending[index + 1]?.id ?? null;
  }

  private clearDropMarks(): void {
    for (const node of this.pendingEl.querySelectorAll('.dragging, .drop-before, .drop-after')) {
      node.classList.remove('dragging', 'drop-before', 'drop-after');
    }
  }
}
