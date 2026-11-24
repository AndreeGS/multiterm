import type { TerminalSnapshot } from './types.js';

/**
 * Ordem do painel de agentes: o que precisa de voce primeiro.
 *
 * 0. pedido de permissao em aberto (ou pedido explicito do processo);
 * 1. aguardando voce, do que espera ha mais tempo para o mais recente;
 * 2. Claude trabalhando;
 * 3. demais agentes;
 * 4. terminais comuns.
 *
 * Dentro do mesmo grupo vale a ordem de criacao.
 */
export function overviewRank(snapshot: TerminalSnapshot): number {
  if (snapshot.pendingPermission || snapshot.notice !== null) return 0;
  if (snapshot.needsAttention) return 1;
  if (snapshot.agent?.phase === 'working') return 2;
  if (snapshot.agent) return 3;
  return 4;
}

export function sortForOverview<T extends { readonly info: TerminalSnapshot }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const rank = overviewRank(a.info) - overviewRank(b.info);
    if (rank !== 0) return rank;
    if (overviewRank(a.info) <= 1) {
      const waited = (a.info.attentionSince ?? Infinity) - (b.info.attentionSince ?? Infinity);
      if (waited !== 0 && Number.isFinite(waited)) return waited;
    }
    return a.info.createdAt - b.info.createdAt;
  });
}
