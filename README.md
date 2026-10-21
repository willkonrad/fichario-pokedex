# Fichário Pokédex

App (Android/iOS, com Expo) para registrar as cartas do desafio da Pokédex no fichário.

- Fichário virtual com as mesmas dimensões do seu (bolsos por página, folhas, frente/verso), com o valor de cada carta embaixo dela.
- **Vários fichários** (toque no nome do fichário para abrir a estante):
  - **Pokédex**: um espaço (ou mais) por Pokémon; dá para limitar a uma região (ex.: só Kanto) e escolher nome e cor da capa.
  - **Livres** (coleção, coleção completa, favoritas, trocas, deck, graduadas…): você escolhe a carta de cada bolso pela busca por nome (qualquer Pokémon, treinador ou energia), e personaliza capa, tamanho da página, número de páginas, frente/verso, preços e numeração dos bolsos. Dá para mover cartas entre bolsos.
  - As cartas dos fichários livres usam o id `<fichário>:<bolso>` na tabela `entries`; o restante (cotação, sincronização) é igual.
- Todas as cartas de cada Pokémon em **português, inglês e japonês**, via [TCGdex](https://tcgdex.dev), buscadas pelo número da Pokédex **e** pelo nome (várias cartas novas vêm sem o número).
  - O catálogo em PT da TCGdex é incompleto (faltam coleções inteiras e cartas de coleções existentes, ex.: 71 Pikachus e a Nidorina da coleção de 30 anos). A aba PT completa com **toda carta do catálogo em inglês que não veio em PT** (mesmo id).
  - Cartas do **TCG Pocket** (jogo digital) ficam de fora.
- **Cache local**: listas e imagens reserva ficam em cache por 7 dias. Se o armazenamento do aparelho encher, o cache é apagado sozinho (as cartas nunca); também dá para limpar em **Menu → Limpar cache de cartas**.
- **Coleção Clássica de 30 Anos (30th-c)**: a Liga numera como a pokemontcg.io (Charizard = 004, Crobat G = 047), não como a TCGdex; o app monta a busca com esse número (`ligaNumbering` em `src/lib/ptcg.ts`).
- **Imagens**: TCGdex → imagem salva na carta → arquivo da coleção da pokemontcg.io no GitHub, **conferindo o nome da carta** (algumas coleções têm numeração diferente, ex.: 30th-c-011 Crobat G = me55c-47) → Scrydex pelo número só para coleções que não existem nesse arquivo (ex.: promos MEP).
- Estado (M, NM, SP, MP, HP, D), variação (holo, reverse, 1ª edição, Poké Ball…) e observações.
- Cotação automática em R$ da **LigaPokemon**: menor / médio / maior reais por acabamento (Normal, Foil, Reverse…).
- Coleção salva no aparelho e sincronizada na nuvem (Supabase).

## Rodar

```bash
npm install
```

```bash
npx expo start
```

Para testar no celular, instale o **Expo Go** compatível com o SDK 58 e escaneie o QR code.

## Nuvem (Supabase)

1. Crie um projeto gratuito em https://supabase.com.
2. No **SQL Editor**, rode `supabase/schema.sql` (troque `SEU_PROJECT_REF` no final).
3. Copie `.env.example` para `.env` e preencha a URL e a chave pública.
4. Publique as funções `supabase/functions/liga-price` e `supabase/functions/liga-sync` (esta última com verificação de JWT desligada; ela é protegida por uma chave guardada no Vault).
5. Em **Edge Functions → Secrets**, crie `APIFY_TOKEN` com o token da Apify (**Settings → API & Integrations**).

## Valor da carta (de onde vem)

O valor de cada carta segue esta ordem (`valueSource` em `src/lib/quotes.ts`):

1. **Vendas reais no idioma e estado da carta** — [Quanto vale minha carta?](https://quantovaleminhacarta.com.br) (Leilomania): mediana de vendas finalizadas e pagas no Brasil, por idioma (PT/EN/JP) e estado (M/NM/SP/MP/HP/D). O site autoriza apps a ler as páginas de carta públicas e pede só que a fonte seja citada (ver `/llms.txt` dele); a `/api/` dele é fechada e não é usada.
2. **Menor anúncio no MYP Cards no idioma da carta** — pelo [servidor MCP público do Zukan](https://www.zukan.com.br/llms.txt) (`get_card`, ids da TCGdex), feito para apps consultarem preços.
3. **Média dos anúncios na LigaPokemon** (abaixo).

A função `supabase/functions/qvmc-sync` (pg_cron a cada 10 min, minutos 5, 15, 25…) lê até 20 cartas por vez, com pausa entre páginas, e relê cada carta a cada 7 dias. Grava `sold` e `myp` na carta por `set_entry_fields` (só esses campos) e guarda as páginas em `qvmc_cache`, compartilhado entre usuários. **Custo: R$ 0.** O site usa os ids da pokemontcg.io; o id é conferido pelo nome da carta nos dados do GitHub da pokemontcg.io.

> Não usados: Poke Fichário (API privada; o robots.txt bloqueia robôs de IA), MYP e Liga direto (Cloudflare), scrapers da Apify com preço por anúncio (bovi: não lê o preço dos anúncios mais baratos; gio21/MYP: só dados de exemplo no plano grátis).

## Como a cotação funciona

A Liga não tem API pública e bloqueia acesso automático, então a cotação usa o scraper [getascraper/ligapokemon-scraper](https://apify.com/getascraper/ligapokemon-scraper) (~US$ 1,50 a cada 1.000 cartas).

- **Um único caminho grava preços:** a função `liga-sync` (cron). O app não grava preço por conta própria, e a função `liga-price` só lê o cache.
- **Conferência obrigatória:** antes de gravar, o cron confere se o resultado da Liga tem o **mesmo número**, a **mesma coleção** (nome da edição na Liga × nome da coleção em PT/EN) e **preços coerentes** (menor ≤ médio ≤ maior). Se algo não bater, a carta fica "sem cotação" e o motivo aparece na tela da carta — nunca mostra preço ou link de outra carta.
- **Use só o scraper getascraper/ligapokemon-scraper.** O dami_studio/ligapokemon-card-prices-scraper devolveu edições erradas (ex.: Kakuna de Holon Research Tower no lugar de Caos Ascendente) e foi removido.
- **3 janelas por dia (plano grátis):** o pg_cron chama a `liga-sync` a cada 10 min, mas ela só dispara uma execução do scraper por janela — **6h, 13h e 20h (Brasília)**, até 100 cartas cada, **por prioridade**: primeiro as cartas sem valor, depois as com valor atualizado há mais tempo (cartas que a Liga não achou nas últimas 24 h ficam por último). Cada carta guarda o horário da última verificação (`ligaCheckedAt`), mostrado na tela da carta; o menu mostra a última atualização da coleção. Isso cabe no limite grátis do scraper (3 execuções por 24 h, 30 min entre elas). Para mudar os horários, edite `WINDOW_UTC_HOURS` em `supabase/functions/liga-sync/index.ts`.
- **Estado da carta:** a faixa da Liga junta todos os estados; o app não estima descontos. Preço real por estado exige o modo de ofertas do scraper [gio21/ligapokemon-scraper](https://apify.com/gio21/ligapokemon-scraper), disponível só no plano pago da Apify.
- **Idioma:** a faixa de preço da Liga junta todos os idiomas da edição.

## Estrutura

- `src/app/` — telas (Expo Router): fichário, configuração, cartas do Pokémon, carta, conta.
- `src/lib/` — TCGdex, cotação da Liga, Supabase, cálculo das páginas.
- `src/store/collection.tsx` — estado da coleção (local + nuvem) e cotação ao salvar.
- `supabase/` — tabelas, cron e Edge Functions.
- `src/data/pokedex.json` — 1025 Pokémon (nome EN/PT e JP), gerado a partir da PokéAPI.
