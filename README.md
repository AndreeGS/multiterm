# MultiTerm

Central visual para executar e acompanhar varios terminais/agentes ao mesmo tempo
(Claude Code, Codex CLI, Gemini CLI, `npm run dev`, `docker compose up`, ...).

Nao e um substituto do terminal do sistema: e um painel unico onde cada projeto
tem o seu shell real, com indicador de atividade.

## Stack

| Camada | Escolha | Motivo |
| --- | --- | --- |
| Shell real | [`node-pty`](https://github.com/microsoft/node-pty) | PTY de verdade em Linux/macOS/Windows (ConPTY). Da stdin/stdout/stderr, sinais, resize e job control — o mesmo que o VS Code usa. |
| Emulador | [`xterm.js`](https://xtermjs.org) | ANSI, 256/true color, cursor, mouse, scrollback, links. |
| Desktop | Electron | Multiplataforma, acesso direto a processos do SO, uma unica janela. |
| Build | esbuild | Build completo em ~80ms, um arquivo de configuracao. |

## Instalacao

```bash
npm install       # compila o node-pty para o ABI do Electron (postinstall)
npm run app:install
```

`app:install` integra o app ao Linux, sem sudo e sem tocar em `/usr`:

- atalho no menu de aplicativos, com icone (`~/.local/share/applications`)
- comando `multiterm`, chamavel de qualquer diretorio (`~/.local/bin`)
- icones 64/128/256/512 no tema hicolor

Depois disso e so procurar "MultiTerm" no menu, ou digitar `multiterm`.
Para desfazer: `npm run app:uninstall`.

O lancador (`bin/multiterm`) compila o bundle se estiver faltando e detecta se o
`chrome-sandbox` tem setuid root — se nao tiver, ele mesmo passa `--no-sandbox`,
entao o Chromium nunca aborta na sua cara. Se preferir o sandbox ligado, ajuste
uma vez:

```bash
sudo chown root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Outros comandos:

```bash
npm start          # roda direto do diretorio do projeto
npm run dev        # abre com DevTools
npm run typecheck  # tsc --noEmit
npm run smoke      # teste de integracao do PTY (headless, dentro do Electron)
```

## Atalhos

| Atalho | Acao |
| --- | --- |
| `Ctrl+T` | Novo terminal (fora do foco de um terminal) |
| `Ctrl+Shift+T` | Novo terminal (sempre) |
| `Ctrl+Shift+W` | Fechar o terminal em foco |
| `Ctrl+Shift+M` | Maximizar / restaurar o terminal em foco |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copiar / colar (o `Ctrl+C` puro continua sendo SIGINT) |
| Duplo clique no nome | Renomear |

Botoes de cada painel: `■` interromper (Ctrl+C), `⟳` reiniciar o shell,
`⤢` maximizar, `✕` fechar.

## Indicador de atividade

O ponto colorido no cabecalho reflete o fluxo de bytes do PTY e o ciclo de vida
do processo — sem interpretar o que o agente esta fazendo:

| Cor | Estado |
| --- | --- |
| azul | iniciando |
| verde | produzindo output agora |
| ambar | vivo e silencioso (provavelmente aguardando interacao) |
| cinza | processo saiu com codigo 0 |
| vermelho | processo saiu com codigo != 0, ou falhou ao iniciar |

Limitacao conhecida: um comando que roda muito tempo sem imprimir nada
(`sleep 60`) aparece como ambar. Ver "Proximos passos".

### Aviso de agente ocioso

Quando um terminal para de produzir output (ou o processo sai), ele passa a
pedir atencao — que e o momento em que um agente normalmente devolve o controle
para voce:

- o painel ganha borda ambar e o ponto de status pulsa;
- a barra superior mostra `● N aguardando`; clicar percorre esses terminais,
  trocando de pagina se preciso;
- se a janela **nao** estiver em foco, sai uma notificacao nativa do sistema,
  o icone pisca na barra de tarefas e o contador aparece no badge.

O pedido some assim que voce foca o terminal, ou se ele voltar a produzir
output. Nada disso tenta interpretar o que o agente esta fazendo.

Duas regras evitam aviso falso:

- **Um terminal recem-criado nunca pede atencao.** O prompt do shell faz a
  sessao ficar ociosa logo de cara, mas nada foi executado ali. A sessao so
  "arma" o aviso depois que voce escreve algo nela (e desarma no restart).
- **Uma sessao descartada para de emitir eventos.** O `exit` do pty chega
  depois do `dispose()`; sem essa trava ele emitia um update para um terminal
  ja fechado e o contador "N aguardando" travava alto para sempre.

Ambas tem teste de regressao em `src/test/pty-smoke.ts`.

## Consumo de tokens

A barra superior agrega as transcricoes locais do Claude Code
(`~/.claude/projects/**/*.jsonl`, ou `$CLAUDE_CONFIG_DIR`) e mostra tokens e
custo estimado de hoje e dos ultimos 7 dias. O tooltip abre o detalhe por
modelo; clicar atualiza na hora (tambem atualiza sozinho a cada minuto).

Leitura incremental — cada arquivo e lido so a partir de onde parou, em
streaming, e arquivos sem escrita recente sao ignorados. Na pratica: ~150ms na
primeira passada e ~4ms nas seguintes, sem travar a interface.

**Isto e consumo, nao percentual do limite do plano.** O quanto do limite
semanal/diario ja foi usado nao existe em nenhum arquivo local: vem do servidor,
e so o `/usage` dentro do Claude Code mostra. O custo e estimado pela tabela
publica de precos da API (`src/domain/usage/pricing.ts`) — nao e fatura, e
precisa de atualizacao quando saem modelos novos. Modelos fora da tabela contam
tokens, mas nao custo, e sao listados no tooltip.

## Persistencia

Um unico `config.json` em `app.getPath('userData')`
(`~/.config/MultiTerm/config.json` no Linux), com tamanho/posicao da janela,
layout escolhido e diretorios recentes. Escrita atomica, sem banco de dados.
O historico dos terminais nao e persistido.

## Arquitetura

```text
src/
  domain/          regras e tipos, sem Electron e sem node-pty
    terminal/      TerminalSession (ciclo de vida, atividade, replay), porta Pty
    workspace/     layouts e formato do config.json
  application/     casos de uso (orquestram o dominio)
    terminal/      TerminalService — unico dono do conjunto de sessoes
    workspace/     WorkspaceService — preferencias, com save debounced
  infrastructure/  adaptadores concretos
    terminal/      NodePtyFactory implementa a porta Pty
    persistence/   JsonConfigStore
  main/            processo principal do Electron: janela + IPC + wiring
  renderer/        UI (xterm, grade, toolbar, dialogo)
  shared/          contrato de IPC tipado, compartilhado pelos tres bundles
  test/            teste de integracao do PTY
```

Regras que mantem o acoplamento baixo:

- `domain` nao importa nada de Electron nem de `node-pty`; depende da interface
  `Pty`. E por isso que o `TerminalService` e testavel com um PTY falso.
- O renderer nao tem acesso a Node: `contextIsolation` ligado e uma API unica
  exposta pelo `preload`, tipada em `shared/contract.ts`.
- Nada e executado automaticamente. O app so sobe o shell que voce pediu, no
  diretorio que voce escolheu.

## Proximos passos naturais

- Atividade mais precisa lendo o processo em foreground do PTY
  (`IPty.process` no Unix) em vez de so o fluxo de bytes.
- Reabrir os terminais da sessao anterior a partir do `config.json`.
- Comando inicial opcional por terminal (ex.: ja subir `claude` ao criar).
- Rotear o output por um `Map<id, painel>` em vez de cada painel filtrar todos
  os chunks, e agrupar os `webContents.send` em janelas de ~16ms.
- Confirmacao ao fechar um terminal com processo em execucao.
- Busca no scrollback (`@xterm/addon-search`).
