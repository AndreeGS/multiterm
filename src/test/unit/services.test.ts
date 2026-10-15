import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';
import { FramesService } from '../../application/canvas/frames-service.js';
import { TextsService } from '../../application/canvas/texts-service.js';
import { TasksService } from '../../application/tasks/tasks-service.js';
import { UsageService } from '../../application/usage/usage-service.js';
import { JsonFramesStore } from '../../infrastructure/persistence/json-frames-store.js';
import { JsonTasksStore } from '../../infrastructure/persistence/json-tasks-store.js';
import { JsonTextsStore } from '../../infrastructure/persistence/json-texts-store.js';
import { ClaudeTranscriptReader } from '../../infrastructure/usage/claude-transcript-reader.js';

const root = mkdtempSync(join(tmpdir(), 'multiterm-services-'));
after(() => rmSync(root, { recursive: true, force: true }));

let dir: string;
let counter = 0;
beforeEach(() => {
  dir = join(root, String(counter++));
  mkdirSync(dir, { recursive: true });
});

const rect = { x: 0, y: 0, width: 400, height: 300 };

describe('TasksService', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  it('cria com titulos numerados, grava so depois da pausa e relê do disco', () => {
    const service = new TasksService(new JsonTasksStore(dir));
    const first = service.create('w1');
    const second = service.create('w1');
    assert.equal(first.title, 'Tarefas');
    assert.equal(second.title, 'Tarefas 2');
    assert.equal(new TasksService(new JsonTasksStore(dir)).list().length, 0, 'ainda no debounce');
    mock.timers.tick(600);
    assert.equal(new TasksService(new JsonTasksStore(dir)).list().length, 2);
  });

  it('removeWorkspace apaga so as listas daquele workspace', () => {
    const service = new TasksService(new JsonTasksStore(dir));
    service.create('w1');
    service.create('w2');
    service.removeWorkspace('w1');
    service.flush();
    const saved = new TasksService(new JsonTasksStore(dir)).list();
    assert.deepEqual(saved.map((list) => list.workspaceId), ['w2']);
  });

  it('update de id inexistente nao faz nada; remove grava', () => {
    const service = new TasksService(new JsonTasksStore(dir));
    const list = service.create('w1');
    service.update('nao-existe', { title: 'x' });
    service.remove(list.id);
    service.flush();
    assert.equal(new TasksService(new JsonTasksStore(dir)).list().length, 0);
  });
});

describe('TextsService e FramesService', () => {
  it('textos: cria, atualiza, apaga por workspace e adota orfaos; vazio nao volta', () => {
    const service = new TextsService(new JsonTextsStore(dir));
    const a = service.create(10, 20, 'w1');
    const b = service.create(0, 0, 'sumiu');
    // Texto vazio nao e restaurado (nao da para ver nem clicar): ambos ganham conteudo.
    service.update(a.id, { x: 50, content: 'titulo' });
    service.update(b.id, { content: 'orfao' });
    assert.equal(service.adoptOrphans(new Set(['w1']), 'w1'), 1);
    service.flush();
    const saved = new TextsService(new JsonTextsStore(dir)).list();
    assert.equal(saved.find((text) => text.id === a.id)?.x, 50);
    assert.equal(saved.find((text) => text.id === b.id)?.workspaceId, 'w1');
    service.removeWorkspace('w1');
    assert.equal(service.list().length, 0);
    service.create(0, 0, 'w1');
    service.flush();
    assert.equal(new TextsService(new JsonTextsStore(dir)).list().length, 0);
  });

  it('molduras: cria, atualiza e apaga', () => {
    const service = new FramesService(new JsonFramesStore(dir));
    const frame = service.create(rect, 'w1');
    service.update(frame.id, { title: 'API' });
    service.flush();
    assert.equal(new FramesService(new JsonFramesStore(dir)).list()[0]?.title, 'API');
    service.remove(frame.id);
    service.flush();
    assert.equal(new FramesService(new JsonFramesStore(dir)).list().length, 0);
  });
});

describe('UsageService com transcricoes de verdade', () => {
  const line = (id: string, sessionId: string, output: number) => JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    requestId: `req-${id}`,
    sessionId,
    message: {
      id: `msg-${id}`,
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 100, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });

  it('sem diretorio do Claude: indisponivel', async () => {
    const service = new UsageService(new ClaudeTranscriptReader(join(dir, 'nao-existe')));
    assert.equal((await service.refresh()).available, false);
  });

  it('soma por dia e por conversa, le so o que foi acrescentado e ignora duplicatas', async () => {
    const project = join(dir, 'projeto');
    mkdirSync(project);
    const file = join(project, 's1.jsonl');
    writeFileSync(file, `${line('1', 's1', 10)}\n{"type":"user","message":{"content":"oi"}}\n`);
    const updates: number[] = [];
    const service = new UsageService(new ClaudeTranscriptReader(dir), (summary) => updates.push(summary.today.requests));

    let summary = await service.refresh();
    assert.equal(summary.available, true);
    assert.equal(summary.today.requests, 1);
    assert.equal(summary.today.outputTokens, 10);

    // Linha nova + a mesma resposta repetida (retomada): so a nova conta.
    appendFileSync(file, `${line('2', 's1', 5)}\n${line('1', 's1', 10)}\n`);
    summary = await service.refresh();
    assert.equal(summary.today.requests, 2);
    assert.equal(summary.bySession.s1?.outputTokens, 15);
    assert.deepEqual(updates, [1, 2]);
  });

  it('linha ainda sendo escrita fica para a proxima passada', async () => {
    const file = join(dir, 's2.jsonl');
    const full = line('9', 's2', 7);
    writeFileSync(file, full.slice(0, 40));
    const service = new UsageService(new ClaudeTranscriptReader(dir));
    assert.equal((await service.refresh()).today.requests, 0);
    appendFileSync(file, `${full.slice(40)}\n`);
    assert.equal((await service.refresh()).today.requests, 1);
  });
});
