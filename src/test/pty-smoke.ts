/**
 * Teste de integracao do nucleo: sobe um pty real, executa um comando,
 * confere o output e o ciclo de vida da sessao. Roda headless dentro do
 * Electron (node-pty e compilado para o ABI do Electron).
 *
 *   npm run smoke
 */
import { app } from 'electron';
import { tmpdir } from 'node:os';
import { TerminalService } from '../application/terminal/terminal-service.js';
import type { TerminalSnapshot } from '../domain/terminal/types.js';
import { NodePtyFactory } from '../infrastructure/terminal/node-pty-adapter.js';

const failures: string[] = [];

function check(label: string, ok: boolean): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
}

function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (predicate()) {
        clearInterval(tick);
        resolve(true);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(tick);
        resolve(false);
      }
    }, 50);
  });
}

async function run(): Promise<void> {
  let output = '';
  const updates: TerminalSnapshot[] = [];
  const closed: string[] = [];

  const service = new TerminalService(new NodePtyFactory(), {
    onData: (_id, chunk) => {
      output += chunk;
    },
    onUpdate: (snapshot) => updates.push(snapshot),
    onClose: (id) => closed.push(id),
  });

  const created = service.create({ name: 'smoke', cwd: tmpdir() });
  check('cria sessao com cwd resolvido', created.cwd === tmpdir());
  check('deriva shell do sistema', created.shell.length > 0);

  // Terminal novo imprime o prompt e fica quieto — isso nao e "aguardando voce".
  await waitFor(() => service.snapshot(created.id)?.status === 'idle');
  check(
    'terminal recem-criado nao pede atencao',
    service.snapshot(created.id)?.needsAttention === false,
  );

  // 1. comando simples: stdout chega pelo pty
  service.write(created.id, 'echo MULTITERM_OK\n');
  check('recebe stdout do shell', await waitFor(() => output.includes('MULTITERM_OK')));

  // 2. o pty tem tamanho de verdade (agentes e TUIs dependem disso)
  output = '';
  service.resize(created.id, { cols: 123, rows: 37 });
  service.write(created.id, 'echo COLS=$(tput cols) ROWS=$(tput lines)\n');
  check('resize propaga para o processo', await waitFor(() => output.includes('COLS=123 ROWS=37')));

  // 3. estado de atividade muda sozinho: running -> idle
  check(
    'marca running e depois idle',
    updates.some((u) => u.status === 'running') &&
      (await waitFor(() => updates.at(-1)?.status === 'idle')),
  );

  // 4. sinal de interrupcao chega ao processo em foreground
  output = '';
  service.write(created.id, 'sleep 30\n');
  await waitFor(() => output.includes('sleep 30'));
  service.interrupt(created.id);
  output = '';
  service.write(created.id, 'echo BACK_AT_PROMPT\n');
  // Se o Ctrl-C nao tivesse matado o `sleep 30`, este echo so apareceria em 30s.
  check(
    'interrupt encerra o processo em foreground',
    await waitFor(() => output.includes('BACK_AT_PROMPT'), 5000) &&
      service.snapshot(created.id)?.status !== 'error',
  );

  // 5. restart preserva id/nome e devolve um shell vivo
  service.restart(created.id);
  await waitFor(() => service.snapshot(created.id)?.status === 'idle');
  output = '';
  service.write(created.id, 'echo AFTER_RESTART\n');
  check('shell responde apos restart', await waitFor(() => output.includes('AFTER_RESTART')));
  check('restart preserva identidade', service.snapshot(created.id)?.name === 'smoke');

  // 6. buffer de replay alimenta a UI ao reanexar
  check('mantem buffer de replay', service.replay(created.id).includes('AFTER_RESTART'));

  // 8. rename e close
  // 7. sinal de atencao: sobe quando o terminal para, some quando voce olha
  check(
    'pede atencao ao ficar ocioso',
    await waitFor(() => service.snapshot(created.id)?.needsAttention === true),
  );
  service.acknowledge(created.id);
  check('acknowledge limpa o pedido', service.snapshot(created.id)?.needsAttention === false);
  output = '';
  service.write(created.id, 'echo DE_NOVO\n');
  await waitFor(() => output.includes('DE_NOVO'));
  check(
    'volta a pedir atencao no proximo silencio',
    await waitFor(() => service.snapshot(created.id)?.needsAttention === true),
  );

  service.rename(created.id, 'renomeado');
  check('renomeia sessao', service.snapshot(created.id)?.name === 'renomeado');

  service.close(created.id);
  check('fecha e remove do workspace', closed.includes(created.id) && service.list().length === 0);

  // 9. Regressao: o pty emite `exit` depois do dispose. Se a sessao ainda
  // estivesse ouvindo, ela emitiria um update com needsAttention=true para um
  // terminal ja fechado — e o contador "N aguardando" travava alto para sempre.
  const updatesAfterClose = updates.filter((u) => u.id === created.id).length;
  await waitFor(() => false, 1200);
  const zombies = updates.filter((u) => u.id === created.id).length - updatesAfterClose;
  check(`nao emite update apos fechar (recebidos: ${zombies})`, zombies === 0);
}

void app.whenReady().then(async () => {
  try {
    await run();
  } catch (error) {
    console.error(error);
    failures.push('excecao nao tratada');
  }
  console.log(failures.length === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${failures.length} FALHA(S)`);
  app.exit(failures.length === 0 ? 0 : 1);
});
