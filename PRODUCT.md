# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

Colecionador brasileiro de cartas Pokémon. Hoje o único usuário é o dono do projeto; o app deve ficar pronto para outros colecionadores no futuro (o cadastro continua fechado até lá). Ele usa o app sobretudo no celular Android e às vezes no computador (web), organizando cartas físicas em casa e consultando preços durante leilões ao vivo, com 20 a 30 segundos para decidir um lance.

## Product Purpose

Espelhar a coleção física num fichário digital e dizer quanto ela vale em reais. Sucesso: achar qualquer carta e o valor dela em segundos, e confiar no número que aparece.

## Positioning

Um fichário que se comporta como o fichário de verdade (páginas, bolsos, Pokédex completa), com valor em reais tirado de fontes reais e citadas, sem nunca estimar preço.

## Operating Context

- Organizar: colocar, trocar e mover cartas nos bolsos, inclusive lotes grandes (ex.: cartas japonesas antigas "Pocket Monsters").
- Acompanhar: valor da coleção, variação, relatórios de atividade.
- Leilão: identificar a carta que está vendo e ver preço e links em poucos segundos, com uma mão, às vezes com sinal ruim.

## Capabilities and Constraints

- Expo SDK 58 / React Native (Android e web). Hoje roda no Expo Go; o APK está previsto.
- Cartas em português, inglês e japonês na coleção. Coreano e chinês só na consulta.
- Valor: "Meu valor" → TCGplayer (inglês e japonês, em reais pela PTAX) → MYP Cards. O app nunca estima preço nem dá desconto pelo estado da carta.
- Nada de raspar sites nem contornar bloqueios; links para os portais são permitidos.
- Interface em português do Brasil. Regras completas em AGENTS.md.

## Brand Commitments

- Nome: Fichário Pokédex.
- O vermelho Pokédex continua como marca do app, pelo menos na ação principal.
- O fichário mantém a cara de fichário físico (folhas, furos, bolsos plásticos).
- Referência visual escolhida pelo dono (estilo apenas): páginas oficiais do Pokémon TCG (https://tcg.pokemon.com/pt-br/, expansões Reinado Delta e 30 Anos). Logos, artes e textos desses sites não entram no app: o repositório é público.
- Toda tela com preço do MYP Cards cita a fonte com link.

## Evidence on Hand

Coleção real do dono no Supabase (mais de 650 cartas). Não há depoimentos, clientes nem números de uso: não inventar.

## Product Principles

- A carta e o fichário vêm antes de qualquer painel.
- O número em reais precisa ser legível de relance e ter fonte.
- Rapidez é parte do produto: nada de animação demorada ou tela pesada, principalmente no celular.
- Uma cor, um significado.

## Accessibility & Inclusion

Contraste WCAG AA nos textos, alvos de toque de 48 dp, rótulos para leitor de tela e respeito a "reduzir movimento".
