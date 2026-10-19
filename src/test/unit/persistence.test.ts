import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';
import { DebouncedSave } from '../../application/debounced-save.js';
import { NotesService } from '../../application/notes/notes-service.js';
import { createNote } from '../../domain/notes/note.js';
import { orphanIds } from '../../domain/workspace/workspace.js';
import {
  readJson,
  saveJson,
  setSaveFailureListener,
  takeRecoveredFiles,
  writeJsonAtomic,
} from '../../infrastructure/persistence/atomic-json.js';
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
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { v: 1 }, 'o arquivo volta com o backup');
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

// Como root a permissao nao impede a leitura: o cenario nao se reproduz.
const asRoot = process.getuid?.() === 0;

describe('arquivo que existe mas nao da para ler', { skip: asRoot || process.platform === 'win32' }, () => {
  it('guarda o original de lado, restaura do .bak e o arquivo volta a existir', () => {
    const file = join(dir, 'dados.json');
    writeJsonAtomic(file, { v: 1 });
    writeJsonAtomic(file, { v: 2 });
    chmodSync(file, 0o000);
    assert.deepEqual(readJson(file), { v: 1 });
    const [notice] = takeRecoveredFiles();
    assert.equal(notice?.reason, 'unreadable');
    assert.equal(notice?.fromBackup, true);
    assert.ok(notice?.movedTo);
    chmodSync(notice.movedTo, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(notice.movedTo, 'utf8')), { v: 2 });
    // Fechar sem mexer em nada nao pode deixar so o .bak para tras.
    assert.deepEqual(readJson(file), { v: 1 });
  });

  it('sem conseguir mover: nunca grava por cima do original', () => {
    const sub = join(dir, 'travado');
    mkdirSync(sub, { recursive: true });
    const file = join(sub, 'dados.json');
    writeJsonAtomic(file, { v: 1 });
    chmodSync(file, 0o000);
    chmodSync(sub, 0o500);
    try {
      assert.equal(readJson(file), undefined);
      const [notice] = takeRecoveredFiles();
      assert.equal(notice?.movedTo, null);
      assert.equal(saveJson(file, { v: 'padrao' }), false);
    } finally {
      chmodSync(sub, 0o700);
      chmodSync(file, 0o600);
    }
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { v: 1 });
  });
});

describe('falha ao gravar', () => {
  afterEach(() => setSaveFailureListener(null));

  it('saveJson devolve false e avisa uma vez por arquivo ate voltar a gravar', () => {
    const warned: string[] = [];
    setSaveFailureListener((file) => warned.push(file));
    // Um arquivo no lugar do diretorio: o mkdir falha sempre.
    writeFileSync(join(root, `bloqueio-${counter}`), 'x');
    const file = join(root, `bloqueio-${counter}`, 'dados.json');
    assert.equal(saveJson(file, { v: 1 }), false);
    assert.equal(saveJson(file, { v: 2 }), false);
    assert.deepEqual(warned, [file]);
  });
});

describe('DebouncedSave', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  it('grava depois da pausa; flush sem mudanca nao grava', () => {
    let saves = 0;
    const saver = new DebouncedSave(100, () => ++saves > 0);
    saver.schedule();
    saver.schedule();
    mock.timers.tick(100);
    assert.equal(saves, 1);
    saver.flush();
    assert.equal(saves, 1);
  });

  it('gravacao que falhou continua pendente e o flush tenta de novo', () => {
    const results = [false, true];
    let saves = 0;
    const saver = new DebouncedSave(100, () => {
      saves++;
      return results.shift() ?? true;
    });
    saver.schedule();
    mock.timers.tick(100);
    assert.equal(saves, 1);
    saver.flush();
    assert.equal(saves, 2);
    saver.flush();
    assert.equal(saves, 2);
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
