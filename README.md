# Fichário Pokédex

App pessoal e gratuito para colecionadores de Pokémon TCG: organize suas cartas em fichários virtuais iguais aos de verdade e acompanhe quanto a sua coleção vale ao longo do tempo, em reais.

> **Projeto pessoal, sem fins comerciais.** Não vende nada, não cobra assinatura, não exibe anúncios e não revende dados. O código é aberto (licença MIT).

## O que o app faz

- **Fichários virtuais** com as mesmas dimensões do seu (bolsos por página, folhas, frente e verso):
  - **Pokédex**: um espaço por Pokémon, com opção de limitar a uma região (ex.: só Kanto);
  - **Livres**: coleção, coleção completa, favoritas, trocas, deck, graduadas — você escolhe a carta de cada bolso.
- **Catálogo completo** em português, inglês e japonês ([TCGdex](https://tcgdex.dev)), com estado (M, NM, SP, MP, HP, D) e variação (holo, reverse, 1ª edição, Poké Ball, promos com selo…).
- **Valor de cada carta em reais**, com as fontes citadas e um link para cada uma, e o grau de confiança do valor.
- **Valor da coleção** e **histórico diário** de cada carta, para gráficos de valorização.
- **"Meu valor"**: o colecionador pode informar o preço que conferiu; ele tem prioridade sobre as fontes.
- Coleção salva no aparelho e sincronizada na nuvem (Supabase), com login próprio.

## Fontes de dados e atribuição

Todos os preços exibidos no app citam a fonte, com link para a página de origem.

| Fonte | O que fornece | Como é acessada |
|---|---|---|
| [MYP Cards](https://mypcards.com) | Preços em reais (menor, médio e maior) | [API oficial do MYP Cards](https://github.com/MYPCards/mypcards-api) *(acesso solicitado)* e [servidor MCP público do Zukan](https://www.zukan.com.br/llms.txt) |
| [Quanto vale minha carta?](https://quantovaleminhacarta.com.br) | Vendas reais concluídas no Brasil, por idioma e estado | Páginas públicas de carta, como o `/llms.txt` do site autoriza |
| [LigaPokemon](https://www.ligapokemon.com.br) | Faixa de preços anunciados (menor, médio, maior) | Scraper de terceiros na Apify, 3 vezes por dia |
| [TCGdex](https://tcgdex.dev) | Catálogo, imagens e preços de TCGplayer e Cardmarket | API pública |
| [Frankfurter](https://frankfurter.dev) (BCE) | Câmbio do dia (US$ e € → R$) | API pública |

### Uso responsável

- **Só as cartas da coleção** são consultadas — nada de varrer catálogos inteiros.
- **Atualização espaçada**: cada carta é consultada no máximo uma vez por semana em cada fonte (a Liga, até 3 vezes por dia em lote).
- **Cache compartilhado**: a mesma carta em vários fichários ou contas é consultada uma única vez.
- **Volume pequeno**: cerca de 1.000 cartas por semana, ou ~150–200 consultas por dia.
- Os dados ficam só no app do próprio colecionador; não são publicados, revendidos nem redistribuídos.

## Como o valor da carta é definido

Em `src/lib/valuation.ts`:

1. **"Meu valor"** informado pelo colecionador, quando existe;
2. senão, o **menor anúncio no MYP Cards no estado e idioma da carta**, quando disponível;
3. senão, o **menor anúncio na LigaPokemon** — a não ser que as fontes brasileiras (vendas reais e MYP) concordem num valor acima dele, sinal de que o mínimo da Liga é uma cópia jogada;
4. sem anúncio no Brasil, a mediana ponderada das demais fontes.

As outras fontes conferem o valor e definem a confiança (alta, média ou baixa). Quando elas indicam um valor muito maior que o menor anúncio, o app avisa que o anúncio pode ser de uma carta danificada e sugere conferir.

Um snapshot diário (`snapshot_prices`, 23:50 de Brasília) guarda o valor e as fontes de cada carta em `price_history`, base dos gráficos de valorização.

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
4. Publique as Edge Functions de `supabase/functions/`:
   - `liga-sync` — cotação da Liga (cron a cada 10 min, 3 lotes por dia);
   - `qvmc-sync` — vendas reais, MYP (Zukan), TCGplayer, Cardmarket e câmbio (cron a cada 10 min, cada carta 1× por semana);
   - `liga-price` — leitura do cache da Liga pelo app.

   As funções de cron rodam com verificação de JWT desligada e são protegidas por uma chave guardada no Vault.
5. Em **Edge Functions → Secrets**, crie as chaves que for usar: `APIFY_TOKEN` (Liga) e, opcionalmente, `CARDTRADER_TOKEN`.

Nenhuma chave ou senha fica no código: todas ficam nos Secrets do Supabase ou no `.env` local, que não vai para o repositório.

## Estrutura

- `src/app/` — telas (Expo Router): fichários, carta, busca, menu, conta.
- `src/lib/valuation.ts` — regra do valor de referência.
- `src/lib/` — TCGdex, Liga, Supabase, cálculo das páginas do fichário.
- `src/store/collection.tsx` — estado da coleção (local + nuvem).
- `src/components/price-panel.tsx` — quadro de preço com as fontes e o histórico.
- `supabase/` — tabelas, regras de acesso, cron e Edge Functions.
- `src/data/pokedex.json` — os 1025 Pokémon (nomes em PT, EN e JP), gerado a partir da PokéAPI.

## Licença

MIT. Pokémon e as marcas relacionadas pertencem à Nintendo, Creatures e Game Freak; este é um projeto de fã, sem vínculo com elas nem com as lojas citadas.
