# Arquitetura do Fichário Pokédex

Mapa curto para quem chega no projeto (versão 3.0). As regras fixas (o que nunca fazer com as fontes, segredos, valor) estão no [AGENTS.md](../AGENTS.md); o sistema visual, em [design.md](design.md); o que o app faz e a regra do valor, no [README](../README.md).

## Visão geral

Um app Expo (SDK 58, Expo Router, React 19 com o React Compiler) que roda no celular e no navegador. A coleção vive no aparelho e, com conta, é sincronizada com o Supabase (Postgres, Auth, Edge Functions e pg_cron). Não há servidor próprio: o que roda fora do aparelho são as funções e os crons do Supabase.

```
APARELHO (celular / web)               SUPABASE                                FONTES EXTERNAS

store/collection.tsx  <--- sync --->   entries, binder_settings,
  AsyncStorage (binder:*)              entry_tombstones (remoções)

MypRefresher (só celular) ---------------------------------------------->  MYP Cards (API pública)
  '-- patch_entry_myp ----------->     entries.data.mypApi

TcgplayerRefresher  <----- lê -----    tcg_catalog, tcg_prices,   <-- catalog-sync  <--  TCGCSV, BCB, TCGdex
  '-- patch_entry_tcgplayer ----->     fx_rates, catalog_sync_runs    (Edge Function,
                                       entries.data.tcgplayer          cron a cada 10 min)

tcgdex.ts / catalog.ts  ------------------------------------------------>  TCGdex, Zukan, Scrydex

Minha coleção  <----- lê ---------     price_history  <-- price-snapshot (23:50)
                                       backup.*       <-- collection-backup (00:20)
```

## Pastas

| Pasta | O que tem |
|---|---|
| `src/app/` | Telas (cada arquivo é uma rota): `index` (fichário), `card`, `search` (escolher carta e "+ Carta"), `pokemon/[dex]`, `find`, `lists`, `menu` (Minha coleção), `binders`, `binder-edit`, `setup`, `account`, `about`. `_layout.tsx` monta o provider da coleção, os buscadores de preço, o toast e as telas de erro. |
| `src/store/` | `collection.tsx`: estado da coleção, armazenamento no aparelho, sincronização e os ganchos de leitura (`useEntries`, `useEntry`, `useSettings`, `useBinders`, `useActiveBinderId`, `useSyncStatus`, `useCollectionActions`…). |
| `src/lib/` | Lógica sem tela: valor (`valuation`, `quotes`, `history`), textos e formatos (`copy`, `format`), preços (`myp-api`, `myp-match`, `tcgplayer`), catálogo (`tcgdex`, `catalog`, `variants`, `ptcg`, `stamp-image`), fichário (`binder`), adicionar e listas (`add-card`, `lists`), cópia (`backup`), Supabase (`supabase`) e tipos (`types`). |
| `src/components/` | `ui.tsx` (componentes base e reexporta toast, folha de informação, esboços, ícones, layout), partes das telas (`home-*`, `card-*`, `collection-*`, `add-*`), `binder-slot`, `card-grid`, `card-image`, `price-panel`, `line-chart` e os buscadores `myp-refresher` e `tcgplayer-refresher`. |
| `src/theme.ts` | Tokens: cores com significado (`semantic`), tipografia (`type`), espaços, larguras e contraste. |
| `src/data/` | `pokedex.json` (1.025 Pokémon em PT, EN e JP) e a busca de espécies (`pokedex.ts`). |
| `supabase/` | `schema.sql` (o banco inteiro), `migrations/` (o que mudou em cada versão) e `functions/` (`catalog-sync`, `stamp-image`). |
| `tests/` | Testes automatizados (Jest com `jest-expo`) da lógica pura; configuração em `jest.config.js`. |
| `scripts/` | `make-icons.js` (ícones e imagem de abertura). |

## Fluxo dos dados

### Coleção: aparelho ↔ Supabase

