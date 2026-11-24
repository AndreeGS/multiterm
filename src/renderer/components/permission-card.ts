import type { PermissionAnswer, PermissionAsk } from '../../domain/terminal/agent.js';
import { el } from './panel.js';

/**
 * Cartao de um pedido de permissao do Claude: a ferramenta, o que ela vai
 * fazer e Permitir / Negar / No terminal. O mesmo pedido aparece no dialogo do
 * proprio Claude, no terminal; vale quem responder primeiro.
 *
 * O texto vem do agente: entra sempre por `textContent`, nunca como HTML.
 */
export function permissionCard(
  ask: PermissionAsk,
  onAnswer: (answer: PermissionAnswer) => void,
  compact = false,
): HTMLElement {
  const card = el('div', compact ? 'permission-card compact' : 'permission-card');
  card.setAttribute('role', 'alert');

  const title = el('div', 'permission-title');
  title.textContent = `Claude quer usar ${ask.tool}`;
  const summary = el('code', 'permission-summary');
  summary.textContent = ask.summary;
  summary.title = ask.summary;

  const actions = el('div', 'permission-actions');
  const allow = el('button', 'primary');
  allow.textContent = 'Permitir';
  allow.title = 'Permitir so esta vez';
  const deny = el('button', 'danger');
  deny.textContent = 'Negar';
  deny.title = 'Negar: o Claude recebe a recusa e segue';
  const terminal = el('button', '');
  terminal.textContent = 'No terminal';
  terminal.title = 'Responder no dialogo do proprio Claude (com as outras opcoes dele)';
  allow.addEventListener('click', () => onAnswer('allow'));
  deny.addEventListener('click', () => onAnswer('deny'));
  terminal.addEventListener('click', () => onAnswer('release'));
  // Clicar no cartao nao pode virar clique no terminal (foco, selecao) atras dele.
  card.addEventListener('mousedown', (event) => event.stopPropagation());
  card.addEventListener('click', (event) => event.stopPropagation());
  actions.append(allow, deny, terminal);

  card.append(title, summary, actions);
  return card;
}
