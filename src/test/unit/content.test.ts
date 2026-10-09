import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyTextPatch, createCanvasText, DEFAULT_TEXT_SIZE, parseCanvasTexts } from '../../domain/canvas/text.js';
import { applyNotePatch, createNote, parseNotes } from '../../domain/notes/note.js';
import {
  applyTaskListPatch,
  cleanItemText,
  createTaskList,
  MAX_ITEM_LENGTH,
  parseTaskLists,
  type TaskItem,
} from '../../domain/tasks/task-list.js';

const rect = { x: 0, y: 0, width: 100, height: 50 };

describe('notas', () => {
  it('createNote: titulo vazio vira "Nota"', () => {
    assert.equal(createNote('n', '   ', 'w', 1).title, 'Nota');
  });

  it('patch: titulo vazio mantem o anterior; null remove vinculo e posicao', () => {
    const note = { ...createNote('n', 'Roteiro', 'w', 1), terminalId: 'abc', rect };
    const next = applyNotePatch(note, { title: ' ', terminalId: null, rect: null, content: 'oi' }, 2);
    assert.equal(next.title, 'Roteiro');
    assert.equal(next.terminalId, null);
    assert.equal(next.rect, null);
    assert.equal(next.content, 'oi');
    assert.equal(next.updatedAt, 2);
  });

  it('patch com undefined nao mexe no campo', () => {
    const note = { ...createNote('n', 'x', 'w', 1), terminalId: 'abc' };
    assert.equal(applyNotePatch(note, {}, 2).terminalId, 'abc');
  });

  it('parseNotes descarta entradas invalidas e usa padroes', () => {
    const notes = parseNotes({ notes: [{ id: 'a', terminalId: 'abc', createdAt: 5 }, { title: 'sem id' }, 3] });
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.title, 'Nota');
    assert.equal(notes[0]?.terminalId, 'abc');
    assert.equal(notes[0]?.updatedAt, 5);
    assert.deepEqual(parseNotes({ notes: 'x' }), []);
    assert.deepEqual(parseNotes(null), []);
  });
});

describe('listas de tarefas', () => {
  const item = (id: string, text: string, extra: Partial<TaskItem> = {}): TaskItem => ({
    id,
    text,
    done: false,
    doneAt: null,
    createdAt: 0,
    ...extra,
  });

  it('createTaskList comeca vazia', () => {
    const list = createTaskList('l', '', 'w', 1);
    assert.equal(list.title, 'Tarefas');
    assert.deepEqual(list.items, []);
  });

  it('itens: ids repetidos ficam com o primeiro, sem texto sao descartados', () => {
    const list = applyTaskListPatch(
      createTaskList('l', 'x', 'w', 1),
      { items: [item('a', 'um'), item('a', 'repetido'), item('b', '   '), item('c', 'tres')] },
      2,
    );
    assert.deepEqual(list.items.map((i) => i.text), ['um', 'tres']);
  });

  it('doneAt so vale para tarefa concluida', () => {
    const lists = parseTaskLists({
      lists: [{ id: 'l', items: [item('a', 'x', { doneAt: 9 }), item('b', 'y', { done: true, doneAt: 9 })] }],
    });
    assert.equal(lists[0]?.items[0]?.doneAt, null);
    assert.equal(lists[0]?.items[1]?.doneAt, 9);
  });

  it('cleanItemText: uma linha, com limite', () => {
    assert.equal(cleanItemText('  a\n\tb  '), 'a b');
    assert.equal(cleanItemText('x'.repeat(MAX_ITEM_LENGTH + 1)).length, MAX_ITEM_LENGTH);
  });

  it('parseTaskLists descarta listas sem id', () => {
    assert.equal(parseTaskLists({ lists: [{ title: 'x' }, { id: 'ok' }] }).length, 1);
  });
});

describe('textos soltos', () => {
  it('createCanvasText usa o tamanho padrao', () => {
    assert.equal(createCanvasText('t', 1, 2, 'w', 0).fontSize, DEFAULT_TEXT_SIZE);
  });

  it('patch so aceita tamanhos da escala e numeros finitos', () => {
    const text = createCanvasText('t', 1, 2, 'w', 0);
    const next = applyTextPatch(text, { fontSize: 13, x: Number.NaN, y: 7 }, 1);
    assert.equal(next.fontSize, DEFAULT_TEXT_SIZE);
    assert.equal(next.x, 1);
    assert.equal(next.y, 7);
    assert.equal(applyTextPatch(text, { fontSize: 48 }, 1).fontSize, 48);
  });

  it('parseCanvasTexts descarta texto vazio e sem posicao', () => {
    const texts = parseCanvasTexts({
      texts: [
        { id: 'a', x: 0, y: 0, content: 'titulo' },
        { id: 'b', x: 0, y: 0, content: '   ' },
        { id: 'c', content: 'sem posicao' },
      ],
    });
    assert.deepEqual(texts.map((t) => t.id), ['a']);
  });
});
