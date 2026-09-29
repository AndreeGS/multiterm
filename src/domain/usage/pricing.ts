/**
 * Tabela de precos publica da API da Anthropic, em USD por milhao de tokens.
 * Fonte: https://platform.claude.com/docs/en/about-claude/pricing (set/2026).
 *
 * Os valores de cache sao absolutos, e nao multiplicadores, porque a taxa de
 * leitura varia por modelo (0.1x na maioria, 0.05x no Opus 5.5, 0.025x no
 * Fable 5.1). Serve para *estimar* custo a partir das transcricoes locais —
 * nao e fatura.
 */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly cacheRead: number;
}

function price(
  input: number,
  output: number,
  cacheWrite5m: number,
  cacheWrite1h: number,
  cacheRead: number,
): ModelPrice {
  return { input, output, cacheWrite5m, cacheWrite1h, cacheRead };
}

const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': price(10, 50, 12.5, 20, 0.25),
  'claude-mythos-5-1': price(10, 50, 12.5, 20, 0.25),
  'claude-fable-5': price(10, 50, 12.5, 20, 1),
  'claude-mythos-5': price(10, 50, 12.5, 20, 1),

  'claude-opus-5-5': price(4, 20, 5, 8, 0.2),
  'claude-opus-5': price(5, 25, 6.25, 10, 0.5),
  'claude-opus-4-8': price(5, 25, 6.25, 10, 0.5),
  'claude-opus-4-7': price(5, 25, 6.25, 10, 0.5),
  'claude-opus-4-6': price(5, 25, 6.25, 10, 0.5),
  'claude-opus-4-5': price(5, 25, 6.25, 10, 0.5),

  'claude-sonnet-5-5': price(2, 10, 2.5, 4, 0.2),
  'claude-sonnet-5': price(2, 10, 2.5, 4, 0.2),
  'claude-sonnet-4-6': price(3, 15, 3.75, 6, 0.3),
  'claude-sonnet-4-5': price(3, 15, 3.75, 6, 0.3),

  'claude-haiku-4-5': price(1, 5, 1.25, 2, 0.1),
};

const PER_MILLION = 1_000_000;

/**
 * Reduz um id a chave da tabela: remove sufixo de variante ("[1m]") e o
 * snapshot datado ("claude-haiku-4-5-20251001" -> "claude-haiku-4-5").
 */
export function normalizeModel(model: string): string {
  return model
    .replace(/\[[^\]]*\]$/, '')
    .replace(/-\d{8}$/, '')
    .trim();
}

export function priceOf(model: string): ModelPrice | null {
  return PRICES[normalizeModel(model)] ?? null;
}

export interface TokenCounts {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly cacheRead: number;
}

/** Custo estimado em USD. Modelo desconhecido custa 0 (e e reportado a parte). */
export function estimateCost(model: string, tokens: TokenCounts): number {
  const rate = priceOf(model);
  if (!rate) return 0;
  const dollarsPerMillion =
    tokens.input * rate.input +
    tokens.output * rate.output +
    tokens.cacheWrite5m * rate.cacheWrite5m +
    tokens.cacheWrite1h * rate.cacheWrite1h +
    tokens.cacheRead * rate.cacheRead;
  return dollarsPerMillion / PER_MILLION;
}
