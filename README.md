# Fichário Pokédex

App pessoal e gratuito para colecionadores de Pokémon TCG: organize suas cartas em fichários virtuais iguais aos de verdade e acompanhe quanto a sua coleção vale ao longo do tempo, em reais.

> **Projeto pessoal, sem fins comerciais.** Não vende nada, não cobra assinatura, não exibe anúncios e não revende dados. O código é aberto (licença MIT).

## O que o app faz

- **Fichários virtuais** com as mesmas dimensões do seu (bolsos por página, folhas, frente e verso):
  - **Pokédex**: um espaço por Pokémon, com opção de limitar a uma região (ex.: só Kanto). Os bolsos que sobram na última página ficam livres para cartas especiais ("bolso extra");
  - **Livres**: coleção, favoritas, trocas, deck, graduadas — você escolhe a carta de cada bolso.
- **Folheie como um fichário de verdade**: a página acompanha o dedo; cada fichário lembra a página em que você parou; "Ir para a página", **"Próxima falta"** e a régua de regiões ("Kanto 31/151") levam direto ao que falta. No computador, fichários frente e verso abrem duas páginas lado a lado.
- **Posição física**: cada carta mostra onde está no fichário de verdade ("Fichário 2 · folha 5 (frente) · bolso 8"), e o app avisa antes de uma mudança de configuração mexer nas cartas.
- **"+ Carta"**: busque (sem se preocupar com acento ou apóstrofo, por nome e número ou por código, como "MEG 133"), escolha versão, estado e onde colocar, e siga para a próxima. Toda ação tem **"Desfazer"**.
- **Catálogo completo** em português, inglês e japonês: o catálogo da TCGplayer (via TCGCSV), com as versões com selo e a foto oficial de cada uma, ligado à [TCGdex](https://tcgdex.dev) (nome e imagem em português, ficha, variações). Estado (M, NM, SP, MP, HP, D) e variação (holo, reverse, 1ª edição, Poké Ball, promos com selo…).
- **Valor de cada carta em reais**: menor anúncio, média dos anúncios e maior anúncio no **[MYP Cards](https://mypcards.com)**, sempre com link para o MYP; **cartas em inglês** pelo preço da **TCGplayer** (EUA), em reais pela PTAX do Banco Central. Você escolhe qual dos três "Usar na soma", ou fixa o **"Meu valor"**.
- **Minha coleção**: "Valor da coleção", evolução do valor (1M, 3M, 6M, 1A) com a variação só das mesmas cartas, mais valiosas, maiores altas e quedas, e **Compras** (quanto você pagou × quanto valem hoje).
- **Buscar na coleção** (em todos os fichários, sem internet) e listas **"Preciso"** e **"Tenho repetida"**, prontas para mandar no WhatsApp.
- **Origem da carta** (troca, booster ou compra), observações e **salvamento automático**.
- **Coleção no aparelho e na nuvem** (Supabase, com login próprio): sincronização incremental entre aparelhos, remoções que chegam a todos eles, cópia da coleção em JSON ou planilha e **cópia diária automática** no servidor.
- Visual inspirado na Pokédex e no Nintendo Switch, com contraste AA, leitor de tela e teclado no computador. O sistema visual está em [docs/design.md](docs/design.md).

As novidades de cada versão estão em [CHANGELOG.md](CHANGELOG.md).

## Fontes de dados e atribuição

Os preços vêm do **MYP Cards** e, nas cartas em inglês, da **TCGplayer** (via TCGCSV), ou do "Meu valor" digitado pelo colecionador. Cada valor exibido no app cita a fonte, com link. A tela **"Sobre e fontes"** do app mostra os créditos, como o valor é calculado e quando o catálogo foi atualizado pela última vez.

| Fonte | O que fornece | Como é acessada |
|---|---|---|
| [MYP Cards](https://mypcards.com) | Menor anúncio, média dos anúncios e maior anúncio de cada carta, em reais | [API pública do MYP Cards](https://mypcards.com/acesso-api) ([documentação](https://mypcards.github.io/mypcards-api)). Sem token: 10 consultas/min e só aparelhos (o servidor recebe 403 e o navegador não tem CORS), então **o app no celular** busca aos poucos e grava no banco. Atribuição "MYP Cards" com link em todo valor |
| [TCGCSV](https://tcgcsv.com) | **Base principal do catálogo**: cartas de todas as coleções (inclusive as lançadas ontem) e versões com selo vendidas à parte, com a foto de cada uma — inclusive as que a TCGplayer guarda em coleções de diversos (Booster Box, Prize Pack, Liga, Build-A-Bear…), ligadas à carta de origem pelo número completo. **Preços da TCGplayer** (menor anúncio, mediana e valor de mercado, em dólar, por impressão) das cartas em inglês | Espelho gratuito do catálogo e dos preços da TCGplayer (obrigado, TCGCSV!), copiado 1×/dia por coleção para o Supabase pela Edge Function `catalog-sync`, seguindo as [regras de uso](https://tcgcsv.com/docs#usage-guidelines). Cada execução fica registrada (`catalog_sync_runs`). **O app nunca chama o TCGCSV**: só lê a cópia |
| [Banco Central do Brasil](https://www.bcb.gov.br) | Dólar PTAX (venda) de cada dia útil, para converter os preços da TCGplayer | API pública de séries do BCB (SGS, série 1), lida pela `catalog-sync` 1×/dia depois do fechamento |
| [TCGdex](https://tcgdex.dev) | Catálogo secundário: nome e imagem em português, ficha (ataques, HP…), variações e número da Pokédex | API pública |
| [Zukan](https://www.zukan.com.br) | Cartas novas que a TCGdex ainda não tem (ex.: promos MEP recentes) e imagem reserva | Servidor MCP público |
| [pokemontcg.io](https://pokemontcg.io) / Scrydex | Imagem reserva de cartas sem imagem na TCGdex | Arquivos públicos no GitHub e CDN de imagens |
| [PokeAPI](https://pokeapi.co) | Nomes dos 1.025 Pokémon (PT, EN, JP) e as ilustrações dos bolsos vazios | Arquivo gerado uma vez (`src/data/pokedex.json`) e imagens públicas no GitHub |

### Uso responsável

- **No MYP Cards, só as cartas da coleção** são consultadas, uma vez por semana cada, no máximo 10 consultas por minuto; a mesma carta em vários fichários é consultada uma única vez. Cerca de 1.000 cartas por semana, ou ~150–200 consultas por dia.
- O único catálogo copiado inteiro é o do **TCGCSV**, que existe para isso e tem regras de uso: o `catalog-sync` só baixa de novo uma coleção quando ela muda, com pausa entre as requisições.
- Nada de raspar páginas (MYP, Liga e outros sites) nem de contornar bloqueios. As regras completas estão em [AGENTS.md](AGENTS.md).
- Os dados ficam só no app do próprio colecionador; não são publicados, revendidos nem redistribuídos.

## Como o valor da carta é definido

O **valor da carta** vem da primeira fonte que existir, nesta ordem:

1. **"Meu valor"**, digitado por você: o único valor fixo. Ele vale até o preço de mercado passar dele (a média do MYP Cards; o mercado da TCGplayer nas cartas em inglês); aí o app volta a usar o mercado e avisa você;
2. **cartas em inglês**: a **TCGplayer (EUA)**, convertida em reais pela **PTAX** do dia — *Menor anúncio*, *Mercado* (vendas recentes) e *Mediana* dos anúncios, da impressão certa (normal, holo, reverse, 1ª edição…) e do produto próprio da versão com selo;
3. o **MYP Cards** — *Menor anúncio*, *Média dos anúncios* e *Maior anúncio*, que juntam todos os estados e idiomas, do produto próprio da versão quando o MYP vende a versão à parte.

Em cada carta, **"Usar na soma"** escolhe qual dos três preços é o valor dela (a média, se você não escolher; o menor anúncio costuma ser o valor real de cartas novas). **"≈ Aproximado"** marca o preço que não é exatamente o desta carta: a versão (selo, Poké Ball…) não é vendida à parte e vale o preço da carta base, ou a carta em inglês não tem preço na TCGplayer e usa os anúncios do MYP Cards. Sem nenhuma fonte, a carta fica **sem valor** até você preencher "Meu valor": **o app não estima preço** nem dá desconto pelo estado da carta.

O **"Valor deste fichário"** e o **"Valor da coleção"** são a soma do valor de cada carta, que também aparece nos bolsos, ordena as mais valiosas e é a linha do gráfico. Com menos destaque, a coleção mostra quanto daria "se cada carta saísse pelo menor anúncio · pela média"; a soma dos maiores anúncios fica só em "Como calculamos", porque não é preço de venda.

A regra mora em `src/lib/valuation.ts` (valor atual), `src/lib/history.ts` (fotos diárias) e nas funções `history_value` e `snapshot_prices` do banco, sempre iguais; os nomes e textos do valor ficam em `src/lib/copy.ts`.

### Preços, histórico e cópias no servidor

- O `catalog-sync` (cron a cada 10 min) copia os preços do TCGCSV para `tcg_prices` 1×/dia por coleção e a PTAX para `fx_rates`; o app (no celular e na web) lê essas tabelas e grava o preço na carta (`patch_entry_tcgplayer`).
- O preço do MYP é buscado pelo app no celular e gravado na carta (`patch_entry_myp`). Gravar um preço não conta como edição da carta.
- Todo dia às 23:50 de Brasília, `snapshot_prices` guarda em `price_history` o "Meu valor", o preço da TCGplayer do dia (cartas em inglês) e o do MYP de cada carta com preço; o gráfico pede ao servidor o total de cada dia (`collection_history`).
- Todo dia às 00:20, `backup.snapshot_collection` copia as cartas e a configuração para o schema `backup` (14 dias, fora da API).

## Rodar o app

```bash
npm install
npx expo start
```

Para testar no celular, instale o **Expo Go** compatível com o SDK 58 e escaneie o QR code. Também roda no navegador (`w` no terminal do Expo).

## Testes e verificação

```bash
npm test             # testes automatizados (Jest, com jest-expo)
npm run typecheck    # tsc --noEmit
npm run lint         # expo lint
```

Rode os três antes de dar uma mudança por pronta. Os testes ficam em `tests/` e cobrem a lógica pura (valor da carta, formatação, histórico, reconhecimento de produto, contas do fichário, "+ Carta", listas), sem rede; as telas se conferem no app.

## Servidor (Supabase)

1. Crie um projeto gratuito em [supabase.com](https://supabase.com).
2. Rode `supabase/schema.sql` no **SQL Editor** (antes, troque `SEU_PROJECT_REF` no bloco do cron `catalog-sync`, no fim do arquivo). O arquivo é o retrato completo do banco e pode rodar mais de uma vez.
3. Copie `.env.example` para `.env` e preencha a URL e a chave pública do projeto.
4. Publique as Edge Functions:
   ```bash
   npx supabase functions deploy catalog-sync --no-verify-jwt   # chamada pelo cron; protegida pela chave guardada no Vault
   npx supabase functions deploy stamp-image                    # foto da versão com selo, chamada pelo app
   ```
5. Os preços do MYP são buscados pelo app no celular (sem token, a API do MYP não atende servidores).

Mudanças no banco já em uso vão num arquivo novo em `supabase/migrations/`, aplicado com `npx supabase db query --linked -f supabase/migrations/<arquivo>.sql` (ou pelo MCP do Supabase) e depois espelhado em `supabase/schema.sql`. O passo a passo está em [docs/arquitetura.md](docs/arquitetura.md).

Nenhuma chave ou senha fica no código: todas ficam nos Secrets do Supabase (e no Vault, a chave do cron) ou no `.env` local, que não vai para o repositório. O repositório é público: confira se não há segredo no que vai subir antes de cada push.

## Estrutura

- `src/app/` — telas (Expo Router): fichário (`index`), carta, busca e "+ Carta" (`search`), cartas de um Pokémon (`pokemon/[dex]`), buscar na coleção (`find`), listas (`lists`), Minha coleção (`menu`), fichários, configuração, conta e "Sobre e fontes" (`about`).
- `src/store/collection.tsx` — a coleção: armazenamento no aparelho (uma chave por carta), sincronização com o Supabase e os ganchos de leitura por assunto.
- `src/lib/valuation.ts` — regra do valor da carta; `quotes.ts` — somas da coleção; `history.ts` — histórico e variação; `copy.ts` — nomes e textos do valor; `format.ts` — reais, números e datas.
- `src/lib/myp-api.ts`, `myp-match.ts`, `tcgplayer.ts` — preços do MYP Cards e da TCGplayer.
- `src/lib/tcgdex.ts`, `catalog.ts`, `variants.ts`, `ptcg.ts` — catálogo, busca, versões e imagens reserva.
- `src/lib/binder.ts` — contas das páginas e da posição física; `add-card.ts` — fluxo "+ Carta"; `lists.ts` — buscar na coleção e listas; `backup.ts` — exportar e importar.
- `src/components/` — componentes visuais (`ui.tsx` reexporta toast, folha de informação, esboços e ícones), partes das telas (`home-*`, `collection-*`, `add-*`, `card-*`) e os buscadores de preço em segundo plano (`myp-refresher.tsx`, `tcgplayer-refresher.tsx`).
- `src/theme.ts` — cores com significado, tipografia, espaços e larguras.
- `src/data/pokedex.json` — os 1.025 Pokémon (nomes em PT, EN e JP), gerado a partir da PokéAPI.
- `supabase/schema.sql` — o banco inteiro; `supabase/migrations/` — as mudanças aplicadas em cada versão; `supabase/functions/` — Edge Functions `catalog-sync` e `stamp-image`.
- `tests/` — testes automatizados (Jest) da lógica pura.
- `scripts/make-icons.js` — gera o ícone, o ícone adaptativo do Android, o favicon e a imagem de abertura.
- `docs/` — [arquitetura](docs/arquitetura.md) (mapa para quem chega), [design](docs/design.md) (sistema visual) e o registro das revisões da 2.0.0.

## Licença

MIT. Pokémon e as marcas relacionadas pertencem à Nintendo, Creatures e Game Freak; este é um projeto de fã, sem vínculo com elas nem com as lojas citadas.
