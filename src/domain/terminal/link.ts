/**
 * Vinculo de uma nota/lista de tarefas com um terminal, pelo id do terminal.
 * O id sobrevive ao reinicio do app (a sessao restaurada reusa o id salvo),
 * entao o vinculo tambem sobrevive.
 */
export function parseTerminalId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 64 ? raw : null;
}
