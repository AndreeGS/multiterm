/**
 * Cor de destaque de um terminal (e, depois, de grupos na area livre). Guarda
 * a chave, nao o hex: cada tema define o tom em `--pane-<cor>` no styles.css,
 * para a mesma cor funcionar no fundo escuro e no papel pardo.
 */
export const PANE_COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'teal', 'gray'] as const;
export type PaneColor = (typeof PANE_COLORS)[number];

export const PANE_COLOR_NAMES: Record<PaneColor, string> = {
  blue: 'Azul',
  green: 'Verde',
  amber: 'Ambar',
  red: 'Vermelho',
  purple: 'Roxo',
  teal: 'Turquesa',
  gray: 'Cinza',
};

export function isPaneColor(value: unknown): value is PaneColor {
  return typeof value === 'string' && (PANE_COLORS as readonly string[]).includes(value);
}

/** Valor vindo do disco ou do IPC: qualquer coisa fora da lista vira "sem cor". */
export function parsePaneColor(raw: unknown): PaneColor | null {
  return isPaneColor(raw) ? raw : null;
}
