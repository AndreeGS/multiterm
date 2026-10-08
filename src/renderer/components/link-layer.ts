/**
 * Um vinculo a desenhar: do 🔗 da nota/lista ate o ponto de status no
 * cabecalho do terminal. Ligar elementos pequenos (e nao as bordas dos
 * paineis) mantem a linha visivel mesmo com paineis vizinhos na grade ou
 * empilhados na area livre, e deixa claro qual 🔗 vai para qual terminal.
 */
export interface LinkPair {
  readonly from: HTMLElement;
  readonly to: HTMLElement;
  /** Cor da linha: segue o estado do terminal. */
  readonly tone: 'normal' | 'attention' | 'notice';
}

interface Point {
  x: number;
  y: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Camada SVG por cima dos paineis com as linhas de vinculo. Nao ouve eventos
 * (pointer-events: none) e se redesenha a cada frame lendo a posicao real dos
 * paineis — assim acompanha arrasto, zoom, pan, troca de layout e de pagina
 * sem cada um desses lugares precisar avisar. So escreve no DOM quando a
 * geometria muda.
 */
export class LinkLayer {
  readonly element = document.createElementNS(SVG_NS, 'svg');
  private enabled = true;
  /** Linha provisoria enquanto voce arrasta o 🔗 ate um terminal. */
  private draft: { from: Point; to: Point } | null = null;
  private signature = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly pairs: () => LinkPair[],
  ) {
    this.element.classList.add('link-layer');
    const loop = () => {
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Coordenadas de tela (clientX/Y); `null` apaga a linha provisoria. */
  setDraft(from: Point | null, to?: Point): void {
    this.draft = from && to ? { from, to } : null;
  }

  private draw(): void {
    const box = this.container.getBoundingClientRect();
    const shapes: string[] = [];

    if (this.enabled) {
      for (const pair of this.pairs()) {
        const a = visibleRect(pair.from);
        const b = visibleRect(pair.to);
        // Um dos lados fora da tela, ou coberto por outro painel: sem linha
        // apontando para algo que nao se ve.
        if (!a || !b || !onTop(pair.from, a) || !onTop(pair.to, b)) continue;
        // Sai da borda do 🔗 (o anel nao cobre o nome) e chega no centro do ponto de status.
        shapes.push(connector(edgeToward(a, center(b)), center(b), box, pair.tone));
      }
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

    const signature = shapes.join('');
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

/**
 * Curva suave: sai e chega na horizontal quando os pontos estao mais lado a
 * lado, e na vertical quando estao mais um sobre o outro.
 */
function connector(start: Point, end: Point, box: DOMRect, tone: LinkPair['tone']): string {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const reach = Math.max(30, Math.min(120, Math.hypot(dx, dy) / 2));
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const c1 = horizontal
    ? { x: start.x + Math.sign(dx) * reach, y: start.y }
    : { x: start.x, y: start.y + Math.sign(dy) * reach };
  const c2 = horizontal
    ? { x: end.x - Math.sign(dx) * reach, y: end.y }
    : { x: end.x, y: end.y - Math.sign(dy) * reach };
  const p = (pt: Point) => `${round(pt.x - box.left)},${round(pt.y - box.top)}`;
  return (
    `<path class="link ${tone}" d="M${p(start)} C${p(c1)} ${p(c2)} ${p(end)}"/>` +
    `<circle class="link-end ${tone}" cx="${round(start.x - box.left)}" cy="${round(start.y - box.top)}" r="3"/>` +
    `<circle class="link-end ${tone}" cx="${round(end.x - box.left)}" cy="${round(end.y - box.top)}" r="5.5"/>`
  );
}

function center(rect: DOMRect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Onde a reta do centro de `rect` ate `toward` cruza a borda dele. */
function edgeToward(rect: DOMRect, toward: Point): Point {
  const c = center(rect);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const scale = Math.min(
    dx === 0 ? Infinity : rect.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : rect.height / 2 / Math.abs(dy),
  );
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** O elemento e o que esta de fato visivel no seu centro (nada por cima). */
function onTop(element: HTMLElement, rect: DOMRect): boolean {
  const { x, y } = center(rect);
  const hit = document.elementFromPoint(x, y);
  return hit !== null && (hit === element || element.contains(hit) || hit.contains(element));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
