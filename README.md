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
| `Ctrl+Shift+N` | Novo bloco de notas |
| `Ctrl+Shift+L` | Nova lista de tarefas |
| `Ctrl+Shift+W` | Fechar o painel em foco |
| `Ctrl+Shift+M` | Maximizar / restaurar o painel em foco |
| `Ctrl+,` | Configuracoes (tema e tamanho da fonte) |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copiar / colar (o `Ctrl+C` puro continua sendo SIGINT) |
| Duplo clique no nome | Renomear |

Botoes de cada painel: `■` interromper (Ctrl+C), `⟳` reiniciar o shell,
`⤢` maximizar, `✕` fechar.

## Configuracoes

O botao `⚙` na barra superior (ou `Ctrl+,`) abre as configuracoes. Tudo e
aplicado na hora e fica salvo no `config.json`:

- **Tema**: *Escuro* (o original) ou *Papel pardo*, um bege claro em tom de
  papel kraft. No tema claro o xterm usa uma paleta ANSI escurecida e corrige o
  contraste de cores que os programas pintam por conta propria
  (`minimumContrastRatio`), para nada sumir no fundo claro;
- **Fonte dos terminais e notas**: de 9 a 24px. Na area livre o zoom continua
  multiplicando por cima;
- **Tamanho da interface**: 90% a 140% para barra, cabecalhos e dialogos.

As cores da UI sao variaveis CSS em `renderer/styles.css` (`:root` e
`:root[data-theme="paper"]`); as do xterm ficam em `renderer/theme.ts`, porque
ele pinta num canvas e nao enxerga CSS.

## Layouts

Os botoes de layout na barra superior mostram a forma de cada um:

| Layout | Forma |
| --- | --- |
| 1, 2 | um painel / dois lado a lado |
| 3 | um painel de altura inteira a esquerda, dois empilhados a direita |
| 4, 6, 8 | grades 2x2, 3x2, 4x2 |
| Livre | area livre com paineis flutuantes (ver abaixo) |

Nas grades, **as divisorias entre os paineis sao arrastaveis**; duplo clique
numa divisoria volta as proporcoes para iguais. As proporcoes ficam salvas por
layout no `config.json`.

Quando ha mais paineis do que cabem, a grade pagina. Uma pagina incompleta usa
a menor grade que comporta o que sobrou (3 paineis no layout 4 aparecem na
forma do layout 3) em vez de deixar celulas vazias.

### Area livre

O fundo vira um plano infinito, e cada painel e uma janela flutuante:

- arrastar o **cabecalho** move o painel; a **quina inferior direita** redimensiona;
- clicar num painel traz ele para a frente;
- arrastar o **fundo** (ou usar a roda do mouse nele) move a vista;
- **texto solto**: duplo clique no fundo (ou o botao `T`) escreve direto no
  plano, sem painel (ver abaixo);
- **zoom**: `Ctrl` + roda do mouse (ancorado no cursor, funciona ate em cima
  de um painel) ou os botoes `−` / `+` no canto inferior direito, de 30% a 200%.
  Clicar na porcentagem volta a 100%; `Ajustar` enquadra todos os paineis;
- `⤢` maximiza o painel ocupando a vista inteira (sempre em 100%).

O zoom e "semantico": em vez de um `transform: scale` (que borra o texto e
desalinha o mouse das celulas do xterm), posicao e tamanho dos paineis sao
multiplicados pelo zoom e cada painel ajusta a propria fonte. Selecao e clique
no terminal continuam precisos em qualquer zoom, e como fonte e painel escalam
juntos, o numero de colunas/linhas do shell praticamente nao muda.

A posicao das notas e dos terminais na area livre e salva, assim como o pan e
o zoom da vista.

#### Texto solto

Para titulos e anotacoes rapidas no quadro, sem abrir um bloco de notas:

- duplo clique no fundo cria um texto ali e ja entra em edicao (`Enter` quebra
  linha; `Esc` ou clicar fora termina);
- arrastar move; clicar sem arrastar volta a editar;
- passando o mouse aparecem `A−` / `A+` (tamanho, de 12 a 64px) e `✕` (apagar).
  Um texto que fica vazio some sozinho;
- os textos ficam sempre por baixo dos paineis, acompanham o zoom e entram no
  `Ajustar`. So aparecem na area livre — nas grades nao ha onde po-los.

