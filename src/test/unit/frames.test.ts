import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyFramePatch,
  createFrame,
  DEFAULT_FRAME_TITLE,
  membersOf,
  MIN_FRAME_SIZE,
  parseFrames,
} from '../../domain/canvas/frame.js';

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('molduras', () => {
  it('createFrame respeita o tamanho minimo', () => {
    const frame = createFrame('f', rect(0, 0, 10, 10), 1);
    assert.equal(frame.width, MIN_FRAME_SIZE.width);
    assert.equal(frame.height, MIN_FRAME_SIZE.height);
    assert.equal(frame.title, DEFAULT_FRAME_TITLE);
  });

  it('patch: so campos validos; titulo vazio mantem; cor invalida vira null', () => {
    const frame = { ...createFrame('f', rect(0, 0, 400, 300), 1), color: 'blue' as const };
    const next = applyFramePatch(frame, { x: Number.NaN, y: 5, width: 50, title: '  ', color: 'rosa' as never }, 2);
    assert.equal(next.x, 0);
    assert.equal(next.y, 5);
    assert.equal(next.width, MIN_FRAME_SIZE.width);
    assert.equal(next.title, DEFAULT_FRAME_TITLE);
    assert.equal(next.color, null);
    assert.equal(applyFramePatch(frame, { title: ' Front  end ' }, 2).title, 'Front end');
    assert.equal(applyFramePatch(frame, {}, 2).color, 'blue');
  });

  it('parseFrames descarta sem id ou sem geometria', () => {
    const frames = parseFrames({
      frames: [
        { id: 'a', x: 0, y: 0, width: 300, height: 200, title: 'API', color: 'green' },
        { id: 'b', x: 0, y: 0, width: 300 },
        { x: 0, y: 0, width: 300, height: 200 },
      ],
    });
    assert.deepEqual(frames.map((f) => [f.id, f.title, f.color]), [['a', 'API', 'green']]);
    assert.deepEqual(parseFrames(null), []);
  });

  it('membersOf: pertence quem tem o centro dentro', () => {
    const frame = rect(0, 0, 500, 400);
    const items = [
      { id: 'dentro', rect: rect(100, 100, 100, 100) },
      { id: 'maior-que-a-moldura', rect: rect(-200, -200, 900, 800) },
      { id: 'encostado', rect: rect(450, 0, 200, 100) },
      { id: 'fora', rect: rect(600, 600, 50, 50) },
    ];
    assert.deepEqual(membersOf(frame, items).map((i) => i.id), ['dentro', 'maior-que-a-moldura']);
  });
});
