# Fichário Pokédex

App pessoal e gratuito para colecionadores de Pokémon TCG: organize suas cartas em fichários virtuais iguais aos de verdade e acompanhe quanto a sua coleção vale ao longo do tempo, em reais.

> **Projeto pessoal, sem fins comerciais.** Não vende nada, não cobra assinatura, não exibe anúncios e não revende dados. O código é aberto (licença MIT).

## O que o app faz

- **Fichários virtuais** com as mesmas dimensões do seu (bolsos por página, folhas, frente e verso):
  - **Pokédex**: um espaço por Pokémon, com opção de limitar a uma região (ex.: só Kanto). Os bolsos que sobram na última página ficam **livres para cartas especiais**;
  - **Livres**: coleção, coleção completa, favoritas, trocas, deck, graduadas — você escolhe a carta de cada bolso.
- **Folheie como um fichário de verdade**: arraste a página para o lado; no computador, fichários frente e verso abrem **duas páginas lado a lado**, com a capa (com o nome do fichário) ao lado da primeira página.
- **Catálogo completo** em português, inglês e japonês ([TCGdex](https://tcgdex.dev)), com estado (M, NM, SP, MP, HP, D) e variação (holo, reverse, 1ª edição, Poké Ball, promos com selo…).
- **Valor de cada carta em reais**, do **menor anúncio no [MYP Cards](https://mypcards.com)** ou, sem anúncio, de **vendas reais finalizadas** ([Quanto vale minha carta?](https://quantovaleminhacarta.com.br)) no estado e idioma da carta, com link para a fonte e o grau de confiança do valor.
- **Minha coleção**: valor total, **gráfico da evolução do valor** (1M, 3M, 6M, 1A) e as cartas mais valiosas.
- **"Meu valor"**: o colecionador pode informar o preço que conferiu; ele tem prioridade sobre as outras fontes até o MYP passar dele (aí é apagado e volta o MYP).
- **Origem da carta**: troca, booster ou compra; na compra, o valor pago e quanto a carta valorizou desde então.
- **Salvamento automático**: mudar o estado, a variação, o valor ou as observações de uma carta salva na hora.
- Visual inspirado na Pokédex e no Nintendo Switch: barras vermelhas, cartões brancos e as páginas do fichário escuras como folhas plásticas.
- Coleção salva no aparelho e sincronizada na nuvem (Supabase), com login próprio.

As novidades de cada versão estão em [CHANGELOG.md](CHANGELOG.md).

## Fontes de dados e atribuição

Os preços vêm de duas fontes brasileiras: o **MYP Cards** é a principal e as **vendas reais** são a reserva, para cartas sem anúncio. Cada valor exibido no app cita a sua fonte, com link.

| Fonte | O que fornece | Como é acessada |
|---|---|---|
| [MYP Cards](https://mypcards.com) | Preços das cartas em reais | [API oficial do MYP Cards](https://github.com/MYPCards/mypcards-api) *(acesso solicitado)*; até lá, o [servidor MCP público do Zukan](https://www.zukan.com.br/llms.txt), que repassa o menor anúncio do MYP |
| [Quanto vale minha carta?](https://quantovaleminhacarta.com.br) | Vendas reais finalizadas, por estado e idioma | Páginas públicas das cartas, cujo uso e citação o site autoriza no seu [llms.txt](https://quantovaleminhacarta.com.br/llms.txt) (citar a fonte, dizer que são vendas reais, preservar idioma e estado, avisar quando há poucas vendas) |
| [TCGdex](https://tcgdex.dev) | Catálogo e imagens das cartas (sem preços) | API pública |

### Uso responsável

- **Só as cartas da coleção** são consultadas — nada de varrer catálogos inteiros.
- **Atualização semanal**: o preço do MYP de cada carta é renovado a cada 6 dias (nunca fica com mais de uma semana) e as vendas reais, 1× por semana.
- **Cache compartilhado**: a mesma carta em vários fichários ou contas é consultada uma única vez.
- **Volume pequeno**: cerca de 1.000 cartas por semana, ou ~150–200 consultas por dia.
- Os dados ficam só no app do próprio colecionador; não são publicados, revendidos nem redistribuídos.

## Como o valor da carta é definido

Em `src/lib/valuation.ts`, na ordem:

1. **"Meu valor"** informado pelo colecionador, quando existe — se o MYP passar dele, o servidor apaga o "Meu valor" e a carta volta a usar o MYP;
2. a **menor oferta no MYP Cards no estado e idioma da carta**, quando a API oferecer;
3. o **menor anúncio no MYP Cards no idioma da carta** (confiança média);
4. sem anúncio no MYP: a **mediana das vendas reais no estado e idioma da carta** (confiança média com 3 ou mais vendas, baixa com 1 ou 2).

Vendas reais só contam quando são **da mesma variação da carta** (ex.: vendas da versão Normal não valem para uma promo carimbada); senão aparecem só como referência. Sem nenhuma fonte, a carta fica **sem preço** — o app não estima valores (ex.: preço americano convertido com desconto fixo por estado).

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
4. Publique a Edge Function `supabase/functions/price-sync` (MYP Cards e vendas reais; cron a cada 10 min, MYP a cada 6 dias, vendas 1× por semana), com verificação de JWT desligada — ela é protegida por uma chave guardada no Vault.
5. Quando a API do MYP for liberada, crie em **Edge Functions → Secrets** a chave `MYP_API_TOKEN`.

Nenhuma chave ou senha fica no código: todas ficam nos Secrets do Supabase ou no `.env` local, que não vai para o repositório.

## Estrutura

- `src/app/` — telas (Expo Router): fichários, carta, busca, menu, conta.
- `src/lib/valuation.ts` — regra do valor de referência.
- `src/lib/` — TCGdex, Supabase, cálculo das páginas do fichário.
- `src/store/collection.tsx` — estado da coleção (local + nuvem).
- `src/components/price-panel.tsx` — quadro de valor da carta, vendas reais por estado e o histórico.
- `src/components/ui.tsx` — componentes visuais (botões, campos, cartões, controle segmentado…).
- `src/theme.ts` — cores e medidas do tema Pokédex.
- `supabase/` — tabelas, regras de acesso, cron e a Edge Function de preços.
- `scripts/make-icons.js` — gera o ícone, o ícone adaptativo do Android, o favicon e a imagem de abertura.
- `src/data/pokedex.json` — os 1025 Pokémon (nomes em PT, EN e JP), gerado a partir da PokéAPI.

## Licença

MIT. Pokémon e as marcas relacionadas pertencem à Nintendo, Creatures e Game Freak; este é um projeto de fã, sem vínculo com elas nem com as lojas citadas.
