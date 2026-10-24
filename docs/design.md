# Design do Fichário Pokédex

Guia curto do sistema visual (versão 3.0). Os valores ficam em `src/theme.ts`, e os componentes em `src/components/ui.tsx`, que também reexporta os arquivos novos (toast, folha de informação, esqueleto, ícones). Regra geral: a tela usa um nome com significado (`semantic.money.fg`, `type.caption`, `space.lg`), nunca um `#hex` ou um tamanho solto.

## Princípios

- O fichário é o produto: a carta e a página vêm antes de qualquer painel.
- Cada cor tem um significado só. Se a cor muda de sentido de tela para tela, ela não ensina nada.
- Uma linha de legenda por bloco, no máximo. Explicação mais longa vai para uma `InfoSheet`, aberta por um ⓘ.
- Toda ação dá retorno: um toast curto, com "Desfazer" quando der para voltar atrás.

## Cores (`semantic`)

| Token | Uso | Não usar para |
|---|---|---|
| `money` | Todo valor em reais, em tinta neutra (`fg`; na folha escura, `onSheet`; na barra vermelha, `onBrand`), com `type.numeric` | Indicar confiança ou alta/queda |
| `myValue` | "Meu valor": a mesma tinta do dinheiro, com a marca ✎ e o selo neutro `tagBg`/`tagFg` | Destaque colorido |
| `special` | Carta especial de verdade (1ª edição, staff, promos, raras altas) e barra de progresso: amarelo-foil | Holo e reverse comuns (use um selo de canto), links, 1º lugar |
| `selected` | Opção escolhida: Chip, Segmented, faixa mínimo/média/máximo, interruptor ligado. Grafite com texto branco | Ações |
| `highlight` / `focus` | Bolso destacado (busca, carta recém-colocada) e foco do teclado: ciano na folha escura, petróleo `#0B7A86` no fundo claro | Seleção |
| `gain` / `loss` | Variação do valor (alta e queda). O gráfico fica em tinta neutra | Erro, "salvo" |
| `success` / `warning` / `danger` | Confirmação, aviso e erro: `fg` para texto e ícone, `bg` para o fundo suave | Dinheiro |
| `link` | Texto tocável, em azul; sobre a barra vermelha, branco sublinhado (`onBrand`) | Títulos, rótulos |
| `confidence` | Neutra; o prefixo só aparece quando acrescenta informação (≈ aproximado) | Pontos coloridos |
| `brand` | Barra do topo, capa vermelha e **um** botão principal por tela (`action`). Cartão sobre a barra vermelha: `bgStrong` | Chips, bordas, idioma da carta |
| `inverse` | Toast: tinta escura, texto branco, ação em ciano | |
| `tag` | Selos neutros: idioma PT/EN/JP, "carta base" | |

Contraste (WCAG AA, 4,5:1 para texto): `textFaint` #646A77 passa sobre o branco (5,4), o fundo (4,9) e o cinza claro (4,6). `success` #167A45, `warning` #965A00, `danger` #C5221F e `primaryText` #B5280A passam como texto. `borderStrong` #7F8592 é a borda dos campos e do interruptor desligado (3:1). Na folha escura, `binderColors.textFaint` #9399A5 (5,3). O botão principal usa `primaryAction` #DA320C, quase o vermelho da marca, com branco a 4,7:1. Branco sobre o vermelho da marca (`primary` #E3350D) dá 4,4:1, abaixo de AA para texto comum: vale só para texto grande (o título do cabeçalho tem 19 px em negrito, que pede 3:1) e ícones; texto menor sobre a barra vermelha vai num cartão `bgStrong` #B5280A (6,4:1). `iconFaint` (o cinza claro antigo) fica só para enfeites. Os fundos suaves (`bg`) de `gain`, `loss`, `success`, `warning` e `danger` são opacos: o texto da mesma cor passa AA tanto num cartão branco quanto no fundo cinza da tela (translúcidos, o verde e o âmbar caíam para 4,2 e 4,4 sobre o cinza).

Capas: `onCover(cor)` escolhe branco ou tinta escura pela razão de contraste. Laranja, amarelo, verde, turquesa, rosa e cinza ficam com texto escuro. Texto sobre capa sem `opacity`: use a mesma cor sólida.

## Tipografia (`type`, também exportado como `typography`)