- **No aparelho** (AsyncStorage): uma chave por carta (`binder:e:<id>`), mais `binder:settings`, `binder:active`, `binder:pending` (alterações que a nuvem ainda não confirmou), `binder:deleted` (remoções ainda não confirmadas) e `binder:sync` (dono, cursor e datas). As gravações são agrupadas (400 ms). Uma chave que não dá para ler bloqueia a gravação dela naquela sessão, e um JSON estragado é copiado para `binder:ilegivel:*`: nada é apagado.
- **Identidade da carta = posição**: `"<dex>-<espaço>"` no Pokédex e `"<fichário>:<bolso>"` nos fichários livres. Mover uma carta é apagar um id e criar outro; por isso as remoções precisam de registro no servidor.
- **Envio**: as alterações vão juntas 300 ms depois da última (upsert em `entries`; `binder_settings` à parte). As remoções vão pela RPC `delete_entries(p)` com a hora de cada remoção; o servidor não apaga uma carta alterada depois disso. O gatilho `entries_tombstone` registra cada carta apagada em `entry_tombstones` (180 dias); recolocar a carta no mesmo bolso apaga o registro.
- **Recebimento** (`runSync`): completo ao entrar no app, pelo menos 1×/dia, num aparelho que nunca sincronizou com a conta ou num banco sem a migração 3.0; nos outros casos, **incremental**: `entries` com `updated_at` depois do cursor (menos 2 min de folga) e `entry_tombstones` com `deleted_at` depois do cursor. O `updated_at` é do relógio do servidor (gatilho `touch_updated_at`); o `updatedAt` dentro de `data` é o da última edição do usuário. Sincroniza também na volta ao app e a cada 15 min.
- **Conflitos** (`mergeEntry`, `mergeSettings`): os campos do usuário seguem o `updatedAt` mais novo; os preços (`mypApi`, `tcgplayer`) seguem o `checkedAt` mais novo e só valem para a mesma carta, versão e idioma. No banco, `entries_keep_newer_prices` impede que um envio com preço mais velho desfaça o mais novo. Uma remoção vinda da nuvem não apaga uma alteração local ainda não enviada feita depois dela (folga de 2 min, `CLOCK_SKEW_MS`). Num aparelho que nunca sincronizou com a conta, vale a configuração da nuvem e os fichários livres são juntados por id.
- **Estado** (`syncStatus`): `local`, `syncing`, `ok`, `offline` ou `error`, com o número de pendências e a mensagem em português. Falha: nova tentativa em 30 s, 2 min e depois a cada 10 min.
- **Cópia pelo usuário**: `src/lib/backup.ts` (JSON e CSV, sem preços por padrão), usada por `exportCollection`/`importCollection`.

### Preços

- **MYP Cards** (`MypRefresher`, só no celular, porque a API sem token não atende servidores nem navegador): fila com as cartas nunca buscadas primeiro e depois as de preço mais antigo (a carta aberta na tela passa na frente), uma consulta a cada 6,5 s (no máximo 10 por minuto), renovação semanal, uma busca por nome serve todas as cartas com aquele nome. O preço vai para a carta pela RPC `patch_entry_myp`, que mescla só o preço sobre o que está no banco, aplica a regra do "Meu valor", não mexe no `updatedAt` e ignora um preço mais velho que o gravado. Sem conta, fica só no aparelho.
- **TCGplayer** (`TcgplayerRefresher`, celular e web, só cartas em inglês): acha o produto e a impressão em `tcg_catalog`, o preço em `tcg_prices` e o câmbio em `fx_rates` (`src/lib/tcgplayer.ts`) e grava pela RPC `patch_entry_tcgplayer`, só quando o preço mudou.
- **Valor na tela**: `valuation(entry)` (`src/lib/valuation.ts`) e as somas em `collectionTotals` (`src/lib/quotes.ts`). Os textos vêm de `src/lib/copy.ts`.

### Catálogo

- **`catalog-sync`** (Edge Function em Deno, `supabase/functions/catalog-sync/`): o pg_cron a chama a cada 10 min (`2-59/10 * * * *`) com o cabeçalho `x-sync-key`, conferido pela `check_liga_sync_key` contra a chave `liga_sync_key` do Vault. A cada execução: relê a lista de coleções do TCGCSV só quando ela muda; baixa as coleções alteradas; lê as coleções da TCGdex (`tcgdex_sets`) para ligar as cartas; religa as coleções com regra antiga (`LINK_VERSION`, `relink_catalog`); copia os preços de cada coleção 1×/dia (`upsert_tcg_prices`) e a PTAX (`fx_rates`). A regra de ligação TCGCSV → TCGdex está em `link.ts`.
- **Registro**: cada execução vira uma linha em `catalog_sync_runs` (`ok`, `partial` ou `error`, com o relatório), guardada por 14 dias. `catalog_sync_status()` resume a última execução, as falhas de 24 h e a idade do catálogo, dos preços e do câmbio para a tela "Sobre e fontes".
- **No app**: `tcgdex.ts` junta a TCGdex, o catálogo e o Zukan, com cache na memória e no aparelho (chaves `tcgdex:`, `ptcg:`, `scrydex:`, `zukan:`, com validade; a limpeza diária tira as vencidas). `catalog.ts` lê `tcg_catalog`; a busca usa `name_plain`, calculada no banco por `catalog_plain()`, igual ao `plainName()` do app. `variants.ts` monta as versões da carta; `ptcg.ts` acha a imagem reserva; a Edge Function `stamp-image` acha a foto da versão com selo.

