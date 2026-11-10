---
name: Fichário Pokédex
description: "Moldura preta, carta em primeiro plano: o fichário físico no celular, com o valor em reais."
colors:
  background: "#000000"
  backgroundTranslucent: "rgba(0, 0, 0, 0.94)"
  surface: "#16181A"
  surfaceAlt: "#232629"
  border: "#2E3236"
  borderStrong: "#7E858F"
  text: "#FFFFFF"
  textMuted: "#C4C9D0"
  textFaint: "#A0A6AE"
  iconFaint: "#6F757E"
  heading: "#FFF690"
  ink: "#16181D"
  primary: "#E6171E"
  primaryDark: "#C40D13"
  primaryAction: "#E6171E"
  onPrimary: "#FFFFFF"
  backdrop: "rgba(0, 0, 0, 0.72)"
  foil-0: "#FDF4BB"
  foil-1: "#E4C154"
  foil-2: "#B98F57"
  foil-3: "#E1BD54"
  foil-4: "#FDF4BB"
  binderColors-page: "#1E2023"
  binderColors-pageBorder: "#33373C"
  binderColors-pocket: "#2A2D31"
  binderColors-pocketBorder: "#3D4147"
  binderColors-text: "#E9EBF0"
  binderColors-textMuted: "#A4AAB6"
  binderColors-textFaint: "#9399A5"
  binderColors-highlight: "#FFF690"
  binderColors-special: "#FFCB05"
  binderColors-priceBg: "rgba(255, 255, 255, 0.08)"
  binderColors-priceFg: "#E9EBF0"
  semantic-shell-rule: "#E6171E"
  semantic-money-fg: "#FFFFFF"
  semantic-money-fgMuted: "#C4C9D0"
  semantic-special-fill: "#FFCB05"
  semantic-special-onFill: "#16181D"
  semantic-progress-fill: "#FFF690"
  semantic-progress-track: "rgba(255, 255, 255, 0.14)"
  semantic-selected-bg: "#FFFFFF"
  semantic-selected-fg: "#000000"
  semantic-selected-soft: "rgba(255, 255, 255, 0.12)"
  semantic-highlight-onSheet: "#FFF690"
  semantic-highlight-soft: "rgba(255, 246, 144, 0.14)"
  semantic-focus-ring: "#FFFFFF"
  semantic-gain-fg: "#6BE0A6"
  semantic-loss-fg: "#FF9B85"
  semantic-success-fg: "#6BE0A6"
  semantic-success-bg: "#12291E"
  semantic-warning-fg: "#FFD27A"
  semantic-warning-bg: "#2E2410"
  semantic-danger-fg: "#FF8A80"
  semantic-danger-bg: "#33161A"
  semantic-danger-border: "rgba(255, 138, 128, 0.45)"
  semantic-danger-solid: "#C5221F"
  semantic-link-fg: "#8AB4FF"
  semantic-link-soft: "rgba(138, 180, 255, 0.14)"
  semantic-brand-soft: "rgba(255, 255, 255, 0.12)"
  semantic-inverse-bg: "#FFFFFF"
  semantic-inverse-fg: "#16181D"
  semantic-inverse-action: "#B5280A"
  semantic-tag-bg: "#2E3236"
  semantic-tag-fg: "#E9EBF0"
  semantic-hover-onLight: "rgba(255, 255, 255, 0.08)"
  semantic-hover-onBrand: "rgba(255, 255, 255, 0.22)"
typography:
  display:
    fontFamily: "System"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: "40px"
  title:
    fontFamily: "Kanit_700Bold_Italic"
    fontSize: "26px"
    fontWeight: "normal"
    lineHeight: "32px"
  heading:
    fontFamily: "Kanit_700Bold_Italic"
    fontSize: "18px"
    fontWeight: "normal"
    lineHeight: "24px"
    letterSpacing: "0.5px"
  body:
    fontFamily: "System"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "22px"
  bodyStrong:
    fontFamily: "System"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "22px"
  label:
    fontFamily: "System"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: "16px"
    letterSpacing: "0.8px"
  caption:
    fontFamily: "System"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  numeric:
    fontFamily: "System"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: "22px"
    fontFeature: "tnum"
  figure:
    fontFamily: "System"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: "32px"
    fontFeature: "tnum"