| Estilo | Tamanho/linha/peso | Uso |
|---|---|---|
| `display` | 34/40 · 800 | Valor da coleção |
| `title` | 24/30 · 800 | Título da tela ou da carta |
| `heading` | 17/22 · 700 | Título de bloco (`Section`, folha) |
| `body` / `bodyStrong` | 15/22 · 400 / 600 | Texto corrido, nome em lista |
| `label` | 12/16 · 700, maiúsculas, espaçamento 0,8 | Rótulo de grupo (`GroupLabel`) |
| `caption` | 13/18 · 400 | Legenda de uma linha, atribuição |
| `numeric` | 15/22 · 700, algarismos tabulares | Valores e contagens |
| `tabular` | só `tabular-nums` | Para misturar: `[type.title, type.tabular]` |

Nada abaixo de 11 px (nos bolsos do fichário, 10 px no mínimo, com `maxFontSizeMultiplier` 1,3) e sem peso 900. Números com `tabular-nums`, nunca com fonte mono (`mono` está obsoleto). Nomes e textos do valor ("Valor deste fichário", "Usar na soma", rótulos de cada fonte) vêm de `src/lib/copy.ts`; reais e datas, de `src/lib/format.ts`.

## Espaço, toque e forma

- `space`: xxs 2, xs 4, sm 8, md 12, lg 16, xl 24, xxl 32, xxxl 48. Sem margens negativas para "puxar" blocos.
- `TOUCH` = 44: altura mínima de botão, chip, segmento, swatch, ícone e link solto. Na web o `hitSlop` não vale: use padding (`IconButton` e `ExternalLink` já fazem isso). `hitSlopFor(tamanho)` para o celular.
- `radius`: card 4 (arte da carta), sm 8, md 14, lg 20, pill.
- `elevation`: 0 plano, 1 cartão (= `shadow`), 2 o que flutua (toast, folha de baixo).

## Larguras (`widths`, `breakpoints`, `useLayout`)

- `widths`: reading 720 (= `MAX_WIDTH`), form 640, content 960, wide 1200, spread 1440.
- `breakpoints`: tablet 600, desktop 960, wide 1280. Margem lateral: `gutterFor(largura)` dá 16, 24 ou 32.
- `useKeyboardHeight()`: altura do teclado aberto no celular (0 na web), para o que fica preso ao rodapé subir junto; a tela não encolhe com o teclado. No Android, some `insets.bottom` (a altura vem sem a barra de navegação).
- `useLayout()` devolve `size` ('phone' | 'tablet' | 'desktop' | 'wide'), `gutter`, `isDesktop` e `contentWidth('form' | 'wide'…)`. `gridColumns(largura)` dá as colunas da grade de cartas (3 a 8 células de ~150 px). O que fica acima de uma `CardGrid` usa `{ width: gridContentWidth(largura), alignSelf: 'center' }` (de `card-grid.tsx`), para alinhar com a grade.

## Componentes (`@/components/ui`)

- `Button`: `primary` (um por tela), `secondary`, `ghost`, `danger`; `busy` mostra o carregando.
- `Chip` + `ChipGroup`: `mode` 'radio' (padrão), 'checkbox' (várias) ou 'button'. Ponha os chips de uma escolha dentro de `ChipGroup label="Idioma"`. No modo 'button', passe `selected` só quando o chip liga e desliga; ação de um toque ("Concluir", "Buscar de novo") fica sem `selected` e é lida como botão comum.
- `Segmented`: opções curtas numa linha (estado M, NM, SP…).
- `Section` (título nível 3, legenda de uma linha), `GroupLabel` (título nível 2), `Card`, `Row`.
- `Input` (`invalid` deixa a borda vermelha; mostre o erro em texto; aceita `ref`), `SearchField`, `Stepper` (ajustável no leitor de tela), `Toggle` (o rótulo também liga e desliga), `ColorPicker`.
- `ExternalLink`: todo link para fora do app. Na web é um `<a target="_blank">` de verdade (abre com Enter e aceita Ctrl+clique), no celular abre o navegador do sistema. Variantes `inline` (dentro de um Text), `text` (solto, 44 px) e `button` (cápsula azul clara). `tone="onBrand"` sobre a barra vermelha. Mantenha o crédito "MYP Cards" com link onde houver preço do MYP. `openExternal(url)` para abrir por código.
- `IconButton` (ícone com alvo de 44 e `label` obrigatório), `Badge` (selo neutro ou com significado), `ListRow` (miniatura, título, apoio e valor à direita), `Notice` (aviso em linha; erro é anunciado na hora).
- `Loading`, `Skeleton` / `CardSkeleton` / `TextSkeleton` (no lugar do que carrega; `tone="dark"` na folha), `EmptyState`.
- `PokeballIcon`: a Poké Ball em SVG, no lugar da fonte MaterialCommunityIcons.
- `InfoSheet` + `InfoTopic` / `InfoParagraph` + `InfoButton` (ⓘ): explicações fora da tela.
- Toast: `useToast().show({ message, actionLabel, onAction, duration })` ou `showToast(...)` fora de componentes. O `ToastHost` já está no `_layout` e sobe com o teclado. A ação roda uma vez só por aviso (um toque duplo não desfaz duas vezes). O tempo para com o mouse por cima ou o foco no aviso; com leitor de tela no celular, o aviso com ação só sai quando a pessoa fecha. Na web, Ctrl+Z (⌘Z) fora de um campo de texto aciona o "Desfazer", e Esc fecha o aviso com o foco nele.

