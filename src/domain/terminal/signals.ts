import { hostname } from 'node:os';
import { parseOsc7, parseShellMark, type ShellMark } from './shell-integration.js';

/**
 * Detecta pedidos explicitos de atencao no fluxo de bytes do pty:
 *
 * - BEL (`\x07`) solto, fora de uma sequencia OSC — o "terminal_bell" do
 *   Claude Code e o `\a` de qualquer script;
 * - notificacoes de terminal: OSC 9 (iTerm2), OSC 777 (urxvt/Ghostty) e
 *   OSC 99 (kitty), que trazem uma mensagem.
 *
 * O BEL tambem e o terminador de OSC (ex.: `\x1b]0;titulo\x07`, que o Claude
 * Code emite o tempo todo para trocar o titulo), entao as sequencias precisam
 * ser descartadas antes de procurar o BEL. Chunks do pty cortam sequencias no
 * meio; por isso o scanner guarda estado entre chamadas.
 */
export class SignalScanner {
  /** Fora de escape, logo apos ESC, dentro de um OSC, ou ESC dentro do OSC. */
  private state: 'text' | 'esc' | 'osc' | 'osc-esc' = 'text';
  private osc = '';
  /** Marcas de prompt (OSC 133) achadas desde o ultimo `takeMarks()`, em ordem. */
  private marks: ShellMark[] = [];
  /** Ultimo diretorio informado pelo shell (OSC 7) ainda nao lido. */
  private cwd: string | null = null;

  constructor(private readonly host: string = hostname()) {}

  /** Devolve e esquece o ultimo diretorio informado pelo shell. */
  takeCwd(): string | null {
    const cwd = this.cwd;
    this.cwd = null;
    return cwd;
  }

  /** Devolve e esquece as marcas de prompt vistas nos ultimos `scan()`. */
  takeMarks(): ShellMark[] {
    if (this.marks.length === 0) return NO_MARKS;
    const marks = this.marks;
    this.marks = [];
    return marks;
  }

  /** Devolve o sinal mais relevante do chunk: mensagem > BEL > nada. */
  scan(chunk: string): string | null {
    let found: string | null = null;
    for (let i = 0; i < chunk.length; i += 1) {
      const ch = chunk[i]!;
      switch (this.state) {
        case 'text':
          if (ch === '\x1b') this.state = 'esc';
          else if (ch === '\x07') found ??= BELL;
          break;
        case 'esc':
          if (ch === ']') {
            this.state = 'osc';
            this.osc = '';
          } else {
            this.state = ch === '\x1b' ? 'esc' : 'text';
          }
          break;
        case 'osc':
          if (ch === '\x07') found = this.finishOsc() ?? found;
          else if (ch === '\x1b') this.state = 'osc-esc';
          else if (this.osc.length < MAX_OSC) this.osc += ch;
          break;
        case 'osc-esc':
          // ESC \ (ST) termina o OSC; qualquer outra coisa aborta a sequencia.
          if (ch === '\\') {
            found = this.finishOsc() ?? found;
          } else {
            this.osc = '';
            this.state = ch === ']' ? 'osc' : 'text';
          }
          break;
      }
    }
    return found;
  }

  private finishOsc(): string | null {
    this.state = 'text';
    const osc = this.osc;
    this.osc = '';
    if (osc.startsWith('7;')) {
      this.cwd = parseOsc7(osc.slice(2), this.host) ?? this.cwd;
      return null;
    }
    if (osc.startsWith('133;')) {
      const mark = parseShellMark(osc.slice(4));
      if (mark) this.marks.push(mark);
      return null;
    }
    return notificationText(osc);
  }
}

const NO_MARKS: ShellMark[] = [];

/** Texto usado quando o sinal e um BEL, sem mensagem. */
export const BELL = 'pediu sua atencao';

const MAX_OSC = 2048;

/** Extrai a mensagem de um OSC de notificacao; `null` para os demais OSC. */
export function notificationText(osc: string): string | null {
  const sep = osc.indexOf(';');
  if (sep < 0) return null;
  const code = osc.slice(0, sep);
  const rest = osc.slice(sep + 1);

  if (code === '9') {
    // OSC 9;4;... e barra de progresso (ConEmu/Windows Terminal), nao notificacao.
    if (/^\d+;/.test(rest)) return null;
    return clean(rest) || BELL;
  }
  if (code === '777') {
    // OSC 777;notify;titulo;corpo
    const [kind, title = '', ...body] = rest.split(';');
    if (kind !== 'notify') return null;
    return clean(body.join(';')) || clean(title) || BELL;
  }
  if (code === '99') {
    // OSC 99;metadados;texto (kitty). O texto pode vir em partes; usa a que chegou.
    const textSep = rest.indexOf(';');
    return clean(textSep < 0 ? '' : rest.slice(textSep + 1)) || BELL;
  }
  return null;
}

function clean(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}
