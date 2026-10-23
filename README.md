# Fichário Pokédex

App pessoal e gratuito para colecionadores de Pokémon TCG: organize suas cartas em fichários virtuais iguais aos de verdade e acompanhe quanto a sua coleção vale ao longo do tempo, em reais.

> **Projeto pessoal, sem fins comerciais.** Não vende nada, não cobra assinatura, não exibe anúncios e não revende dados. O código é aberto (licença MIT).

## O que o app faz

- **Fichários virtuais** com as mesmas dimensões do seu (bolsos por página, folhas, frente e verso):
  - **Pokédex**: um espaço por Pokémon, com opção de limitar a uma região (ex.: só Kanto). Os bolsos que sobram na última página ficam **livres para cartas especiais**;
  - **Livres**: coleção, coleção completa, favoritas, trocas, deck, graduadas — você escolhe a carta de cada bolso.
- **Folheie como um fichário de verdade**: arraste a página para o lado; no computador, fichários frente e verso abrem **duas páginas lado a lado**, com a capa (com o nome do fichário) ao lado da primeira página.
- **Catálogo completo** em português, inglês e japonês ([TCGdex](https://tcgdex.dev)), com estado (M, NM, SP, MP, HP, D) e variação (holo, reverse, 1ª edição, Poké Ball, promos com selo…).
- **Valor de cada carta em reais**: **mínimo, média e máximo dos anúncios no [MYP Cards](https://mypcards.com)** (API pública do MYP), como a API informa, sempre com link para o MYP. **Cartas em inglês** valem pelo preço da **TCGplayer** (EUA), em reais pela PTAX do Banco Central, com o MYP como referência.
- **Minha coleção**: valor total em três colunas (soma dos mínimos, das médias e dos máximos), **gráfico de rendimento** com a faixa mínimo–máximo e a linha da média (1M, 3M, 6M, 1A) e as cartas mais valiosas.
- **"Meu valor"**: o único valor fixo da carta, até a média da fonte (MYP; TCGplayer nas cartas em inglês) passar dele (aí ele é apagado e voltam mínimo/média/máximo).
- **Origem da carta**: troca, booster ou compra; na compra, o valor pago e quanto a carta valorizou desde então.
- **Salvamento automático**: mudar o estado, a variação, o valor ou as observações de uma carta salva na hora.
- Visual inspirado na Pokédex e no Nintendo Switch: barras vermelhas, cartões brancos e as páginas do fichário escuras como folhas plásticas.
- Coleção salva no aparelho e sincronizada na nuvem (Supabase), com login próprio.

As novidades de cada versão estão em [CHANGELOG.md](CHANGELOG.md).

## Fontes de dados e atribuição

Os preços vêm do **MYP Cards** e, nas cartas em inglês, da **TCGplayer** (via TCGCSV), ou do "Meu valor" digitado pelo colecionador. Cada valor exibido no app cita a fonte, com link.

| Fonte | O que fornece | Como é acessada |
|---|---|---|
| [MYP Cards](https://mypcards.com) | Mínimo, média e máximo dos anúncios de cada carta, em reais | [API pública do MYP Cards](https://mypcards.com/acesso-api) ([documentação](https://mypcards.github.io/mypcards-api)). Sem token: 10 consultas/min e só aparelhos (o servidor recebe 403 e o navegador não tem CORS), então **o app no celular** busca aos poucos e grava no banco. Token pedido; com ele, a busca passa para o servidor. Atribuição "MYP Cards" com link em todo valor |
| [TCGCSV](https://tcgcsv.com) | **Base principal do catálogo**: cartas de todas as coleções (inclusive as lançadas ontem) e versões com selo vendidas à parte, com a foto de cada uma — inclusive as que a TCGplayer guarda em coleções de diversos (Booster Box, Prize Pack, Liga, Build-A-Bear…), ligadas à carta de origem pelo número completo. **Preços da TCGplayer** (menor anúncio, mediana e valor de mercado, em dólar, por impressão) das cartas em inglês | Espelho gratuito do catálogo e dos preços da TCGplayer (obrigado, TCGCSV!), copiado 1×/dia por coleção para o Supabase pela Edge Function `catalog-sync`, seguindo as [regras de uso](https://tcgcsv.com/docs#usage-guidelines); o app só lê a cópia |
| [Banco Central do Brasil](https://www.bcb.gov.br) | Dólar PTAX (venda) de cada dia útil, para converter os preços da TCGplayer | API pública de séries do BCB (SGS, série 1), lida pela `catalog-sync` 1×/dia depois do fechamento |
| [TCGdex](https://tcgdex.dev) | Catálogo secundário: nome e imagem em português, ficha (ataques, HP…), variações e número da Pokédex | API pública |
| [Zukan](https://www.zukan.com.br) | Cartas novas que a TCGdex ainda não tem (ex.: promos MEP recentes) e imagem reserva | Servidor MCP público |
| [pokemontcg.io](https://pokemontcg.io) / Scrydex | Imagem reserva de cartas sem imagem na TCGdex | Arquivos públicos no GitHub e CDN de imagens |

### Uso responsável

- **Só as cartas da coleção** são consultadas — nada de varrer catálogos inteiros.
- **Atualização semanal**: o preço do MYP de cada carta é renovado 1× por semana, no máximo 10 consultas por minuto.
- **Sem repetição**: a mesma carta em vários fichários é consultada uma única vez.
- **Volume pequeno**: cerca de 1.000 cartas por semana, ou ~150–200 consultas por dia.
- Os dados ficam só no app do próprio colecionador; não são publicados, revendidos nem redistribuídos.

## Como o valor da carta é definido

Em `src/lib/valuation.ts`, nesta ordem:

1. **"Meu valor"** informado pelo colecionador: o único valor fixo (mínimo, média e máximo iguais a ele). Quando a **média da fonte** (MYP; TCGplayer nas cartas em inglês) passa dele, ele é apagado (fica o registro da troca) e a carta volta a usar a fonte;
2. **cartas em inglês**: o preço da **TCGplayer** (EUA), o principal mercado de cartas em inglês, convertido direto pela **PTAX** do dia: mínimo = menor anúncio, média = valor de mercado (vendas recentes), máximo = mediana dos anúncios — confiança média, porque juntam todos os estados. É o preço da impressão certa (normal, holo, reverse, 1ª edição…) e do produto próprio da versão com selo, Poké Ball ou Master Ball; sem ele, o da carta base (confiança baixa). Carta sem vendas recentes na TCGplayer usa o MYP (confiança baixa), que aparece sempre como referência;
3. o **mínimo, a média e o máximo dos anúncios do produto no MYP** (API pública), como a API informa — confiança média, porque juntam todos os estados e idiomas. Versões especiais (selo, Poké Ball…) usam o produto próprio da versão no MYP; quando o MYP não vende a versão à parte, usam o da carta base, que tem valor parecido (confiança baixa).

Em cada carta, você escolhe qual dos três é o valor dela (a média, se não escolher; o mínimo costuma ser o valor real de cartas novas). A soma da coleção mostra o **valor calculado** (os valores escolhidos) e, embaixo, as somas dos mínimos, das médias e dos máximos; o valor escolhido ordena as mais valiosas, aparece nos bolsos do fichário e é a linha do gráfico. A API do MYP não separa idioma nem estado. Sem nenhuma fonte, a carta fica **sem preço** — o app não estima valores (ex.: desconto fixo por estado).

O servidor (`catalog-sync`) copia os preços do TCGCSV para `tcg_prices` 1×/dia por coleção e a PTAX para `fx_rates`; o app (no celular e na web) lê essas tabelas e grava o preço na carta (`patch_entry_tcgplayer`) — nunca chama o TCGCSV.

Um snapshot diário (`snapshot_prices`, 23:50 de Brasília) guarda o "Meu valor", o preço da TCGplayer e o mínimo/média/máximo do MYP de cada carta em `price_history`; o gráfico de rendimento desenha a faixa (soma dos mínimos a soma dos máximos) e a linha da média.

## Rodar o app

```bash
npm install
```

```bash
npx expo start
```

Para testar no celular, instale o **Expo Go** compatível com o SDK 58 e escaneie o QR code. Também roda no navegador (`w` no terminal do Expo).

## Servidor (Supabase)

1. Crie um projeto gratuito em [supabase.com](https://supabase.com).
2. No **SQL Editor**, rode `supabase/schema.sql` (troque `SEU_PROJECT_REF` no final).
3. Copie `.env.example` para `.env` e preencha a URL e a chave pública do projeto.
4. Publique as Edge Functions `supabase/functions/catalog-sync` (cópia do catálogo do TCGCSV, chamada pelo cron; verificação de JWT desligada, porque ela é protegida por uma chave guardada no Vault) e `stamp-image` (foto da versão com selo, chamada pelo app).
5. Os preços do MYP são buscados pelo app no celular (sem token, a API do MYP não atende servidores). Quando o MYP liberar o token, ele vai em **Edge Functions → Secrets** como `MYP_API_TOKEN`, e a busca passa para o servidor.

Nenhuma chave ou senha fica no código: todas ficam nos Secrets do Supabase ou no `.env` local, que não vai para o repositório.

## Estrutura

- `src/app/` — telas (Expo Router): fichários, carta, busca, menu, conta.
- `src/lib/valuation.ts` — regra do valor de referência.
- `src/lib/` — TCGdex, Supabase, cálculo das páginas do fichário.
- `src/store/collection.tsx` — estado da coleção (local + nuvem).
- `src/components/price-panel.tsx` — quadro de valor da carta: "Meu valor" ou mínimo/média/máximo do MYP.
- `src/components/value-range.tsx` — mínimo, média e máximo lado a lado (carta e Minha coleção).
- `src/components/myp-refresher.tsx` — busca os preços do MYP no celular (10 consultas/min, 1× por semana por carta).
- `src/components/ui.tsx` — componentes visuais (botões, campos, cartões, controle segmentado…).
- `src/theme.ts` — cores e medidas do tema Pokédex.
- `supabase/` — tabelas, regras de acesso, crons e as Edge Functions do catálogo.
- `scripts/make-icons.js` — gera o ícone, o ícone adaptativo do Android, o favicon e a imagem de abertura.
- `src/data/pokedex.json` — os 1025 Pokémon (nomes em PT, EN e JP), gerado a partir da PokéAPI.

## Licença

MIT. Pokémon e as marcas relacionadas pertencem à Nintendo, Creatures e Game Freak; este é um projeto de fã, sem vínculo com elas nem com as lojas citadas.
