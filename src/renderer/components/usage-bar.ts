import { totalTokens, type ModelBreakdown, type UsageSummary } from '../../domain/usage/types.js';
import type { MultiTermApi } from '../../shared/contract.js';

/**
 * Consumo local de tokens do Claude Code, lido das transcricoes em ~/.claude.
 *
 * Deliberadamente rotulado como "consumo": o percentual do limite semanal/diario
 * do plano nao existe em nenhum arquivo local — vem do servidor, e so o
 * `/usage` dentro do Claude Code mostra.
 */
export class UsageBar {
  readonly element = document.createElement('div');
  private readonly todayEl = document.createElement('span');
  private readonly weekEl = document.createElement('span');

  constructor(private readonly api: MultiTermApi) {
    this.element.className = 'usage';
    this.element.hidden = true;
    this.element.append(this.todayEl, divider(), this.weekEl);

    this.element.addEventListener('click', () => this.api.refreshUsage());

    this.api.onUsageUpdate((summary) => this.render(summary));
    void this.api.getUsage().then((summary) => this.render(summary));
  }

  private render(summary: UsageSummary): void {
    if (!summary.available) {
      this.element.hidden = true;
      return;
    }
    this.element.hidden = false;

    this.todayEl.innerHTML =
      `<b>Hoje</b> ${formatTokens(totalTokens(summary.today))} · ${money(summary.today.costUsd)}`;
    this.weekEl.innerHTML =
      `<b>7 dias</b> ${formatTokens(totalTokens(summary.week))} · ${money(summary.week.costUsd)}`;

    this.element.title = buildTooltip(summary);
  }
}

function buildTooltip(summary: UsageSummary): string {
  const lines = [
    'Consumo de tokens do Claude Code nesta maquina.',
    'Nao e percentual do limite do plano — esse dado so existe no servidor (/usage).',
    '',
    `Hoje: ${summary.today.requests} requisicoes`,
    ...summary.todayByModel.map(describe),
    '',
    `7 dias: ${summary.week.requests} requisicoes`,
    ...summary.weekByModel.map(describe),
  ];

  if (summary.unpricedModels.length > 0) {
    lines.push('', `Sem preco na tabela (custo nao contabilizado): ${summary.unpricedModels.join(', ')}`);
  }
  lines.push('', 'Custo estimado pela tabela publica da API. Clique para atualizar agora.');
  lines.push(`Atualizado as ${new Date(summary.updatedAt).toLocaleTimeString('pt-BR')}.`);
  return lines.join('\n');
}

function describe({ model, totals }: ModelBreakdown): string {
  const parts = [
    `in ${formatTokens(totals.inputTokens)}`,
    `out ${formatTokens(totals.outputTokens)}`,
    `cache w ${formatTokens(totals.cacheWriteTokens)}`,
    `r ${formatTokens(totals.cacheReadTokens)}`,
  ];
  return `  ${model}: ${money(totals.costUsd)}  (${parts.join(', ')})`;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return `${value}`;
}

export function money(value: number): string {
  return `US$ ${value.toFixed(2).replace('.', ',')}`;
}

function divider(): HTMLElement {
  const node = document.createElement('span');
  node.className = 'usage-divider';
  node.textContent = '|';
  return node;
}
