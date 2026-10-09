import type { WorktreeInfo } from '../git/worktree.js';
import type { PaneColor } from '../workspace/colors.js';

/**
 * Estado de atividade de um terminal.
 * Deliberadamente "burro": nao tenta interpretar o que o agente esta fazendo,
 * apenas observa o fluxo de bytes do pty e o ciclo de vida do processo.
 */
export type TerminalStatus =
  | 'starting' // pty criado, ainda sem output
  | 'running'  // produziu output recentemente
  | 'idle'     // vivo, mas silencioso (provavelmente aguardando interacao)
  | 'exited'   // processo terminou com codigo 0
  | 'error';   // processo terminou com codigo != 0 ou falhou ao iniciar

export interface TerminalSpec {
  /** Nome exibido. Se vazio, deriva do basename do cwd. */
  readonly name: string;
  /** Diretorio de trabalho inicial (absoluto). */
  readonly cwd: string;
  /** Shell a executar. Se ausente, usa o shell padrao do sistema. */
  readonly shell?: string;
  /** Digitado no shell quando ele fica pronto (ex.: `claude`). Vazio = nenhum. */
  readonly command?: string;
  /** Cor de destaque no cabecalho. Ausente = sem cor. */
  readonly color?: PaneColor | null;
  /**
   * Conversa do Claude Code deste terminal (UUID). Com ele, o `claude` do
   * comando inicial abre/retoma sempre a mesma conversa, e o consumo de
   * tokens pode ser atribuido ao terminal.
   */
  readonly claudeSession?: string | null;
  /** Worktree onde o terminal roda (o cwd e a pasta dele). Quem cria e o main. */
  readonly worktree?: WorktreeInfo | null;
  /** Workspace a que pertence. Ausente = o padrao. */
  readonly workspaceId?: string;
}

/** Projecao serializavel de uma sessao, enviada ao renderer. */
export interface TerminalSnapshot {
  readonly id: string;
  readonly name: string;
  readonly cwd: string;
  readonly shell: string;
  /** Comando inicial, repetido a cada restart. `null` = so o shell. */
  readonly command: string | null;
  readonly color: PaneColor | null;
  /** Conversa do Claude Code acompanhada neste terminal; `null` = nenhuma. */
  readonly claudeSession: string | null;
  /** Worktree isolado do terminal; `null` = roda direto no diretorio. */
  readonly worktree: WorktreeInfo | null;
  readonly workspaceId: string;
  readonly status: TerminalStatus;
  readonly exitCode: number | null;
  readonly createdAt: number;
  /**
   * O terminal parou de produzir output (ou o processo saiu) e voce ainda nao
   * olhou para ele. E o sinal de "este agente devolveu o controle".
   */
  readonly needsAttention: boolean;
  /**
   * O processo pediu atencao explicitamente (BEL ou notificacao OSC 9/777/99),
   * com a mensagem que mandou. Mais forte que o silencio: so some quando voce
   * olha ou digita, nao quando o agente volta a imprimir.
   */
  readonly notice: string | null;
}

/**
 * Output retido de uma sessao. `seq` e o numero do ultimo chunk incluido: a UI
 * descarta os chunks ao vivo com `seq` menor ou igual, que ja vieram aqui.
 */
export interface ReplaySnapshot {
  readonly data: string;
  readonly seq: number;
}

export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}
