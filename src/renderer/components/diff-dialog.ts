import { parseUnifiedDiff, type DiffFile } from '../../domain/git/diff.js';
import type { WorktreeDiff } from '../../domain/git/worktree.js';
import { trapFocus } from './modal.js';

/** Um arquivo enorme (lockfile regenerado) mostra so o comeco: o DOM nao aguenta 50 mil linhas. */
const MAX_LINES_PER_FILE = 4000;

const CHANGE_LABEL: Record<DiffFile['change'], string> = {
  added: 'novo',
  deleted: 'apagado',
  renamed: 'renomeado',
  modified: '',
};

/**
 * O que o agente mudou no worktree: lista de arquivos a esquerda, o diff do
 * escolhido a direita. So leitura. `R` recarrega, setas trocam de arquivo, Esc fecha.
 */
export function openDiffDialog(title: string, load: () => Promise<WorktreeDiff>): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal diff-dialog';

    const head = document.createElement('div');
    head.className = 'diff-head';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const summary = document.createElement('span');
    summary.className = 'diff-summary';
    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.textContent = '⟳ Atualizar';
    reloadBtn.title = 'Atualizar (R)';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'primary';
    closeBtn.textContent = 'Fechar';
    head.append(heading, summary, reloadBtn, closeBtn);

    const files = document.createElement('ul');
    files.className = 'diff-files';
    files.tabIndex = 0;
    files.setAttribute('aria-label', 'Arquivos alterados');
    const view = document.createElement('div');
    view.className = 'diff-view';
    view.tabIndex = 0;
    const body = document.createElement('div');
    body.className = 'diff-body';
    body.append(files, view);

    modal.append(head, body);
    overlay.append(modal);
    document.body.append(overlay);
    const release = trapFocus(overlay);

    let parsed: DiffFile[] = [];
    let selected = 0;

    const message = (text: string) => {
      const note = document.createElement('div');
      note.className = 'diff-empty';
      note.textContent = text;
      view.replaceChildren(note);
    };

    const renderList = () => {
      files.replaceChildren(...parsed.map((file, index) => {
        const row = document.createElement('li');
        row.className = 'diff-file';
        row.classList.toggle('selected', index === selected);
        row.title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
        const name = document.createElement('span');
        name.className = 'diff-file-name';
        name.textContent = file.path;
        const counts = document.createElement('span');
        counts.className = 'diff-file-counts';
        if (file.binary) counts.textContent = 'binario';
        else {
          const add = document.createElement('span');
          add.className = 'diff-add-count';
          add.textContent = `+${file.additions}`;
          const del = document.createElement('span');
          del.className = 'diff-del-count';
          del.textContent = `−${file.deletions}`;
          counts.append(add, ' ', del);
        }
        row.append(name, counts);
        const label = CHANGE_LABEL[file.change];
        if (label) {
          const tag = document.createElement('span');
          tag.className = `diff-tag ${file.change}`;
          tag.textContent = label;
          row.append(tag);
        }
        row.addEventListener('click', () => select(index));
        return row;
      }));
      files.children[selected]?.scrollIntoView({ block: 'nearest' });
    };

    const renderFile = () => {
      const file = parsed[selected];
      if (!file) return;
      if (file.binary) return message('Arquivo binario: sem diff de texto.');
      if (file.lines.length === 0) return message(file.change === 'renamed' ? 'Renomeado, sem mudanca no conteudo.' : 'Sem mudanca no conteudo (so o modo do arquivo).');
      // Um no de texto por linha e tudo por textContent: o diff e conteudo do repo, nunca HTML.
      const fragment = document.createDocumentFragment();
      for (const line of file.lines.slice(0, MAX_LINES_PER_FILE)) {
        const row = document.createElement('div');
        row.className = `diff-line ${line.kind}`;
        const mark = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : line.kind === 'ctx' ? ' ' : '';
        row.textContent = line.kind === 'hunk' || line.kind === 'note' ? line.text : `${mark} ${line.text}`;
        fragment.append(row);
      }
      if (file.lines.length > MAX_LINES_PER_FILE) {
        const more = document.createElement('div');
        more.className = 'diff-line note';
        more.textContent = `… mais ${file.lines.length - MAX_LINES_PER_FILE} linhas nao exibidas.`;
        fragment.append(more);
      }
      view.replaceChildren(fragment);
      view.scrollTop = 0;
    };

    const select = (index: number) => {
      if (index < 0 || index >= parsed.length) return;
      selected = index;
      renderList();
      renderFile();
    };

    let loading = false;
    const reload = async () => {
      if (loading) return;
      loading = true;
      reloadBtn.disabled = true;
      const previous = parsed[selected]?.path;
      summary.textContent = 'carregando…';
      try {
        const diff = await load();
        if (settled) return;
        parsed = parseUnifiedDiff(diff.text);
        const index = parsed.findIndex((file) => file.path === previous);
        selected = index >= 0 ? index : 0;
        const additions = parsed.reduce((sum, file) => sum + file.additions, 0);
        const deletions = parsed.reduce((sum, file) => sum + file.deletions, 0);
        summary.textContent = parsed.length === 0
          ? (diff.base ? `nada mudou desde ${diff.base}` : 'nada por commitar')
          : `${parsed.length} ${parsed.length === 1 ? 'arquivo' : 'arquivos'} · +${additions} −${deletions}` +
            (diff.base ? ` · desde ${diff.base}` : ' · so o nao commitado') +
            (diff.truncated ? ' · cortado (grande demais)' : '');
        renderList();
        if (parsed.length === 0) message(diff.base ? `Nenhuma mudanca em relacao a ${diff.base}.` : 'Nenhuma mudanca por commitar.');
        else renderFile();
      } catch (error) {
        if (settled) return;
        parsed = [];
        renderList();
        summary.textContent = '';
        message(`Nao foi possivel ler o diff: ${(error as Error).message}`);
      } finally {
        loading = false;
        reloadBtn.disabled = false;
      }
    };

    let settled = false;
    const close = () => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      release();
      resolve();
    };
    const onKey = (event: KeyboardEvent) => {
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.key === 'Escape') {
        handled();
        close();
      } else if (event.key === 'ArrowDown' && document.activeElement !== view) {
        handled();
        select(selected + 1);
      } else if (event.key === 'ArrowUp' && document.activeElement !== view) {
        handled();
        select(selected - 1);
      } else if ((event.key === 'r' || event.key === 'R') && !event.ctrlKey && !event.altKey && !event.metaKey) {
        handled();
        void reload();
      }
    };
    reloadBtn.addEventListener('click', () => void reload());
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey, true);

    files.focus();
    void reload();
  });
}
