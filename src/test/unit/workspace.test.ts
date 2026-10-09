import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultConfig,
  MAX_RECENT_COMMANDS,
  MAX_RECENT_DIRS,
  parseConfig,
  withRecentCommand,
  withRecentDir,
} from '../../domain/workspace/config.js';
import {
  capacity,
  clampZoom,
  equalSizes,
  fitView,
  gridTemplate,
  gutters,
  layoutFor,
  MAX_ZOOM,
  MIN_TRACK,
  MIN_ZOOM,
  parseCanvasRect,
  parseCanvasView,
  parseTrackSizes,
  resizeTracks,
  zoomAt,
} from '../../domain/workspace/layout.js';
import { defaultSettings, FONT_SIZE_MAX, parseSettings } from '../../domain/workspace/settings.js';

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

describe('layout: grades', () => {
  it('capacidade de cada layout', () => {
    assert.equal(capacity('3'), 3);
    assert.equal(capacity('8'), 8);
    assert.equal(capacity('free'), Number.POSITIVE_INFINITY);
  });

  it('layoutFor escolhe a menor grade que comporta', () => {
    assert.equal(layoutFor(1), '1');
    assert.equal(layoutFor(3), '3');
    assert.equal(layoutFor(5), '6');
    assert.equal(layoutFor(20), '8');
  });

  it('o painel alto do layout 3 corta o divisor horizontal da coluna esquerda', () => {
    const rows = gutters(gridTemplate('3')).filter((g) => g.axis === 'row');
    assert.deepEqual(rows, [{ axis: 'row', boundary: 0, from: 1, to: 2 }]);
  });

  it('grade 2x2 tem um divisor em cada eixo, inteiro', () => {
    assert.deepEqual(gutters(gridTemplate('4')), [
      { axis: 'col', boundary: 0, from: 0, to: 2 },
      { axis: 'row', boundary: 0, from: 0, to: 2 },
    ]);
  });

  it('parseTrackSizes normaliza e rejeita contagem errada', () => {
    const parsed = parseTrackSizes('2', { cols: [1, 3], rows: [5] });
    assert.deepEqual(parsed, { cols: [0.25, 0.75], rows: [1] });
    assert.equal(parseTrackSizes('2', { cols: [1], rows: [1] }), null);
    assert.equal(parseTrackSizes('2', { cols: [1, -1], rows: [1] }), null);
    assert.deepEqual(equalSizes('6'), { cols: [1 / 3, 1 / 3, 1 / 3], rows: [0.5, 0.5] });
  });

  it('resizeTracks respeita o minimo e conserva a soma do par', () => {
    const next = resizeTracks([0.5, 0.5], 0, 0.9);
    assert.ok(close(next[0]!, 1 - MIN_TRACK));
    assert.ok(close(next[0]! + next[1]!, 1));
    assert.deepEqual(resizeTracks([0.5, 0.5], 5, 0.1), [0.5, 0.5]);
  });
});

describe('layout: area livre', () => {
  it('parseCanvasRect exige numeros finitos e tamanho positivo', () => {
    assert.deepEqual(parseCanvasRect({ x: 1, y: 2, width: 3, height: 4 }), { x: 1, y: 2, width: 3, height: 4 });
    assert.equal(parseCanvasRect({ x: 1, y: 2, width: 0, height: 4 }), null);
    assert.equal(parseCanvasRect({ x: Number.NaN, y: 2, width: 3, height: 4 }), null);
    assert.equal(parseCanvasRect(null), null);
  });

  it('zoom limitado a faixa', () => {
    assert.equal(clampZoom(10), MAX_ZOOM);
    assert.equal(clampZoom(0), MIN_ZOOM);
    assert.equal(parseCanvasView({ x: 0, y: 0, zoom: 9 })?.zoom, MAX_ZOOM);
  });

  it('zoomAt mantem parado o ponto sob o cursor', () => {
    const view = { x: 100, y: 50, zoom: 1 };
    const next = zoomAt(view, 2, 300, 250);
    const before = { x: (300 - view.x) / view.zoom, y: (250 - view.y) / view.zoom };
    const after = { x: (300 - next.x) / next.zoom, y: (250 - next.y) / next.zoom };
    assert.deepEqual(after, before);
  });

  it('fitView centraliza e nao amplia alem de 100%', () => {
    const view = fitView([{ x: 0, y: 0, width: 100, height: 100 }], 1000, 800);
    assert.equal(view.zoom, 1);
    assert.equal(view.x, 450);
    assert.equal(view.y, 350);
    assert.deepEqual(fitView([], 1000, 800), { x: 0, y: 0, zoom: 1 });
  });

  it('fitView reduz quando nao cabe', () => {
    const view = fitView([{ x: 0, y: 0, width: 2000, height: 100 }], 1000 + 80, 800);
    assert.ok(close(view.zoom, 0.5));
  });
});

describe('config', () => {
  it('lixo vira o padrao', () => {
    assert.deepEqual(parseConfig('nao e objeto'), defaultConfig());
    assert.deepEqual(parseConfig({ layout: 'x', window: { width: -1 } }), defaultConfig());
  });

  it('terminais salvos: sem cwd sao descartados; comando e limpo', () => {
    const config = parseConfig({
      terminals: [
        { id: 'abc', name: 'api', cwd: '/srv', command: ' claude \n', rect: { x: 0, y: 0, width: 10, height: 10 } },
        { name: 'sem cwd' },
        null,
      ],
    });
    assert.equal(config.terminals.length, 1);
    assert.deepEqual(config.terminals[0], {
      id: 'abc',
      name: 'api',
      cwd: '/srv',
      command: 'claude',
      workspaceId: 'default',
      rect: { x: 0, y: 0, width: 10, height: 10 },
    });
  });

  it('recentes: limite e mais recente primeiro, sem repetir', () => {
    const many = Array.from({ length: 30 }, (_, i) => `/d${i}`);
    assert.equal(parseConfig({ recentDirs: many }).recentDirs.length, MAX_RECENT_DIRS);
    let config = defaultConfig();
    config = withRecentDir(config, '/a');
    config = withRecentDir(config, '/b');
    config = withRecentDir(config, '/a');
    assert.deepEqual(config.recentDirs, ['/a', '/b']);
    for (let i = 0; i < 20; i += 1) config = withRecentCommand(config, `cmd${i}`);
    assert.equal(config.recentCommands.length, MAX_RECENT_COMMANDS);
    assert.equal(config.recentCommands[0], 'cmd19');
  });

  it('settings: valores fora da faixa sao limitados ou ignorados', () => {
    assert.deepEqual(parseSettings(null), defaultSettings());
    const settings = parseSettings({ theme: 'paper', fontSize: 99, uiScale: 3, showLinks: false });
    assert.equal(settings.theme, 'paper');
    assert.equal(settings.fontSize, FONT_SIZE_MAX);
    assert.equal(settings.uiScale, 1);
    assert.equal(settings.showLinks, false);
  });
});
