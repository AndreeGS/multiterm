import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { NotesService } from '../../application/notes/notes-service.js';
import { WorkspaceService } from '../../application/workspace/workspace-service.js';
import { parseNotes } from '../../domain/notes/note.js';
import { parseTaskLists } from '../../domain/tasks/task-list.js';
import { parseCanvasTexts } from '../../domain/canvas/text.js';
import { parseFrames } from '../../domain/canvas/frame.js';
import { parseConfig } from '../../domain/workspace/config.js';
import { DEFAULT_WORKSPACE_ID, MAX_WORKSPACES, parseWorkspace } from '../../domain/workspace/workspace.js';
import { JsonConfigStore } from '../../infrastructure/persistence/json-config-store.js';
import { JsonNotesStore } from '../../infrastructure/persistence/json-notes-store.js';

describe('workspaces no config', () => {
  it('config antigo vira um workspace padrao com o layout, as proporcoes e a vista de antes', () => {
    const config = parseConfig({
      layout: 'free',
      layoutSizes: { '2': { cols: [1, 3], rows: [1] } },
      canvasView: { x: 10, y: 20, zoom: 1.5 },
      terminals: [{ cwd: '/a' }],
    });
    assert.equal(config.workspaces.length, 1);
    const [workspace] = config.workspaces;
    assert.equal(workspace?.id, DEFAULT_WORKSPACE_ID);
    assert.equal(workspace?.layout, 'free');
    assert.deepEqual(workspace?.layoutSizes['2'], { cols: [0.25, 0.75], rows: [1] });
    assert.deepEqual(workspace?.canvasView, { x: 10, y: 20, zoom: 1.5 });
    assert.equal(config.activeWorkspace, DEFAULT_WORKSPACE_ID);
    assert.equal(config.terminals[0]?.workspaceId, DEFAULT_WORKSPACE_ID);
  });

  it('ativo invalido cai no primeiro; ids repetidos ficam com o primeiro', () => {
    const config = parseConfig({
      workspaces: [{ id: 'a', name: 'A' }, { id: 'a', name: 'repetido' }, { id: 'b', name: ' B  ' }, { name: 'sem id' }],
      activeWorkspace: 'nao-existe',
    });
    assert.deepEqual(config.workspaces.map((w) => [w.id, w.name]), [['a', 'A'], ['b', 'B']]);
    assert.equal(config.activeWorkspace, 'a');
  });

  it('parseWorkspace: layout invalido vira o padrao', () => {
    assert.equal(parseWorkspace({ id: 'x', layout: 'zzz' })?.layout, '4');
    assert.equal(parseWorkspace({ name: 'x' }), null);
  });

  it('arquivos antigos de notas, tarefas, textos e grupos caem no workspace padrao', () => {
    assert.equal(parseNotes({ notes: [{ id: 'n' }] })[0]?.workspaceId, DEFAULT_WORKSPACE_ID);
    assert.equal(parseTaskLists({ lists: [{ id: 'l' }] })[0]?.workspaceId, DEFAULT_WORKSPACE_ID);
    assert.equal(parseCanvasTexts({ texts: [{ id: 't', x: 0, y: 0, content: 'x' }] })[0]?.workspaceId, DEFAULT_WORKSPACE_ID);
    assert.equal(parseFrames({ frames: [{ id: 'f', x: 0, y: 0, width: 300, height: 200, workspaceId: 'w2' }] })[0]?.workspaceId, 'w2');
  });
});

describe('WorkspaceService', () => {
  const dir = mkdtempSync(join(tmpdir(), 'multiterm-ws-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('layout e vista sao gravados no workspace em uso', () => {
    const service = new WorkspaceService(new JsonConfigStore(dir));
    service.setLayout('2');
    const other = service.createWorkspace('Infra')!;
    assert.equal(service.active().id, DEFAULT_WORKSPACE_ID, 'criar nao troca');
    service.activate(other.id);
    service.setLayout('free');
    service.setCanvasView({ x: 1, y: 2, zoom: 1 });
    assert.equal(service.activate(DEFAULT_WORKSPACE_ID).layout, '2');
    const back = service.activate(other.id);
    assert.equal(back.layout, 'free');
    assert.deepEqual(back.canvasView, { x: 1, y: 2, zoom: 1 });
    service.flush();
    // E sobrevive ao reinicio.
    const reloaded = new WorkspaceService(new JsonConfigStore(dir));
    assert.equal(reloaded.active().id, other.id);
    assert.equal(reloaded.current().workspaces.length, 2);
  });

  it('remover: nunca o ultimo; leva os terminais salvos; ativo passa ao primeiro', () => {
    const service = new WorkspaceService(new JsonConfigStore(mkdtempSync(join(dir, 'b-'))));
    assert.equal(service.removeWorkspace(DEFAULT_WORKSPACE_ID), false);
    const other = service.createWorkspace('X')!;
    service.setTerminals([
      { name: 'a', cwd: '/a', workspaceId: DEFAULT_WORKSPACE_ID, rect: null },
      { name: 'b', cwd: '/b', workspaceId: other.id, rect: null },
    ]);
    service.activate(other.id);
    assert.equal(service.removeWorkspace(other.id), true);
    assert.equal(service.active().id, DEFAULT_WORKSPACE_ID);
    assert.deepEqual(service.current().terminals.map((t) => t.name), ['a']);
  });

  it('limite de workspaces e renomear', () => {
    const service = new WorkspaceService(new JsonConfigStore(mkdtempSync(join(dir, 'c-'))));
    for (let i = 1; i < MAX_WORKSPACES; i += 1) assert.ok(service.createWorkspace(`w${i}`));
    assert.equal(service.createWorkspace('demais'), null);
    service.renameWorkspace(DEFAULT_WORKSPACE_ID, '   ');
    assert.equal(service.active().name, 'Principal');
    service.renameWorkspace(DEFAULT_WORKSPACE_ID, ' Projeto  X ');
    assert.equal(service.active().name, 'Projeto X');
  });

  it('NotesService.removeWorkspace apaga so as notas daquele workspace', () => {
    const notes = new NotesService(new JsonNotesStore(mkdtempSync(join(dir, 'd-'))));
    notes.create('a');
    notes.create('b');
    notes.create('a');
    notes.removeWorkspace('a');
    assert.deepEqual(notes.list().map((n) => n.workspaceId), ['b']);
  });
});