Ao abrir o app, se havia terminais na sessao anterior, aparece o botao
**⟲ Restaurar sessao (N)** na barra: ele reabre cada terminal com o mesmo nome,
diretorio, shell e posicao — mas com um shell novo, os processos nao
sobrevivem ao fechamento. O ✕ ao lado descarta a sessao. Enquanto voce nao
escolher, ela continua guardada.

## Bloco de notas

`+ Nota` (ou `Ctrl+Shift+N`) abre um painel de texto puro ao lado dos
terminais, para comandos, TODOs, anotacoes de um agente etc. Funciona em
qualquer layout, igual a um terminal (maximizar, renomear com duplo clique).

- Salva sozinho enquanto voce digita, em `notes.json` ao lado do `config.json`,
  e as notas reabrem quando o app inicia.
- `Tab` indenta; `⧉` copia o texto inteiro.
- Fechar (`✕`) **apaga** a nota; se ela tiver conteudo, o app pede confirmacao.

## Lista de tarefas

`+ Tarefas` (ou `Ctrl+Shift+L`) abre um painel de checklist, para ir anotando
o que falta e marcando o que ja foi feito. Funciona em qualquer layout, como
as notas (maximizar, renomear com duplo clique).

- Digite no campo de cima e `Enter` adiciona; o foco fica no campo para
  emendar varias seguidas.
- Marcar o checkbox conclui: a tarefa vai riscada para **Concluidas** (a mais
  recente no topo, com a data no tooltip). Desmarcar devolve para o mesmo
  lugar entre as pendentes. A secao de concluidas recolhe com um clique.
- Duplo clique no texto edita (`Enter` confirma, `Esc` cancela; apagar o texto
  remove a tarefa). Passando o mouse aparece o `✕` para apagar.
- Arrastar uma pendente sobre outra reordena.
- O cabecalho mostra `N/M concluidas` e uma barra de progresso; `⌫` apaga
  todas as concluidas (com confirmacao).
- Salva sozinho em `tasks.json`. Fechar (`✕`) **apaga** a lista; se ela tiver
  tarefas, o app pede confirmacao.

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

Quatro arquivos em `app.getPath('userData')` (`~/.config/MultiTerm/` no Linux),
todos com escrita atomica, sem banco de dados:

- `config.json`: tamanho/posicao da janela, layout escolhido, proporcoes das
  divisorias de cada grade, diretorios recentes, terminais abertos (nome,
  diretorio, shell, posicao), a vista da area livre e as configuracoes de
  aparencia;
- `notes.json`: as notas (titulo, texto e posicao na area livre);
- `texts.json`: os textos soltos da area livre (conteudo, posicao, tamanho);
- `tasks.json`: as listas de tarefas (titulo, itens, posicao na area livre).

O historico (scrollback) e os processos dos terminais nao sao persistidos.

## Arquitetura

```text
src/
  domain/          regras e tipos, sem Electron e sem node-pty
    terminal/      TerminalSession (ciclo de vida, atividade, replay), porta Pty
    workspace/     layouts (templates, divisorias) e formato do config.json
    notes/         formato e validacao das notas
    canvas/        formato e validacao dos textos soltos
    tasks/         formato e validacao das listas de tarefas
  application/     casos de uso (orquestram o dominio)
    terminal/      TerminalService — unico dono do conjunto de sessoes
    workspace/     WorkspaceService — preferencias, com save debounced
    notes/         NotesService — notas, com save debounced
    canvas/        TextsService — textos soltos, com save debounced
    tasks/         TasksService — listas de tarefas, com save debounced
  infrastructure/  adaptadores concretos
    terminal/      NodePtyFactory implementa a porta Pty
    persistence/   JsonConfigStore, JsonNotesStore, JsonTextsStore,
                   JsonTasksStore (escrita atomica)
  main/            processo principal do Electron: janela + IPC + wiring
  renderer/        UI: paineis (terminal, nota, tarefas), grade, area livre, toolbar
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
- Comando inicial opcional por terminal (ex.: ja subir `claude` ao criar).
- Rotear o output por um `Map<id, painel>` em vez de cada painel filtrar todos
  os chunks, e agrupar os `webContents.send` em janelas de ~16ms.
- Confirmacao ao fechar um terminal com processo em execucao.
- Busca no scrollback (`@xterm/addon-search`).
