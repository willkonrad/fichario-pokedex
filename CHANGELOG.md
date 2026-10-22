# Notas da versão

## 2.4.0 — Catálogo do TCGCSV e preços do MYP por mínimo/média/máximo (22/10/2026)

### Preços
- **Mínimo, média e máximo do MYP Cards** em cada carta, pela API pública do MYP. A **média** é o valor da carta e entra nos totais e no **gráfico de rendimento**; a coleção mostra também a faixa (soma dos mínimos e dos máximos).
- **"Meu valor" é o único valor fixo**: quando a média do MYP passa dele, ele é apagado e a carta volta a usar mínimo/média/máximo (a tela da carta avisa).
- Sem token, a API do MYP só atende aparelhos: **o app no celular busca os preços aos poucos** (no máximo 10 consultas por minuto), cartas novas primeiro, e grava no banco mesclando só o preço; a versão web mostra os valores e avisa quando ainda faltam.
- Versões com selo usam o produto próprio da versão no MYP quando ele existe (ex.: "Pokemon Day 2026"); senão, o preço do produto comum aparece só como referência.
- Crédito "MYP Cards" com link nas páginas do fichário e na lista de fichários, como a API exige.

### Catálogo

- **Base principal do catálogo: TCGCSV** (cópia diária e gratuita do catálogo da TCGplayer). As listas de cartas trazem todas as coleções, inclusive as recém-lançadas, e as versões com selo vendidas à parte, cada uma com a foto oficial. A TCGdex continua como base secundária: nome e imagem em português, ficha da carta, variações e preços.
- Cartas que só existem no TCGCSV abrem com a foto e a ficha básica (bandeira 🇺🇸 EN).
- A versão com selo escolhida na lista guarda a foto oficial e aparece com ela no fichário.
- Cartas japonesas continuam vindo da TCGdex por enquanto.

## 2.3.0 — Todas as cartas, todas as artes (21/10/2026)

- **Cartas que faltavam**: a lista de cada Pokémon completa com o catálogo do Zukan as cartas que a TCGdex ainda não tem (ex.: Nidorina MEP 101 da ETB de 30 anos, coleção me06).
- **Promos com arte**: cartas em português sem imagem usam a do catálogo em inglês (quase todas as promos SWSH e SM), e as reservas Scrydex e Zukan cobrem o resto (SVP 175+, MEP, me06).
- **Versões com selo na lista**: aparecem como cartas à parte (ex.: Bulbasaur Megaevolução 133 da Booster Box), já com a variação e o selo marcados.
- **Foto oficial da versão com selo**: quando a TCGplayer lista a versão à parte (Pokémon Center, campeonatos, concursos), a foto vem do TCGCSV.
- **Bandeira do idioma da imagem** na tela da carta (ex.: 🇺🇸 EN quando a foto é da carta em inglês).
- **Valor por versão**: versões especiais (selo, Poké Ball, Master Ball, 1ª edição…) não usam mais o preço do MYP da versão comum.
- **Voltar**: recarregar a página numa carta não deixa mais sem a seta de voltar ao fichário.
- Listas de cartas renovadas todo dia (promos novas aparecem logo).

## 2.2.0 — Versão da carta, origem e "Meu valor" automático (21/10/2026)

- **"Qual é a sua versão?"**: ao escolher uma carta que tem mais de uma versão visual (normal, reverse, holo, Poké Ball, 1ª edição, promo com selo…), aparecem as versões lado a lado para tocar na sua. Promos com selo já preenchem o nome do selo (ex.: Bulbasaur da Megaevolução 133 com o selo da coleção).
- Botão **"Ver versões"** na seção Variação, para rever ou trocar a versão depois.
- **Origem da carta**: Troca, Booster ou Compra. Na compra, o campo "Valor de compra" mostra quanto a carta valorizou (ou desvalorizou) desde então.
- **"Meu valor" automático**: se o preço do MYP passar do seu "Meu valor", ele é apagado e a carta volta a usar o MYP; a tela da carta avisa quando isso acontece.
- **MYP pelo menos semanal**: o preço de cada carta é renovado a cada 6 dias, para nunca ter mais de uma semana.
- **Vendas reais sem registro**: quando o Quanto vale minha carta? não tem nenhuma venda da carta, a tela agora avisa (antes não aparecia nada).

## 2.1.0 — Vendas reais como fonte de valor reserva (21/10/2026)