rounded:
  card: "4px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  pill: "999px"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
  xxxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primaryAction}"
    textColor: "{colors.onPrimary}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "50px"
  button-primary-hover:
    backgroundColor: "{colors.primaryDark}"
    textColor: "{colors.onPrimary}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "50px"
  button-secondary-hover:
    backgroundColor: "{colors.surfaceAlt}"
    textColor: "{colors.text}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "50px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.semantic-danger-fg}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "50px"
  add-card-pill:
    backgroundColor: "{colors.primaryAction}"
    textColor: "{colors.onPrimary}"
    rounded: "{rounded.pill}"
    padding: "0 16px 0 12px"
    height: "48px"
  chip:
    backgroundColor: "{colors.surfaceAlt}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "48px"
  chip-selected:
    backgroundColor: "{colors.semantic-selected-bg}"
    textColor: "{colors.semantic-selected-fg}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "48px"
  segment-selected:
    backgroundColor: "{colors.semantic-selected-bg}"
    textColor: "{colors.semantic-selected-fg}"
    rounded: "{rounded.pill}"
    height: "48px"
  input:
    backgroundColor: "{colors.surfaceAlt}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
    height: "48px"
  search-field:
    backgroundColor: "{colors.surfaceAlt}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 4px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  binder-page:
    backgroundColor: "{colors.binderColors-page}"
    textColor: "{colors.binderColors-text}"
    rounded: "{rounded.md}"
  binder-pocket:
    backgroundColor: "{colors.binderColors-pocket}"
    textColor: "{colors.binderColors-textMuted}"
    rounded: "{rounded.sm}"
  price-capsule:
    backgroundColor: "{colors.binderColors-priceBg}"
    textColor: "{colors.binderColors-priceFg}"
    rounded: "{rounded.pill}"
    padding: "0 6px"
  badge-neutral:
    backgroundColor: "{colors.semantic-tag-bg}"
    textColor: "{colors.semantic-tag-fg}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  toast:
    backgroundColor: "{colors.semantic-inverse-bg}"
    textColor: "{colors.semantic-inverse-fg}"
    rounded: "{rounded.md}"
    height: "48px"
---

# Design System: Fichário Pokédex

## Overview

**Creative North Star: "A moldura preta"**

O app é o palco escuro da coleção: fundo preto, folha do fichário em grafite e a arte da carta como o que tem cor na tela. Quem abre vê as cartas primeiro, entende o valor de relance e sabe qual é a ação principal da tela. O app recusa o painel claro de cartões brancos.

O fichário continua com cara de fichário físico: folha com furos na lombada, bolso com boca e reflexo de plástico, número do bolso no canto. O ritmo é de ferramenta: cabe uma página inteira na tela, sem rolagem, e tudo responde rápido.

A referência de código é `src/theme.ts`, que guarda todos os tokens, e `src/components/ui.tsx`, que guarda os componentes. Em caso de dúvida, o código vale mais que este documento.

**Características principais:**
- Moldura preta, superfícies grafite em degraus tonais e texto branco.
- Títulos em Kanit 700 itálico; corpo e números na fonte do sistema, com algarismos tabulares.
- Pílula vermelha em gradiente só na ação principal.
- Selecionado em branco com texto preto; foco em branco; destaque em amarelo-claro.
- Filete foil só na carta especial (`isSpecialCard`).
- Nada abaixo de 11 px; alvo de toque de 48 (`TOUCH`).

## Colors

Preto, grafite e branco fazem a moldura; as outras cores são poucas e têm um significado só.