### Histórico e cópia diária

| Cron (horário de Brasília) | O que faz |
|---|---|
| `price-snapshot` (23:50) | `snapshot_prices()` grava em `price_history` uma linha por carta com preço: "Meu valor", MYP, TCGplayer do dia (cartas em inglês, `tcg_prices` × câmbio) e a escolha "Usar na soma". |
| `collection-backup` (00:20) | `backup.snapshot_collection()` copia `entries` e `binder_settings` para `backup.entries_daily` e `backup.binder_settings_daily` e apaga as cópias com mais de 14 dias. |
| `daily-cleanup` (00:40) | Apaga o histórico do pg_cron com mais de 14 dias e os registros de remoção com mais de 180 dias. |
| `catalog-sync` (a cada 10 min) | Chama a Edge Function `catalog-sync`. |

- **Gráfico**: `collectionHistory()` (`src/lib/history.ts`) chama a RPC `collection_history(p_from)`, que soma cada dia no servidor pela mesma regra (`history_value`). Sem a função, o app soma no aparelho. A variação do período (`compareDays`) e o histórico de uma carta (`entryHistory`) comparam só a mesma carta e versão.
- **Restaurar uma cópia**: as cópias ficam fora da API; restaure pelo SQL Editor com `select backup.restore_collection('<id da conta>', '<AAAA-MM-DD>');`. A função recoloca as cartas do dia com data nova dentro de cada uma (para os aparelhos não mandarem de volta a cópia deles), traz de volta os fichários livres apagados e não apaga nada; os aparelhos recebem na próxima sincronização. Não copie as linhas de `backup.entries_daily` direto: com a data antiga, um aparelho com a carta editada depois desfaz a restauração.

### Outras chaves no aparelho

`home:pages` (página de cada fichário), `home:hints` (dica de arrastar), `ui:myvalue-seen` (último aviso de "Meu valor" visto) e o cache do catálogo. Nenhuma vai para a nuvem.

## Onde mora cada regra

| Regra | Onde |
|---|---|
| Valor da carta ("Meu valor" → TCGplayer nas cartas em inglês → MYP; "Usar na soma") | `src/lib/valuation.ts`; nas fotos, `snapshotValue` em `src/lib/history.ts`; no banco, `history_value` e `snapshot_prices`. Os quatro andam juntos. |
| "Meu valor" trocado quando o mercado passa dele | `myValuePatch` (`valuation.ts`) e as RPCs `patch_entry_myp` / `patch_entry_tcgplayer` |
| Nomes e textos do valor | `src/lib/copy.ts` |
| Reais, números e datas (inclusive ler "1.500,00") | `src/lib/format.ts` (`formatBRL`, `parseBRL`…) |
| Somas da coleção e idade dos preços | `src/lib/quotes.ts` |
| Variação do período e histórico de cada carta | `src/lib/history.ts` |
| Qual produto do MYP é a carta | `pickMypProduct` (`src/lib/myp-match.ts`) e `src/lib/myp-api.ts` (`MYP_MATCHER` sobe quando a regra muda e rebusca as cartas) |
| Qual produto e impressão da TCGplayer | `src/lib/tcgplayer.ts` |
| Ligação TCGCSV → TCGdex e selos | `supabase/functions/catalog-sync/link.ts` (`LINK_VERSION` em `index.ts` sobe para religar) |
| Busca sem acento e apóstrofo | `plainName` (`src/lib/catalog.ts`) = `catalog_plain` no banco; espécies em `speciesKey` (`src/data/pokedex.ts`) |
| Páginas, regiões e posição física | `src/lib/binder.ts` |
| "Tenho" por versão | `ownershipOf` (`src/components/owned-badge.tsx`) |
| Sincronização e conflitos | `src/store/collection.tsx` (`mergeEntry`, `mergeSettings`) e, no banco, os gatilhos e `delete_entries` |
| Cores, tipografia, espaços | `src/theme.ts` e [design.md](design.md) |

