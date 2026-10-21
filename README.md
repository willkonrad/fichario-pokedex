# Fichário Pokédex

App pessoal e gratuito para colecionadores de Pokémon TCG: organize suas cartas em fichários virtuais iguais aos de verdade e acompanhe quanto a sua coleção vale ao longo do tempo, em reais.

> **Projeto pessoal, sem fins comerciais.** Não vende nada, não cobra assinatura, não exibe anúncios e não revende dados. O código é aberto (licença MIT).

## O que o app faz

- **Fichários virtuais** com as mesmas dimensões do seu (bolsos por página, folhas, frente e verso):
  - **Pokédex**: um espaço por Pokémon, com opção de limitar a uma região (ex.: só Kanto);
  - **Livres**: coleção, coleção completa, favoritas, trocas, deck, graduadas — você escolhe a carta de cada bolso.
- **Catálogo completo** em português, inglês e japonês ([TCGdex](https://tcgdex.dev)), com estado (M, NM, SP, MP, HP, D) e variação (holo, reverse, 1ª edição, Poké Ball, promos com selo…).
- **Valor de cada carta em reais, só do [MYP Cards](https://mypcards.com)**, com link para a loja e o grau de confiança do valor.
- **Valor da coleção** e **histórico diário** de cada carta, para gráficos de valorização.
- **"Meu valor"**: o colecionador pode informar o preço que conferiu; ele tem prioridade sobre o MYP.
- Coleção salva no aparelho e sincronizada na nuvem (Supabase), com login próprio.

## Fontes de dados e atribuição

**Todos os preços vêm do [MYP Cards](https://mypcards.com)** — cada valor exibido no app cita o MYP Cards, com link para mypcards.com.

| Fonte | O que fornece | Como é acessada |
|---|---|---|
| [MYP Cards](https://mypcards.com) | Preços das cartas em reais | [API oficial do MYP Cards](https://github.com/MYPCards/mypcards-api) *(acesso solicitado)*; até lá, o [servidor MCP público do Zukan](https://www.zukan.com.br/llms.txt), que repassa o menor anúncio do MYP |
| [TCGdex](https://tcgdex.dev) | Catálogo e imagens das cartas (sem preços) | API pública |

### Uso responsável

- **Só as cartas da coleção** são consultadas — nada de varrer catálogos inteiros.
- **Atualização semanal**: cada carta é consultada no máximo uma vez por semana.
- **Cache compartilhado**: a mesma carta em vários fichários ou contas é consultada uma única vez.
- **Volume pequeno**: cerca de 1.000 cartas por semana, ou ~150–200 consultas por dia.
- Os dados ficam só no app do próprio colecionador; não são publicados, revendidos nem redistribuídos.

## Como o valor da carta é definido

Em `src/lib/valuation.ts`, na ordem:

1. **"Meu valor"** informado pelo colecionador, quando existe;
2. a **menor oferta no MYP Cards no estado e idioma da carta**, quando a API oferecer;
3. o **menor anúncio no MYP Cards no idioma da carta**.

Sem nenhum desses, a carta fica **sem preço** — o app não usa outras fontes para preencher.

Um snapshot diário (`snapshot_prices`, 23:50 de Brasília) guarda o valor de cada carta em `price_history`, base dos gráficos de valorização.

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
4. Publique a Edge Function `supabase/functions/myp-sync` (preços do MYP Cards; cron a cada 10 min, cada carta 1× por semana), com verificação de JWT desligada — ela é protegida por uma chave guardada no Vault.
5. Quando a API do MYP for liberada, crie em **Edge Functions → Secrets** a chave `MYP_API_TOKEN`.

Nenhuma chave ou senha fica no código: todas ficam nos Secrets do Supabase ou no `.env` local, que não vai para o repositório.

## Estrutura

- `src/app/` — telas (Expo Router): fichários, carta, busca, menu, conta.
- `src/lib/valuation.ts` — regra do valor de referência.
- `src/lib/` — TCGdex, Supabase, cálculo das páginas do fichário.
- `src/store/collection.tsx` — estado da coleção (local + nuvem).
- `src/components/price-panel.tsx` — quadro de preço do MYP Cards e o histórico.
- `supabase/` — tabelas, regras de acesso, cron e a Edge Function de preços.
- `src/data/pokedex.json` — os 1025 Pokémon (nomes em PT, EN e JP), gerado a partir da PokéAPI.

## Licença

MIT. Pokémon e as marcas relacionadas pertencem à Nintendo, Creatures e Game Freak; este é um projeto de fã, sem vínculo com elas nem com as lojas citadas.
