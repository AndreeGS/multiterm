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
npm test           # testes unitarios do dominio (node:test, sem Electron)
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
| `Ctrl+Shift+P` | Paleta: ir para qualquer painel ou executar qualquer acao |
| `Alt+1` … `Alt+9` | Ir direto para o painel N (segurar `Alt` mostra os numeros) |
| `Ctrl+PageDown` / `Ctrl+PageUp` | Painel seguinte / anterior |
| `Ctrl+Shift+A` | Proximo terminal aguardando voce |
| `Ctrl+Enter` (numa nota) | Envia a selecao ou a linha do cursor ao terminal vinculado |
| `Ctrl+,` | Configuracoes (tema e tamanho da fonte) |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copiar / colar (o `Ctrl+C` puro continua sendo SIGINT) |
| Duplo clique no nome | Renomear |

Os atalhos com `Ctrl+Shift`, `Alt+N` e `Ctrl+PageUp/PageDown` valem mesmo com o
foco dentro de um terminal, e nao chegam ao shell.

A paleta (`Ctrl+Shift+P`) lista os paineis abertos (os que pedem atencao com
`●`) e as acoes do app; digitar filtra, sem diferenciar acento nem caixa.

Botoes de cada painel: `■` interromper (Ctrl+C), `⟳` reiniciar o shell,
`⤢` maximizar, `✕` fechar.

## Comando inicial

O dialogo de novo terminal tem um campo **Comando inicial** (ex.: `claude`,
`npm run dev`), com sugestoes e os comandos que voce ja usou. O comando e
digitado no shell assim que ele imprime o prompt, como se voce tivesse
digitado — com o PATH, aliases e rc de sempre. Ele aparece no cabecalho
(`~/projeto · claude`) e:

- roda de novo a cada `⟳` (reiniciar);
- e salvo com a sessao.

Cada terminal com `claude` tem **a sua conversa**. O app escolhe um id para
ela e digita `claude --session-id <id>` na primeira vez. Ao reiniciar (`⟳`)
ou restaurar a sessao, digita `claude --resume <id>`, voltando exatamente
para a conversa daquele terminal, mesmo com varios no mesmo diretorio. No
cabecalho continua aparecendo so `claude`. Comandos que ja escolhem a conversa
(`-c`, `--resume`, `-p`...) ficam como voce escreveu. Terminais salvos por
versoes anteriores, sem id, voltam como `claude --continue`, e so se existir
conversa salva para o diretorio em `~/.claude/projects` (ou `$CLAUDE_CONFIG_DIR`).

O comando inicial nao arma o aviso de ocioso: um agente recem-aberto esperando
instrucao nao e motivo de alerta.

## Templates

Um template guarda diretorio, comando inicial, nome e cor de um terminal que
voce abre sempre (ex.: "API dev", "Claude no front"):

- no dialogo de novo terminal, marque **Salvar como template**. Sem nome
  digitado, o template leva o nome que o terminal ganhou. Salvar de novo com o
  mesmo nome substitui o anterior;
- o `▾` ao lado de `+ Terminal` lista os templates e abre direto, sem dialogo;
- a paleta (`Ctrl+Shift+P`) tem `Novo: <template>` e `Apagar template: <nome>`;
- no dialogo, os templates aparecem como chips no topo e preenchem o
  formulario, para ajustar antes de criar.

Ficam no `config.json`, no maximo 20 (salvar o 21o descarta o mais antigo).

## Cor do terminal

O `●` no cabecalho escolhe uma cor de destaque (ou nenhuma). Ela aparece como
uma faixa a esquerda do cabecalho, em qualquer layout, e pinta a linha de
vinculo na area livre — menos quando o terminal esta aguardando ou com pedido
explicito: ai a linha usa a cor do estado, que e o que pede acao. A cor tambem
pode ser escolhida no dialogo de novo terminal, vem do template e e salva com
a sessao. Na paleta: `Cor de "<terminal>"`.

As cores sao chaves (`blue`, `green`...), e cada tema define o tom em
`--pane-<cor>` no `styles.css`.

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

## Enviar texto aos terminais

Notas e tarefas viram roteiros para os agentes:

- **Nota**: `Ctrl+Enter` envia a selecao — ou, sem selecao, a linha do cursor,
  descendo para a proxima (da para "executar" um roteiro linha a linha). O
  botao `▶` no cabecalho faz o mesmo. Texto de varias linhas vai como colagem
  (bracketed paste), entao chega ao Claude Code como um prompt so.
- **Tarefa**: o `▶` que aparece passando o mouse manda o texto da tarefa como
  prompt. Ela ganha a marca `→ terminal` ate ser concluida (so nesta sessao).

### Vinculo com um terminal

Cada nota e cada lista de tarefas tem um `🔗` no cabecalho, que diz para qual
terminal o texto vai. O vinculo e sempre escolhido por voce:

- **clicar** no `🔗` abre a lista de terminais (e `Remover vinculo`);
- **arrastar** o `🔗` ate um terminal vincula a ele (o terminal acende ao
  passar por cima);
- enviar sem vinculo pergunta o terminal, e a escolha vira o vinculo;
  `Ctrl+Shift+Enter` na nota, ou `Shift`+clique no `▶`, pergunta de novo e
  troca o vinculo;
- a paleta (`Ctrl+Shift+P`) tem `Vincular "<painel>" a um terminal`.