### Preços
- **Nova fonte reserva: vendas reais finalizadas** do [Quanto vale minha carta?](https://quantovaleminhacarta.com.br), no estado e idioma da carta. O MYP Cards continua sendo a fonte principal; quando a carta não tem anúncio no MYP, a mediana das vendas reais vira o valor (confiança média com 3 ou mais vendas, baixa com 1 ou 2).
- **Vendas reais por estado** (M, NM, SP, MP, HP, D) na tela da carta, com o número de vendas de cada um.
- **Só vale a mesma variação**: vendas de outra versão (ex.: Normal para uma promo carimbada) aparecem com aviso e não entram no valor.
- Cartas japonesas, que o MYP não cobre, agora podem ter valor pelas vendas reais.
- O gráfico da coleção usa a mesma regra; o histórico diário passa a guardar as vendas reais.
- No servidor, a função `myp-sync` virou `price-sync` (MYP + vendas reais, com cache de 7 dias).

### Correções
- Editar uma carta não apaga mais os dados de vendas reais já buscados.

## 2.0.0 — Visual Pokédex e revisão completa (21/10/2026)

O app foi revisado de ponta a ponta, em 32 rodadas de verificação e correção. Esta versão traz um visual novo, inspirado na Pokédex e no Nintendo Switch, novos recursos pedidos e várias correções.

### Visual novo
- **Tema Pokédex**: barras do topo em vermelho Pokémon, fundo claro com cartões brancos (como a interface do Nintendo Switch) e destaques no amarelo e no azul do logo Pokémon.
- **Páginas do fichário escuras**, como as folhas plásticas de um fichário de verdade; cartas especiais (holo, reverse, promo…) com borda amarela.
- **Destaque em ciano** (a cor de seleção do Switch) para a busca e o botão "Vazio", diferente do amarelo das cartas especiais.
- Botões em pílula, controle segmentado para o estado da carta, campos com foco em vermelho, ícones de Poké Ball nos estados de carregando e vazio.
- **Ícone e tela de abertura novos**: um fichário branco com grade de cartas e uma carta especial em amarelo, sobre o vermelho Pokémon.

### Novidades
- **Duas páginas abertas no computador**: em tela larga, fichários frente e verso abrem como um fichário de verdade — a página 1 sozinha ao lado da capa, depois 2–3, 4–5… e a última sozinha ao lado da contracapa quando cai do lado esquerdo.
- **Capa com o nome do fichário** e o progresso, ao lado da primeira página.
- **Bolsos livres na última página do fichário Pokédex**: os bolsos que sobram depois do último Pokémon ficam livres para cartas especiais (qualquer carta). Elas entram no valor do fichário, mas não contam no progresso da Pokédex.
- **Folhear arrastando**: arraste a página para o lado para trocar de página; os botões de página também aparecem embaixo da página.
- **Minha coleção**: valor total em destaque, **gráfico da evolução do valor da coleção** (1M, 3M, 6M, 1A) com a variação no período, e as 5 cartas mais valiosas.
- **Salvamento automático** na tela da carta: mudar o estado, a variação, o "Meu valor" ou as observações salva na hora (inclusive se você sair da tela logo depois de digitar).
- **Carta no computador**: imagem grande à esquerda e informações à direita.
- **Tablet e computador**: a página inteira do fichário cabe na altura da tela.
- **Boas-vindas** na primeira vez que o app abre.
- **Esqueci minha senha** na tela da conta, e mensagens de login em português.
- **"Vazio"** agora percorre os espaços vazios um por um, a partir da página atual.
- **Botão "Liga Pokémon"** na tela da carta, ao lado do "MYP Cards": abre a carta na Liga para consulta (o valor continua vindo só do MYP).

### Preços (MYP Cards)
- O valor de cada carta vem **só do MYP Cards** ("Meu valor" tem prioridade); carta sem anúncio mostra "sem preço".
- **Cartas de Galeria de Treinador e Galeria Galar** (ex.: Gengar TG06) passaram a ter preço.
- **Cartas em inglês de coleções antigas** (ex.: Wartortle de EX Guardiões do Cristal) passaram a ter preço.
- Cartas **sem preço** são consultadas de novo todo dia (antes, 1 vez por semana).
- Cartas japonesas mostram que o MYP não informa preço de cartas japonesas e sugerem "Meu valor", em vez de ficarem "buscando" para sempre.
- Link "Ver anúncios no MYP Cards" no quadro de preço e na tela Minha coleção.

### Correções
- Ao **trocar uma carta por outra**, colocar a nova antes da ficha carregar podia salvá-la com o nome, a coleção e a imagem da carta antiga.
- Cartas sem imagem mostravam o **verso de uma carta Pokémon** no lugar (imagem reserva) no navegador.
- Os botões de estado (M, NM, SP…) quebravam em duas linhas em celulares de 375 px.
- Quando a ficha da carta não existe no catálogo, o aviso dizia "confira a internet" e a variação ficava "carregando" para sempre.
- No navegador, os campos de busca mostravam o contorno de foco padrão (retângulo laranja) dentro da cápsula.
- Na estante de fichários, o botão de personalizar ficava dentro do botão do fichário (inválido no navegador e confuso para leitores de tela).
- Energia incolor quase invisível na ficha da carta; capa amarela com texto branco ilegível; prévia do fichário novo com um nome diferente do que seria salvo.
- Leitores de tela: nomes nos botões de estado, nas cores de capa e nos controles de página.

### Por dentro
- Removido todo o código das fontes antigas (Liga, vendas reais, TCGplayer, Cardmarket), as imagens padrão do Expo e código sem uso.
- Componentes visuais compartilhados (`src/components/ui.tsx`), grade de cartas e gráfico reutilizáveis, tema centralizado (`src/theme.ts`).
- `scripts/make-icons.js` gera o ícone, o ícone adaptativo do Android, o favicon e a imagem de abertura.

O registro de cada rodada de revisão está em [docs/revisoes-2.0.0.md](docs/revisoes-2.0.0.md).