### Primária
- **Vermelho Pokédex** (`colors.primary`, #E6171E): a ação principal usa o gradiente `brandGradient` (#E6171E → `colors.primaryDark` #C40D13). O mesmo vermelho, em `semantic.shell.rule`, faz o fio da barra do topo. Fora disso, só quando o dono escolheu a capa vermelha (`coverFill`).

### Neutras
- **Preto de moldura** (`colors.background`): fundo das telas, barras e base fixa. `colors.backgroundTranslucent` só na `BottomBar`.
- **Grafite 1 e 2** (`colors.surface`, `colors.surfaceAlt`): cartão e, um degrau acima, chip, campo e trilho de controle.
- **Folha e bolso** (`binderColors.page`, `binderColors.pocket`): só dentro do fichário, com `pageBorder` e `pocketBorder` de borda.
- **Bordas** (`colors.border` para divisórias e cartões; `colors.borderStrong` para campos e interruptor desligado, pelo menos 4,08:1 sobre preto e grafite).
- **Texto** (`colors.text`, `colors.textMuted`, `colors.textFaint`): branco, cinza de apoio e legenda. Passam AA sobre o preto e o grafite (`textFaint` a partir de 6,2:1). `colors.iconFaint` nunca vai em texto.

### Significados (`semantic`)

| Token | Uso |
|---|---|
| `semantic.money` | Dinheiro em branco (`fg`), com algarismos tabulares. O dinheiro não tem cor |
| `semantic.selected` | Opção escolhida: fundo branco, texto preto |
| `binderColors.highlight`, `semantic.highlight` | Destaque em amarelo-claro: bolso da busca, carta recém-colocada, destino do arraste |
| `semantic.focus` | Foco em branco |
| `colors.heading` | Títulos de seção em amarelo-claro |
| `foil` | Filete metálico da carta especial, e nada mais |
| `semantic.special`, `binderColors.special` | Selo amarelo da carta especial e bolso livre (#FFCB05) |
| `semantic.progress` | Barra de progresso em amarelo-claro |
| `semantic.gain`, `semantic.loss` | Alta e queda de valor |
| `semantic.success`, `semantic.warning`, `semantic.danger` | Confirmação, aviso e erro |
| `semantic.link` | Texto tocável, em azul claro |
| `semantic.inverse` | Toast: claro sobre o preto |
| `semantic.tag` | Selos neutros: idioma, "carta base" |

Branco sobre o vermelho da ação dá 4,66:1; sobre `primaryDark`, 6,15:1. Na folha, `binderColors.textFaint` dá 5,71:1 e, no bolso, 4,84:1.

Capas de fichário (`COVER_COLORS`) são dado gravado, não tema: a cor aparece só na capa, na faixa da capa e nas prévias, com texto por `onCover`.

### Regras

**A Regra da Cor Única.** Uma cor, um significado. Se a cor muda de sentido de tela para tela, não ensina nada.

**A Regra do Vermelho.** O vermelho é da ação principal e do fio da barra. Um botão vermelho por tela, e nenhum chip, borda ou destaque em vermelho.

**A Regra do Dinheiro Branco.** Valor em reais fica sempre em branco, com algarismos tabulares. Confiança, alta e queda não mudam a cor do valor.

**A Regra do Foil.** O filete foil só aparece em carta que `isSpecialCard` aprova. O destaque do bolso é amarelo-claro, outra cor, de propósito.

## Typography

**Títulos:** Kanit 700 Italic (`font.display`, carregada em `src/app/_layout.tsx`; sem ela, cai na fonte do sistema).
**Corpo e números:** fonte do sistema, com `tabular-nums` nos números.

**Caráter:** o título em itálico dá o peso de capa de expansão; a fonte do sistema mantém texto e preços legíveis e abre na hora.

### Hierarquia
- **`display`** (800, 34/40): número grande da tela, como o valor da coleção. Sempre com `type.tabular` junto.
- **`title`** (Kanit, 26/32): título de tela ou de carta. A tela de boas-vindas usa 40/50.
- **`heading`** (Kanit, 18/24, espaçamento 0,5, maiúsculas): título de bloco em `colors.heading` (`Section`, folha de informação, estado vazio).
- **`body`** e **`bodyStrong`** (400 e 600, 15/22): texto corrido e nome em lista.
- **`label`** (700, 12/16, espaçamento 0,8, maiúsculas): rótulo de grupo (`GroupLabel`). Nunca logo acima de um título.
- **`caption`** (400, 13/18): legenda de uma linha, atribuição.
- **`numeric`** (700, 15/22, tabular): valores e contagens.
- **`figure`** (800, 26/32, tabular): número grande dentro de cartão.
- **`type.tabular`**: só os algarismos tabulares, para somar a outro estilo.

Fora da escala, mas usados: botão em Kanit 16/20 maiúsculas, `+ Carta` em Kanit 15, título da barra da home em Kanit 18/23 (22/28 no computador), título do cabeçalho das telas em Kanit 20, chip e segmento em 14.

### Regras

**A Regra do Piso de 11.** Nada abaixo de 11 px, inclusive nos bolsos do fichário (preço, número do bolso, nome e selo). Sem peso 900.

**A Regra do Número sem Kanit.** Número não vai em Kanit. Um título com número passa por `digitsInSystemFont`, que põe os dígitos na fonte do sistema, tabulares.

**A Regra da Kanit Normal.** A Kanit já é negrito e itálico: `fontWeight` e `fontStyle` ficam em `normal`, senão o Android engrossa de novo.

O preço e os textos do bolso crescem com a fonte do sistema só até `POCKET_FONT_SCALE` (1,3), e os da base fixa só até 1,2.

## Layout

Margem lateral por `gutterFor`: 16 no celular, 24 no tablet, 32 no computador. `space`: 2, 4, 8, 12, 16, 24, 32 e 48. Quebras em `breakpoints`: tablet 600, desktop 960, wide 1280. Larguras máximas em `widths`: reading 720 (`MAX_WIDTH`), form 640, content 960, wide 1200, spread 1440.

### A home do fichário

A página da home não rola: a folha cabe na área medida na tela.

- **`fitPocket`** acha a largura do bolso para a folha caber na largura e na altura: bolso mínimo 56 e, no computador, máximo 220. Se nem o bolso mínimo couber, só a área da folha rola (`fit.overflow`), nunca a largura.
- **Celular e tablet (abaixo de 960):** barra do topo, valor, régua de regiões, folha e a `HomeDock` fixa embaixo, por fora do fluxo, com o espaço dela reservado (`DOCK_HEIGHT` 65 + área segura). Com o teclado aberto, a base sai e a folha não pula.
- **Computador (a partir de 960):** folha à esquerda e painel lateral de 320 à direita, com 24 de vão. Só a lista de regiões do painel rola; numa janela baixa demais para ela, o painel inteiro rola.
- **Duas páginas abertas:** com fichário frente e verso, a partir de 860 de largura e mais de uma página, `spreadOf` abre as páginas lado a lado: a da esquerda é sempre verso, a da direita frente; a primeira ganha o verso da capa e a última, a contracapa, se sobrar.
- **Furos:** três furos de 14 (em 18%, 50% e 82% da altura), recuados 4 da borda, na lombada. `spineSide` escolhe o lado: frente à esquerda, verso à direita.

A folha tem vão de 8 entre os bolsos, 10 de margem e 22 do lado da lombada.

## Elevation & Depth

Profundidade vem dos degraus de superfície, não da sombra: preto, grafite 1, grafite 2. `shadow` e `elevation[1]` são vazios de propósito, porque sobre o preto a sombra não aparece. Bordas finas e divisórias separam o que o degrau não separa.

`elevation[2]` existe só para o que flutua de verdade.

### Vocabulário de sombra
- **`elevation[2]`** (Android `elevation: 8`; nos outros, `#000000` a 0,6, raio 18, deslocamento 0/6): toast, folha de baixo, lista de sugestões da busca, seletor de versões e carta levantada no arraste.

### Regras

**A Regra do Degrau.** Cartão e painel ficam sobre o preto sem sombra. Quem precisa destacar um bloco sobe um degrau de superfície.

**A Regra do Que Flutua.** Sombra só no que fica por cima de outra superfície. Se o elemento está no fluxo da tela, não tem sombra.

## Shapes

Cantos pelo `radius`: `card` 4 (arte da carta), `sm` 8 (bolso), `md` 14 (folha, campo, toast), `lg` 20 (cartão, topo de folha de baixo), `pill` 999 (botão, chip, ícone redondo, cápsula de preço). A proporção da carta é real (63 × 88 mm, `CARD_RATIO`).

Bordas são finas: 1 em folha e bolso, 1,5 em botão, chip e campo, 3 no bolso destacado. Tracejado indica estado (bolso de fichário livre vazio, origem do arraste, chip `hint`).

## Components

Controles curtos, cheios e diretos, sempre com alvo de 48.

### Botões (`Button`)
- **Forma:** pílula, altura mínima 50, 20 de margem, borda 1,5. Texto em Kanit 16/20 maiúsculas, nos quatro tipos.
- **`primary`:** gradiente `brandGradient`, texto branco. Um por tela. Mouse por cima: o gradiente sai e fica `colors.primaryDark`. Tocado: escala 0,98.
- **`secondary`:** contorno `colors.borderStrong`, texto branco; mouse por cima: `colors.surfaceAlt`.
- **`ghost`:** só texto, branco. **`danger`:** contorno e texto em `semantic.danger`.
- **`busy`** troca o ícone pelo carregando e bloqueia o toque; desabilitado fica com opacidade 0,45.

### Chips e opções (`Chip`, `ChipGroup`, `Segmented`, `ValueRangeRow`)
- **Chip:** altura e largura mínimas de 48, pílula, fundo `surfaceAlt`, borda `border`. Selecionado: branco com texto preto. `hint` deixa a borda tracejada.
- **Segmentado:** trilho `surfaceAlt`, parte escolhida branca com texto preto. Com seis opções, sem folga entre as partes (cada uma fica com 48).
- **Cor da capa (`ColorPicker`):** escolhida com borda branca e o visto; o contorno fica para o foco.
- **Grupo de opções na web:** Espaço marca, as setas andam entre as opções e só a marcada entra no Tab (`spaceToPress`, `radioGroupKeys`, `radioTabIndex`).
- **Faixa de valor:** com `onSelect`, a coluna escolhida fica branca com texto preto e a legenda "na soma".
- **`Toggle`:** ligado, trilho branco e bolinha preta (mesma cor do selecionado).

### Cartões
- **`Card`:** `surface`, canto `lg`, 16 de margem interna, sem sombra e sem borda.
- **`Section`:** título em `heading` amarelo-claro e no máximo uma linha de legenda. Mais explicação vai para `InfoSheet`.
- **"Para colecionador" (`CollectorFacts`, tela da carta):** rótulo `label` em cima do valor `bodyStrong` (tabular nos números), em duas colunas; sem valor, a linha some (nunca "—"); com nota, e a data sempre (o rótulo dela não cabe em meia coluna), ocupa a largura toda. No Android, cada informação é uma parada só do leitor de tela (o valor selecionável fica fora da árvore de acessibilidade). Enquanto as fontes chegam, o esboço tem uma célula por linha já conhecida mais a da data, para o bloco quase não crescer. O ano ao lado da raridade é um `Badge` neutro, só para um dia desta carta, reimpressão ou versão, ou para o mês quando a fonte não dá o dia ("05/2007", com a nota "A fonte não dá o dia."; nunca um período); na carta em português, a data é a do lançamento em inglês e o selo diz isso ("2023 · EN"). "Fora do fichário" fica numa linha de selos só dele, para o ano, que chega depois, não quebrar a linha.

### Campos
- **`Input`:** `surfaceAlt`, borda 1,5 `borderStrong`, canto `md`, altura 48, texto 16. Em foco, a borda fica branca; `invalid`, borda `semantic.danger.fg`, com o erro em texto.
- **`SearchField`:** mesma lógica, em pílula, com alvo de 48 na lupa e no limpar.

### Navegação
- **Cabeçalho das telas:** preto, título em Kanit 20, sem sombra, com o fio vermelho de 2 (`semantic.shell.rule`) embaixo.
- **Barra da home (`HomeTopBar`):** preta, altura 56 (64 no computador), nome do fichário em Kanit e, embaixo, o fio vermelho de 3 com o progresso em amarelo-claro por cima.
- **Base fixa (`HomeDock`):** fundo preto opaco, borda de cima, 8 de vão entre os alvos e 8 nas margens: página anterior, "Pág. 1 de 114" (toque abre "Ir para a página"), próxima página, próxima falta e a pílula `+ Carta`. Em tela estreita, a pílula fica só com o `+`.

### Consulta (`LookupBar`, `LookupGrid`, `LookupSheet`)
No celular, os comandos ficam no rodapé, junto do polegar e acima do teclado; as cartas ficam em cima. A célula mostra foto grande, preço e identificação, nessa ordem. Os links dos portais são neutros: a tela não tem ação vermelha. A pílula "Consulta" da tela inicial é neutra e fica na linha do valor, sem aumentar a altura dela.

### Pílula `+ Carta` (`AddCardPill`)
Na base do celular e na barra do computador. Altura 48, gradiente `brandGradient`, texto em Kanit 15 maiúsculas.

### Bolso do fichário (`BinderSlot`)
- **Corpo:** `binderColors.pocket`, borda 1 `pocketBorder`, canto `sm`, 3 de folga em volta da carta (2 no bolso menor que 80), com a boca do bolso em cima e o reflexo diagonal da capa plástica.
- **Vazio:** no Pokédex, número, arte do Pokémon a 50% e nome; no fichário livre, número e `+`, com borda tracejada; bolso livre da Pokédex com borda `binderColors.special` e estrela.
- **Estados:** mouse por cima, borda `textFaint` e sobe 2; destaque, borda 3 amarelo-claro; foco de teclado, anel branco de 2 com 2 de folga; tocado, opacidade 0,75.

**A Regra do Preço no Bolso.** O preço fica numa cápsula neutra embaixo da carta (`SlotPrice`): sempre 11 px, peso 700, tabular, nunca menor. O número vem de `formatCompact`. Sem espaço, sai o `R$`, e nunca o número: no bolso menor que 80 o `R$` some da cápsula e continua no rótulo do leitor de tela. Sem valor: "buscando…" ou "sem preço". Na web, que não consulta o MYP, é "esperando preço" no lugar de "buscando…" ("esperando" no bolso menor que 100).

### Filete foil (`FoilRing`)
Gradiente diagonal `foil` em volta da carta especial, atrás da arte. Largura 2 no bolso e na grade de cartas; 4 na tela da carta, onde o brilho `FoilGleam` passa uma vez só e nunca com "reduzir movimento". Só aparece depois de a imagem carregar, e some com a carta levantada.

### Arraste no fichário livre (`CardDragLayer`, `BinderSlot.lifted`)
Só no fichário livre (`CustomBinderView`): segurar uma carta por 350 ms levanta a carta. A carta sobe para a camada de cima, cresce 1,08 em 120 ms e ganha `elevation[2]`. O bolso de origem fica vazio, com borda tracejada `textFaint`, sem preço e sem foil. O bolso sob o dedo ganha o contorno 3 amarelo-claro (`semantic.highlight.onSheet`) e o fundo `semantic.highlight.soft`. Soltando fora de um destino, a carta volta em 160 ms; soltando sem mexer, abre a espiada. Com "reduzir movimento", sem animação. Na borda da folha, segurar vira a página; na folha que rola, a borda rola sozinha.

### Toast e folhas
- **Toast (`useToast`, `showToast`):** claro sobre o preto (`semantic.inverse`), canto `md`, altura 48, uma ação no máximo. Fica acima da base fixa e sobe com o teclado. Erro ganha uma borda esquerda de 4 em `semantic.danger.solid`.
- **`InfoSheet`:** `surface`, borda `border`, topo em `lg`, `elevation[2]`, fundo atrás em `colors.backdrop`.

### Selos e ícones
- **`Badge`:** cápsula neutra `semantic.tag`, 12/16; `tone` só com significado. O selo de carta especial usa `tone="special"`.
- **`IconButton`:** 48 × 48 com `label` obrigatório, com padding, porque a web ignora `hitSlop`.
- Ícones em Ionicons, importados direto (`@expo/vector-icons/Ionicons`). A Poké Ball é o SVG `PokeballIcon`; o "✎" de "Meu valor" aparece como ícone de lápis por `withMarkIcons`.

### Comportamento comum (acessibilidade, teclado, web)
- Estado por `aria-checked`, `aria-selected`, `aria-disabled`, `aria-busy`: valem no celular e na web. `accessibilityState` não chega à web.
- Títulos têm papel de título (`Section`, `GroupLabel`, `EmptyState`, folha) e viram `<h2>`/`<h3>` na web.
- Rótulo completo onde o visual diz mais que o texto: preço do bolso, selo, variação. Avisos que mudam vão em `Notice` ou toast.
- Reduzir movimento: `useReducedMotion()` tira deslocamento e duração de entradas, foil e arraste.
- Web: `html` com `lang="pt-BR"`, `theme-color` e fundo preto, seleção de texto em amarelo-claro. O título da aba segue o `title` da tela. Todo `Pressable` entra no Tab; para tirar um, `tabIndex={-1}` (como no rótulo do `Toggle`). Fundo que só fecha ao toque é uma `View` com `onStartShouldSetResponder` (como na `InfoSheet`), sem foco. `ExternalLink` vira `<a target="_blank">` de verdade.
- Foco visível: o bolso desenha o anel branco (largura 2, folga 2, `semantic.focus`); `Input` e `SearchField` passam a borda para branco, sem o contorno do navegador por cima. A opção escolhida, branca, usa `SELECTED_FOCUS`: o contorno branco com folga 2, por fora, sobre o fundo escuro. Os demais controles ficam com o contorno padrão do navegador.
- Erro de formulário no celular: `Notice` de erro e `useAlertAnnouncement` anunciam o texto (o TalkBack não lê a região que já entra preenchida); `Input` inválido leva "inválido" no nome.
- Teclado no fichário (computador): `←`/`→` e PageUp/PageDown folheiam, Home e End vão à primeira e à última página, `/` busca, `F` vai para a próxima falta, `Esc` limpa a busca e o aviso. Toast com ação: Ctrl+Z (⌘Z) fora de campo de texto aciona o "Desfazer", e `Esc` fecha o aviso com o foco nele; o tempo para com o mouse em cima ou o foco no aviso.
- Erro numa tela: "Tentar de novo" e "Voltar ao fichário"; no próprio fichário, "Abrir Minha coleção".

## Do's and Don'ts

### Faça
- **Use** nomes de `src/theme.ts` com significado (`semantic.money.fg`, `type.caption`, `space.lg`) e os componentes de `src/components/ui.tsx`.
- **Mantenha** a moldura preta: fundo `colors.background`, cartões em `surface`, um degrau acima em `surfaceAlt`.
- **Reserve** a pílula vermelha para a única ação principal da tela; o resto é `secondary` ou `ghost`.
- **Mostre** a opção escolhida em branco com texto preto (`semantic.selected`) e o foco em branco (`semantic.focus`).
- **Use** o filete foil só com `isSpecialCard`, depois de a imagem carregar.
- **Passe** por `digitsInSystemFont` qualquer título em Kanit que possa ter número.
- **Dê** alvo de 48 (`TOUCH`) a todo controle, com padding na web, e 8 de vão entre alvos na base fixa.
- **Ponha** a carta e o valor antes de qualquer painel.
- **Passe** valor em reais por `src/lib/format.ts` e textos de valor por `src/lib/copy.ts`.
- **Cite** a fonte com link em toda tela com preço do MYP Cards.

### Não faça
- **Não** use `#hex` nem `rgba(` soltos nas telas. As únicas exceções são dado gravado ou desenho: `COVER_COLORS`, as cores de energia em `card-facts.tsx` e a arte do `version-picker.tsx`.
- **Não** coloque texto abaixo de 11 px nem peso 900, nem dentro do bolso.
- **Não** use número em Kanit nem `fontWeight` diferente de `normal` junto da Kanit.
- **Não** ponha sombra em cartão ou painel no fluxo da tela.
- **Não** use o vermelho em chip, borda, ícone ou destaque.
- **Não** use `foil` nem `semantic.special` para nada além de carta especial e bolso livre.
- **Não** empilhe `label` logo acima de um título.
- **Não** corte o preço do bolso: o que sai é o `R$`, nunca o número.
- **Não** faça a página da home rolar nem deixe a dock cobrir a folha.
- **Não** dependa de `hitSlop` na web, nem de `accessibilityState` para informar estado.
- **Não** use `iconFaint` em texto.
