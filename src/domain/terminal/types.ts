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
}

/** Projecao serializavel de uma sessao, enviada ao renderer. */
export interface TerminalSnapshot {
  readonly id: string;
  readonly name: string;
  readonly cwd: string;
  readonly shell: string;
  readonly status: TerminalStatus;
  readonly exitCode: number | null;
  readonly createdAt: number;
  /**
   * O terminal parou de produzir output (ou o processo saiu) e voce ainda nao
   * olhou para ele. E o sinal de "este agente devolveu o controle".
   */
  readonly needsAttention: boolean;
}

export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}
