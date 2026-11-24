import { parseUnifiedDiff, type DiffFile } from '../../domain/git/diff.js';
import { suggestCommitMessage, type MergeResult, type WorktreeDiff } from '../../domain/git/worktree.js';
import { trapFocus } from './modal.js';

/** Um arquivo enorme (lockfile regenerado) mostra so o comeco: o DOM nao aguenta 50 mil linhas. */
const MAX_LINES_PER_FILE = 4000;

const CHANGE_LABEL: Record<DiffFile['change'], string> = {
  added: 'novo',
  deleted: 'apagado',
  renamed: 'renomeado',
  modified: '',
};

/** Acoes do rodape: fechar o ciclo do worktree sem sair do app. */
export interface DiffActions {
  readonly branch: string;
  commit(message: string): Promise<void>;
  merge(): Promise<{ base: string; result: MergeResult }>;
  openPr(): Promise<string>;
  openUrl(url: string): void;
}

const MERGE_TEXT: Record<MergeResult, (base: string) => string> = {
  'fast-forward': (base) => `Mesclado: "${base}" avancou ate esta branch.`,
  merge: (base) => `Mesclado em "${base}" com um commit de merge.`,
  'up-to-date': (base) => `"${base}" ja tinha tudo desta branch.`,
};

/** Segundo clique confirma; depois disto o botao volta ao normal. */
const CONFIRM_MS = 4000;

/**
 * O que o agente mudou no worktree: lista de arquivos a esquerda, o diff do
 * escolhido a direita. `R` recarrega, setas trocam de arquivo, Esc fecha. Com
 * `actions`, o rodape commita, mescla na base e abre o PR.
 */
export function openDiffDialog(title: string, load: () => Promise<WorktreeDiff>, actions?: DiffActions): Promise<void> {
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
    let base: string | null = null;
    const foot = actions ? buildFoot(actions, () => base, () => void reload()) : null;
    if (foot) modal.append(foot.element);
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
        base = diff.base;
        foot?.refresh();
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
      // Escrevendo a mensagem de commit: as teclas sao do campo (Esc ainda fecha).
      const typing = event.target instanceof HTMLInputElement;
      if (typing && event.key !== 'Escape') return;
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

/**
 * Rodape: mensagem + Commitar tudo, Mesclar em <base> (com confirmacao no
 * segundo clique) e Abrir PR. Uma acao por vez; o resultado (ou o erro do
 * git) aparece ao lado.
 */
function buildFoot(actions: DiffActions, base: () => string | null, reload: () => void) {
  const element = document.createElement('div');
  element.className = 'diff-foot';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'diff-commit-input';
  input.spellcheck = false;
  input.value = suggestCommitMessage(actions.branch);
  input.setAttribute('aria-label', 'Mensagem de commit');
  const commitBtn = document.createElement('button');
  commitBtn.type = 'button';
  commitBtn.textContent = 'Commitar tudo';
  commitBtn.title = 'git add -A e git commit no worktree (com os seus hooks e assinatura)';
  const mergeBtn = document.createElement('button');
  mergeBtn.type = 'button';
  const prBtn = document.createElement('button');
  prBtn.type = 'button';
  prBtn.textContent = 'Abrir PR';
  prBtn.title = 'git push da branch e gh pr create contra a base';
  const status = document.createElement('span');
  status.className = 'diff-foot-status';
  element.append(input, commitBtn, mergeBtn, prBtn, status);

  let busy = false;
  let confirmUntil = 0;
  const refresh = () => {
    const target = base();
    const confirming = Date.now() < confirmUntil;
    mergeBtn.textContent = confirming ? `Confirmar: mesclar em ${target}?` : `Mesclar em ${target ?? 'base'}`;
    mergeBtn.classList.toggle('danger', confirming);
    mergeBtn.title = target
      ? `Mescla esta branch em "${target}" na copia principal do repositorio (que precisa estar em "${target}" e limpa). Conflito: nada muda.`
      : 'Este worktree nao tem branch base';
    for (const btn of [commitBtn, mergeBtn, prBtn]) btn.disabled = busy;
    if (!target) mergeBtn.disabled = prBtn.disabled = true;
    input.disabled = busy;
  };
  const show = (text: string, kind: 'ok' | 'error' | 'busy', url?: string) => {
    status.className = `diff-foot-status ${kind}`;
    status.replaceChildren(text);
    if (url) {
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = url;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        actions.openUrl(url);
      });
      status.append(' ', link);
    }
  };
  const runAction = async (label: string, task: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    confirmUntil = 0;
    refresh();
    show(label, 'busy');
    try {
      await task();
    } catch (error) {
      show((error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
    } finally {
      busy = false;
      refresh();
      reload();
    }
  };

  commitBtn.addEventListener('click', () => {
    const message = input.value.trim();
    if (!message) {
      show('Escreva uma mensagem de commit.', 'error');
      input.focus();
      return;
    }
    void runAction('Commitando…', async () => {
      await actions.commit(message);
      show('Commitado.', 'ok');
    });
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitBtn.click();
    }
  });
  mergeBtn.addEventListener('click', () => {
    if (Date.now() >= confirmUntil) {
      confirmUntil = Date.now() + CONFIRM_MS;
      refresh();
      setTimeout(refresh, CONFIRM_MS + 50);
      return;
    }
    void runAction('Mesclando…', async () => {
      const outcome = await actions.merge();
      show(MERGE_TEXT[outcome.result](outcome.base), 'ok');
    });
  });
  prBtn.addEventListener('click', () => {
    void runAction('Enviando a branch e abrindo o PR…', async () => {
      const url = await actions.openPr();
      show('PR:', 'ok', url);
    });
  });
  refresh();
  return { element, refresh };
}