## Mudar o banco (migração)

1. Crie `supabase/migrations/AAAAMMDD<letra>_<assunto>.sql` (a letra ordena as do mesmo dia). O arquivo precisa poder rodar mais de uma vez: `create or replace`, `if not exists`, `drop policy if exists` antes de `create policy`, `cron.schedule` (que troca o job de mesmo nome). Comentários em português, sem apagar dado do usuário (o que sai vai para o schema `backup`), e `notify pgrst, 'reload schema';` no fim quando a API precisa ver algo novo.
2. Garanta que o app funciona **antes** de a migração ser aplicada (ex.: sem `collection_history`, o gráfico soma no aparelho; sem `entry_tombstones`, a sincronização é sempre completa).
3. Aplique com o Supabase CLI (uma vez: `npx supabase login` e `npx supabase link --project-ref <ref>`):
   ```bash
   npx supabase db query --linked -f supabase/migrations/<arquivo>.sql
   ```
   ou pela ferramenta `execute_sql` do MCP do Supabase. Não use `supabase db push`: os nomes dos arquivos não seguem o padrão dele.
4. Confira: `select pg_get_functiondef('public.<função>'::regproc);`, `select * from pg_policies where schemaname = 'public';`, `select jobname, schedule from cron.job;` e os avisos de segurança do Supabase (Advisors).
5. **Espelhe em `supabase/schema.sql`**, na seção certa. Ele tem que continuar idempotente: rodar o arquivo de novo no banco atual não muda nada.

## Publicar uma Edge Function

```bash
npx supabase functions deploy catalog-sync --no-verify-jwt   # chamada pelo cron, protegida pela chave do Vault
npx supabase functions deploy stamp-image                    # chamada pelo app (com verificação de JWT)
```

- Aplique antes a migração de que a função depende.
- As funções usam só `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, que o Supabase já fornece. Um segredo novo vai com `npx supabase secrets set NOME=valor`, nunca no código.
- Confira depois: `npx supabase functions list` (só `catalog-sync` e `stamp-image`) e, para o catálogo, `select started_at, status, error from public.catalog_sync_runs order by started_at desc limit 5;` ou a tela "Sobre e fontes" do app.

## Testar

```bash
npm test             # Jest (jest-expo): lógica pura
npm run typecheck    # tsc --noEmit
npm run lint         # expo lint (projeto inteiro, inclusive Edge Functions e scripts)
```

- O GitHub Actions (`.github/workflows/ci.yml`) roda tipos, lint e testes a cada envio e varre segredos com o gitleaks.

- Os testes ficam em `tests/` (`*.test.ts`, com dados de exemplo em `tests/fixtures.ts`) e cobrem a lógica sem tela: valor da carta, formatação e `parseBRL`, histórico e variação, reconhecimento de produto do MYP e da TCGplayer, contas do fichário, o "+ Carta", as listas e o "tenho" por versão. `tests/setup.ts` deixa o ambiente sem nuvem (`supabase` nulo) e com o armazenamento do aparelho em memória: nenhum teste acessa a rede.
- Mudou a regra do valor? O mesmo caso tem que dar o mesmo número em `valuation.ts`, `snapshotValue` e `history_value`.
- Telas: `npx expo start` e confira no celular (Expo Go, 375 px) e no navegador (≥ 960 px), inclusive com teclado e leitor de tela.

## Decisões que explicam o resto

- **MYP no aparelho**: sem token, a API do MYP responde 403 a servidores e não tem CORS no navegador. Por isso o celular busca e grava no banco, e a web só lê.
- **TCGCSV só no servidor**: as regras de uso pedem cópia diária e pouca carga; o app lê a cópia.
- **A carta é a posição**: o id é o bolso. Um id por cópia (uuid) resolveria trocas e movimentos de outro jeito, mas para um usuário as remoções registradas no servidor, o "Mover para…" e o "Desfazer" bastam.
- **Dois relógios**: o `updated_at` do servidor guia a busca incremental; o `updatedAt` do aparelho decide conflitos de edição; o `checkedAt` decide os preços.
- **Gravar preço não é editar**: as RPCs de preço não mexem no `updatedAt`, para não passar por cima de edições e remoções ainda não enviadas.