## Textos de retorno (toast)

Frases sem concordância de gênero (o nome da carta ou do fichário pode ser qualquer um), com uma ação no máximo.

- Colocar: "Pikachu ex no fichário · pág. 2, bolso 5" [Desfazer]; no fluxo "+ Carta", "Pikachu ex em Trocas · pág. 1, bolso 3". Fora das páginas: "Pikachu ex entrou na coleção, fora do fichário".
- Trocar: "Pikachu entrou no lugar de Pikachu V" [Desfazer] (8 s).
- Remover: "Charizard saiu do fichário" [Desfazer]. Com o Desfazer, não há confirmação antes de remover.
- Mover: "Gengar foi para Trocas · pág. 2, bolso 12" [Desfazer].
- Fichário: "Fichário salvo", 'Fichário "Trocas" criado', 'Fichário "Trocas" apagado'.
- Erro: `tone: 'error'`, uma frase em português, sem o erro técnico.

## Acessibilidade

- Estado pelos props `aria-*` (`aria-checked`, `aria-selected`, `aria-disabled`, `aria-busy`), que valem no celular e na web. `accessibilityState` não chega à web.
- Títulos com papel de título (`Section`, `GroupLabel`, `EmptyState`, folha). Na web viram `<h2>`/`<h3>`.
- Rótulo de acessibilidade completo onde o visual diz mais que o texto (selo "tenho", variação, preço do bolso).
- Avisos que mudam: `Notice`, toast (região ao vivo; no iOS, anúncio à parte).
- Movimento: `useReducedMotion()`; com "reduzir movimento", as entradas viram só um esmaecer.

## Web

- `<html lang="pt-BR">`, descrição e `theme-color` vêm do `app.json`.
- O título da aba segue o `title` da tela (`<Stack.Screen options={{ title }} />`): "Charizard · Fichário Pokédex". Telas com título dinâmico só precisam atualizar esse `title`.
- O voltar do cabeçalho é anunciado "Voltar". Uma tela sem voltar usa `headerLeft: () => null` (o `headerBackVisible: false` não vale na web).
- Erro numa tela: tela amigável com "Tentar de novo" e "Voltar ao fichário", no lugar do app quebrado. No próprio fichário, que não tem cabeçalho, a saída é "Abrir Minha coleção".
- Na web, todo `Pressable` entra no Tab (o `focusable={false}` e o `accessible={false}` não valem lá). Para tirar um da ordem, passe `tabIndex={-1}` (como o rótulo do `Toggle`); um fundo que só fecha ao toque é uma `View` com `onStartShouldSetResponder`/`onResponderRelease` (como o da `InfoSheet`), que não recebe foco.
- `aria-label` numa `View` sem papel não é lido na web: o `Badge` com `accessibilityLabel` ganha `role="img"` lá.

## Migração (o que está obsoleto)

| Antes | Agora |
|---|---|
| `confidenceColors` | `semantic.confidence` (neutra) |
| `mono` | `type.numeric` / `type.tabular` |
| `colors.accent`, `colors.accentSoft`, `colors.gold` | `colors.primary` / `primaryText`, `primarySoft`, `warning` |
| `colors.primary` como cor de texto | `colors.primaryText` |
| Chip e segmento selecionados em vermelho | grafite (`semantic.selected`), já no `ui.tsx` |
| `MaterialCommunityIcons name="pokeball"` | `PokeballIcon` |
| `WebBrowser.openBrowserAsync` num `Text`/`Pressable` com papel de link | `ExternalLink` |
| `rgba(255,255,255,0.8)` sobre a barra vermelha | branco sólido (`semantic.brand.fg`) |

Todas as Poké Balls já usam o SVG (`PokeballIcon`), nas telas e no `ui.tsx`. Importe o Ionicons direto (`import Ionicons from '@expo/vector-icons/Ionicons'`), e não pelo barril `@expo/vector-icons`: o barril carrega todas as famílias de ícones, com as fontes e os mapas de glifos. O último que ainda importa pelo barril é `src/components/card-image.tsx`.
