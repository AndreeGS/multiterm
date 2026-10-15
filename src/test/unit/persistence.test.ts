import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { NotesService } from '../../application/notes/notes-service.js';
import { createNote } from '../../domain/notes/note.js';
import { orphanIds } from '../../domain/workspace/workspace.js';
import { readJson, takeRecoveredFiles, writeJsonAtomic } from '../../infrastructure/persistence/atomic-json.js';
import { JsonNotesStore } from '../../infrastructure/persistence/json-notes-store.js';

const root = mkdtempSync(join(tmpdir(), 'multiterm-persist-'));
after(() => rmSync(root, { recursive: true, force: true }));

let dir: string;
let counter = 0;
beforeEach(() => {
  dir = join(root, String(counter++));
  takeRecoveredFiles();
});

describe('escrita e leitura de JSON', () => {
  it('arquivo ausente: undefined, sem aviso', () => {
    assert.equal(readJson(join(dir, 'nada.json')), undefined);
    assert.deepEqual(takeRecoveredFiles(), []);
  });

  it('a segunda escrita guarda a anterior em .bak', () => {
    const file = join(dir, 'dados.json');
    writeJsonAtomic(file, { v: 1 });
    assert.equal(existsSync(`${file}.bak`), false);
    writeJsonAtomic(file, { v: 2 });
    assert.deepEqual(readJson(file), { v: 2 });
    assert.deepEqual(JSON.parse(readFileSync(`${file}.bak`, 'utf8')), { v: 1 });
    assert.equal(existsSync(`${file}.tmp`), false);
  });

  it('corrompido: guarda o original de lado e restaura do .bak', () => {
    const file = join(dir, 'dados.json');
    writeJsonAtomic(file, { v: 1 });
    writeJsonAtomic(file, { v: 2 });
    writeFileSync(file, '{"v": 2,');
    assert.deepEqual(readJson(file), { v: 1 });
    const [notice] = takeRecoveredFiles();
    assert.equal(notice?.file, file);
    assert.equal(notice?.fromBackup, true);
    assert.ok(notice?.movedTo);
    assert.equal(readFileSync(notice.movedTo, 'utf8'), '{"v": 2,');
    assert.equal(existsSync(file), false);
  });

  it('corrompido sem backup: undefined, mas o original nao se perde', () => {
    const file = join(dir, 'dados.json');
    writeJsonAtomic(file, { v: 1 });
    writeFileSync(file, '');
    assert.equal(readJson(file), undefined);
    const [notice] = takeRecoveredFiles();
    assert.equal(notice?.fromBackup, false);
    assert.ok(readdirSync(dir).some((name) => name.startsWith('dados.json.corrupt-')));
  });
});

describe('itens de workspace inexistente', () => {
  it('orphanIds lista so quem aponta para workspace desconhecido', () => {
    const items = [
      { id: 'a', workspaceId: 'w1' },
      { id: 'b', workspaceId: 'sumiu' },
      { id: 'c', workspaceId: 'w2' },
    ];
    assert.deepEqual(orphanIds(items, new Set(['w1', 'w2'])), ['b']);
    assert.deepEqual(orphanIds(items, new Set(['w1', 'w2', 'sumiu'])), []);
  });

  it('adoptOrphans move as notas orfas para o workspace alvo e grava', () => {
    writeJsonAtomic(join(dir, 'notes.json'), {
      notes: [createNote('n1', 'Uma', 'w1', 1), createNote('n2', 'Outra', 'sumiu', 1)],
    });
    const service = new NotesService(new JsonNotesStore(dir));
    assert.equal(service.adoptOrphans(new Set(['w1']), 'w1'), 1);
    assert.deepEqual(service.list().map((note) => note.workspaceId), ['w1', 'w1']);
    service.flush();
    const saved = new NotesService(new JsonNotesStore(dir)).list();
    assert.deepEqual(saved.map((note) => note.workspaceId), ['w1', 'w1']);
    assert.equal(service.adoptOrphans(new Set(['w1']), 'w1'), 0);
  });
});