O vinculo e salvo junto com a nota/lista e sobrevive ao reinicio: o terminal
restaurado volta com o mesmo id. Enquanto a sessao nao e restaurada o `🔗`
aparece apagado; descartar a sessao ou fechar o terminal (`✕`) desfaz o
vinculo.

**Na area livre**, uma linha liga o card da nota/lista ao card do terminal,
de borda a borda (do lado que um mostra para o outro), acompanhando arrasto,
zoom e pan. Ela muda de cor com o terminal (ambar aguardando, roxo com pedido
explicito) e some quando os cards se sobrepoem ou uma das pontas esta coberta
por outro painel. Nas grades nao ha linha — os paineis sao vizinhos
fixos e ela cruzaria o conteudo; la o nome no `🔗` basta. Da para desligar a
linha em Configuracoes.

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

Ambas tem teste de regressao em `src/test/pty-smoke.ts` (PTY real) e em
`src/test/unit/terminal.test.ts` (PTY falso).

### Pedido explicito do agente

O silencio e um palpite. Quando o proprio processo avisa, o MultiTerm usa o
aviso dele:

- **BEL** (`\a`) fora de uma sequencia de escape;
- **notificacoes de terminal** OSC 9 (iTerm2), OSC 777 (Ghostty/urxvt) e
  OSC 99 (kitty), com a mensagem que vier nelas.

O painel fica roxo, a mensagem toma o lugar do diretorio no cabecalho
(`🔔 precisa de permissao`) e a notificacao do sistema usa esse texto. Ao
contrario do aviso de ocioso, ele **nao some quando o agente volta a imprimir**
(TUIs redesenham a tela depois de avisar): so quando voce olha o terminal ou
digita nele. O titulo da janela (`OSC 0/2`, terminado em BEL) e a barra de
progresso (`OSC 9;4`) sao ignorados.

Para o Claude Code mandar esse aviso, escolha o canal de notificacao em
`/config` (`preferredNotifChannel`): `ghostty` ou `iterm2` mandam a mensagem;
`terminal_bell` manda so o BEL.

## Consumo de tokens

A barra superior agrega as transcricoes locais do Claude Code
(`~/.claude/projects/**/*.jsonl`, ou `$CLAUDE_CONFIG_DIR`) e mostra tokens e
custo estimado de hoje e dos ultimos 7 dias. O tooltip abre o detalhe por
modelo; clicar atualiza na hora (tambem atualiza sozinho a cada minuto).

**Por terminal**: o cabecalho de cada terminal com `claude` mostra o consumo
da conversa dele (`90k · US$ 0,18`, com o detalhe no tooltip), e a paleta
repete o numero. Conta a conversa inteira, inclusive subagentes. Limitacao:
`/clear` ou `/resume` dentro do Claude troca de conversa, e dali em diante o
numero do terminal para de acompanhar.

Leitura incremental — cada arquivo e lido so a partir de onde parou, em
streaming, e arquivos sem escrita recente sao ignorados. Uma linha que ainda
esta sendo escrita fica para a proxima passada. Na pratica: ~150ms na
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
  divisorias de cada grade, diretorios e comandos recentes, terminais abertos
  (nome, diretorio, shell, comando inicial, cor, posicao), templates, a vista
  da area livre e as configuracoes de aparencia;
- `notes.json`: as notas (titulo, texto, posicao na area livre e terminal
  vinculado);
- `texts.json`: os textos soltos da area livre (conteudo, posicao, tamanho);
- `tasks.json`: as listas de tarefas (titulo, itens, posicao na area livre e
  terminal vinculado).

O historico (scrollback) e os processos dos terminais nao sao persistidos.

## Arquitetura

```text
src/
  domain/          regras e tipos, sem Electron e sem node-pty
    terminal/      TerminalSession (ciclo de vida, atividade, replay), porta Pty,
                   comando inicial e deteccao de BEL/OSC de notificacao
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
  test/            unit/ (node:test, logica pura) e pty-smoke (PTY real)
```

Regras que mantem o acoplamento baixo:

- `domain` nao importa nada de Electron nem de `node-pty`; depende da interface
  `Pty`. E por isso que a `TerminalSession` e testavel com um PTY falso.
- Testes unitarios ficam em `src/test/unit/*.test.ts`. O `npm test` empacota
  cada arquivo com esbuild (os imports `.js` apontam para `.ts`, o que o Node
  sozinho nao resolve) e roda com `node --test`.
- O output dos ptys cruza o IPC em lotes de ~16ms (`main/output-batcher.ts`),
  com uma entrada por terminal, e o `App` entrega cada uma ao painel pelo id.
  Cada chunk tem um `seq`; o replay diz ate qual `seq` ja trouxe, e o painel
  descarta o que chegou ao vivo e ja estava nele (nada aparece duplicado ao
  reabrir um painel).
- O renderer nao tem acesso a Node: `contextIsolation` ligado e uma API unica
  exposta pelo `preload`, tipada em `shared/contract.ts`.
- Nada e executado automaticamente. O app so sobe o shell que voce pediu, no
  diretorio que voce escolheu.

## Proximos passos naturais

- Atividade mais precisa lendo o processo em foreground do PTY
  (`IPty.process` no Unix) em vez de so o fluxo de bytes.
- Confirmacao ao fechar um terminal com processo em execucao.
- Busca no scrollback (`@xterm/addon-search`).
