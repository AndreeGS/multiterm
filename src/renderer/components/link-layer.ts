/** Um vinculo a desenhar: do card da nota/lista ao card do terminal, borda a borda. */
export interface LinkPair {
  readonly from: HTMLElement;
  readonly to: HTMLElement;
  /** Cor da linha: segue o estado do terminal. */
  readonly tone: 'normal' | 'attention' | 'notice';
  /** Cor do terminal (valor CSS), usada quando o tom e `normal`. */
  readonly color?: string;
}

interface Point {
  x: number;
  y: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * Depois de um clique, roda ou redimensionamento da janela, continua
 * redesenhando por este tempo: o zoom da area livre so reposiciona os paineis
 * ~140ms depois da ultima roda, e um painel trazido para a frente muda o que
 * cobre o que.
 */
const SETTLE_MS = 400;

/**
 * Camada SVG por cima dos paineis com as linhas de vinculo. Nao ouve eventos
 * (pointer-events: none) e desenha lendo a posicao real dos paineis, entao
 * acompanha arrasto, zoom, pan, troca de layout e de pagina sem cada um
 * desses lugares calcular nada. So escreve no DOM quando a geometria muda.
 *
 * Redesenha por frame so enquanto algo pode estar se mexendo: durante um
 * arrasto, a linha provisoria do 🔗 e um instante depois de cada clique ou
 * roda do mouse. Parado, nao custa nada; o App avisa (`invalidate`/`kick`)
 * quando paineis entram, saem ou mudam de estado.
 */
export class LinkLayer {
  readonly element = document.createElementNS(SVG_NS, 'svg');
  private enabled = true;
  /** Linha provisoria enquanto voce arrasta o 🔗 ate um terminal. */
  private draft: { from: Point; to: Point } | null = null;
  private signature = '';
  private frame = 0;
  /** Ate quando (performance.now) seguir redesenhando sem outro aviso. */
  private hotUntil = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly pairs: () => LinkPair[],
  ) {
    this.element.classList.add('link-layer');
    const kick = () => this.kick();
    for (const type of ['pointerdown', 'pointerup', 'wheel'] as const) {
      window.addEventListener(type, kick, { capture: true, passive: true });
    }
    window.addEventListener('resize', kick);
    // No proximo frame: quem fornece os pares ainda esta sendo construido.
    this.invalidate();
  }

  /** Redesenha uma vez, no proximo frame (ex.: um terminal mudou de estado e a linha, de cor). */
  invalidate(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  /** Algo comecou a se mexer: redesenha por frame ate assentar. */
  kick(): void {
    this.hotUntil = performance.now() + SETTLE_MS;
    this.invalidate();
  }

  private readonly tick = (): void => {
    this.frame = 0;
    const pairs = this.enabled ? this.pairs() : [];
    if (pairs.length === 0 && !this.draft) this.render('');
    else this.draw(pairs);
    const moving = this.draft !== null || document.body.classList.contains('dragging') || performance.now() < this.hotUntil;
    if (moving) this.frame = requestAnimationFrame(this.tick);
  };

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.invalidate();
  }

  /** Coordenadas de tela (clientX/Y); `null` apaga a linha provisoria. */
  setDraft(from: Point | null, to?: Point): void {
    this.draft = from && to ? { from, to } : null;
    this.invalidate();
  }

  private draw(pairs: LinkPair[]): void {
    const box = this.container.getBoundingClientRect();
    const shapes: string[] = [];

    for (const pair of pairs) {
      const a = visibleRect(pair.from);
      const b = visibleRect(pair.to);
      // Um card fora da tela, ou um em cima do outro: nao ha linha que faca sentido.
      if (!a || !b || overlaps(a, b)) continue;
      const [start, end] = facingSides(a, b);
      // Ponta coberta por outro card: a linha apontaria para algo que nao se ve.
      if (!visibleAt(pair.from, start) || !visibleAt(pair.to, end)) continue;
      shapes.push(connector(start, end, box, pair.tone, pair.color));
    }
    if (this.draft) {
      const { from, to } = this.draft;
      const f = { x: from.x - box.left, y: from.y - box.top };
      const t = { x: to.x - box.left, y: to.y - box.top };
      shapes.push(
        `<path class="link draft" d="M${f.x},${f.y} L${t.x},${t.y}"/>` +
        `<circle class="link-end draft" cx="${f.x}" cy="${f.y}" r="3.5"/>`,
      );
    }

    this.render(shapes.join(''));
  }

  private render(signature: string): void {
    if (signature === this.signature) return;
    this.signature = signature;
    this.element.innerHTML = signature;
  }
}

function visibleRect(element: HTMLElement): DOMRect | null {
  if (!element.isConnected || element.hidden) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/** Ponto na borda de um card, com a direcao (normal) do lado em que esta. */
interface Anchor extends Point {
  nx: number;
  ny: number;
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Meio dos lados que um card mostra para o outro: lado a lado liga direita
 * com esquerda; um acima do outro liga base com topo. Decide pela direcao
 * que mais separa os dois, proporcional ao tamanho deles.
 */
function facingSides(a: DOMRect, b: DOMRect): [Anchor, Anchor] {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) / (a.width + b.width) >= Math.abs(dy) / (a.height + b.height)) {
    const s = Math.sign(dx) || 1;
    return [
      { x: s > 0 ? a.right : a.left, y: ca.y, nx: s, ny: 0 },
      { x: s > 0 ? b.left : b.right, y: cb.y, nx: -s, ny: 0 },
    ];
  }
  const s = Math.sign(dy) || 1;
  return [
    { x: ca.x, y: s > 0 ? a.bottom : a.top, nx: 0, ny: s },
    { x: cb.x, y: s > 0 ? b.top : b.bottom, nx: 0, ny: -s },
  ];
}

/** O card e o que aparece logo para dentro da borda (nada por cima ali). */
function visibleAt(element: HTMLElement, at: Anchor): boolean {
  const hit = document.elementFromPoint(at.x - at.nx * 4, at.y - at.ny * 4);
  return hit !== null && (hit === element || element.contains(hit));
}

/** Curva que sai perpendicular de um card e chega perpendicular no outro. */
function connector(start: Anchor, end: Anchor, box: DOMRect, tone: LinkPair['tone'], color?: string): string {
  const reach = Math.max(30, Math.min(140, Math.hypot(end.x - start.x, end.y - start.y) / 2));
  const c1 = { x: start.x + start.nx * reach, y: start.y + start.ny * reach };
  const c2 = { x: end.x + end.nx * reach, y: end.y + end.ny * reach };
  const p = (pt: Point) => `${round(pt.x - box.left)},${round(pt.y - box.top)}`;
  // O estado (aguardando/pedido) vence a cor: e ele que pede acao.
  const stroke = tone === 'normal' && color ? ` style="stroke:${color}"` : '';
  const dot = (pt: Point) =>
    `<circle class="link-end ${tone}"${stroke} cx="${round(pt.x - box.left)}" cy="${round(pt.y - box.top)}" r="4"/>`;
  return `<path class="link ${tone}"${stroke} d="M${p(start)} C${p(c1)} ${p(c2)} ${p(end)}"/>` + dot(start) + dot(end);
}

function center(rect: DOMRect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
