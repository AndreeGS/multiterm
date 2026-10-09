import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePaneColor } from '../../domain/workspace/colors.js';
import { parseConfig } from '../../domain/workspace/config.js';
import {
  MAX_TEMPLATES,
  parseTemplate,
  parseTemplates,
  withTemplate,
  type TerminalTemplate,
} from '../../domain/workspace/template.js';

const template = (id: string, name: string, extra: Partial<TerminalTemplate> = {}): TerminalTemplate => ({
  id,
  name,
  cwd: '/srv/api',
  command: 'claude',
  color: null,
  ...extra,
});

describe('cores', () => {
  it('so aceita as chaves da paleta', () => {
    assert.equal(parsePaneColor('teal'), 'teal');
    assert.equal(parsePaneColor('#ff0000'), null);
    assert.equal(parsePaneColor(undefined), null);
  });

  it('terminal salvo guarda a cor valida e ignora a invalida', () => {
    const config = parseConfig({
      terminals: [
        { cwd: '/a', color: 'red' },
        { cwd: '/b', color: 'rosa-choque' },
      ],
    });
    assert.equal(config.terminals[0]?.color, 'red');
    assert.equal('color' in config.terminals[1]!, false);
  });
});

describe('templates', () => {
  it('parseTemplate exige nome e diretorio, limpa o comando e a cor', () => {
    assert.deepEqual(parseTemplate({ name: ' API ', cwd: '/srv', command: 'npm run dev\n', color: 'x' }, 'id1'), {
      id: 'id1',
      name: 'API',
      cwd: '/srv',
      command: 'npm run dev',
      color: null,
    });
    assert.equal(parseTemplate({ name: '', cwd: '/srv' }, 'id'), null);
    assert.equal(parseTemplate({ name: 'x' }, 'id'), null);
    assert.equal(parseTemplate('x', 'id'), null);
  });

  it('parseTemplates descarta ids e nomes repetidos e respeita o limite', () => {
    const parsed = parseTemplates([
      template('a', 'API'),
      template('a', 'Outro'),
      template('b', 'API'),
      { id: 'c', name: 'Sem cwd' },
      template('d', 'Front', { color: 'green' }),
    ]);
    assert.deepEqual(parsed.map((t) => t.id), ['a', 'd']);
    assert.equal(parsed[1]?.color, 'green');
    const many = Array.from({ length: MAX_TEMPLATES + 5 }, (_, i) => template(`t${i}`, `T${i}`));
    assert.equal(parseTemplates(many).length, MAX_TEMPLATES);
    assert.deepEqual(parseTemplates('nao e lista'), []);
  });

  it('withTemplate: nome novo entra no fim; nome existente substitui mantendo id e posicao', () => {
    let list = withTemplate([], template('a', 'API'));
    list = withTemplate(list, template('b', 'Front'));
    list = withTemplate(list, template('c', 'API', { command: 'codex' }));
    assert.deepEqual(list.map((t) => [t.id, t.name, t.command]), [
      ['a', 'API', 'codex'],
      ['b', 'Front', 'claude'],
    ]);
  });

  it('withTemplate cheio descarta o mais antigo', () => {
    let list: TerminalTemplate[] = [];
    for (let i = 0; i <= MAX_TEMPLATES; i += 1) list = withTemplate(list, template(`t${i}`, `T${i}`));
    assert.equal(list.length, MAX_TEMPLATES);
    assert.equal(list[0]?.id, 't1');
  });

  it('config sem templates comeca com a lista vazia', () => {
    assert.deepEqual(parseConfig({}).templates, []);
    assert.equal(parseConfig({ templates: [template('a', 'API')] }).templates.length, 1);
  });
});
