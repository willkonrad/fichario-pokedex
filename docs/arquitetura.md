# Arquitetura do Fichário Pokédex

Mapa curto para quem chega no projeto (versão 3.0). As regras fixas (o que nunca fazer com as fontes, segredos, valor) estão no [AGENTS.md](../AGENTS.md); o sistema visual, em [DESIGN.md](../DESIGN.md); o que o app faz e a regra do valor, no [README](../README.md).

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
| `src/app/` | Telas (cada arquivo é uma rota): `index` (fichário), `card`, `search` (escolher carta e "+ Carta"), `pokemon/[dex]`, `find`, `lists`, `menu` (Minha coleção), `reports` (Relatórios), `binders`, `binder-edit`, `setup`, `account`, `nova-senha` (aberta pelo link do e-mail de nova senha), `about`. `_layout.tsx` monta o provider da coleção, os buscadores de preço, o toast e as telas de erro. |
| `src/store/` | `collection.tsx`: estado da coleção, armazenamento no aparelho, sincronização e os ganchos de leitura (`useEntries`, `useEntry`, `useSettings`, `useBinders`, `useActiveBinderId`, `useSyncStatus`, `useCollectionActions`…). |
| `src/lib/` | Lógica sem tela: valor (`valuation`, `quotes`, `history`), textos e formatos (`copy`, `format`), preços (`myp-api`, `myp-match`, `myp-queue`, `tcgplayer`), catálogo (`tcgdex`, `catalog`, `variants`, `ptcg`, `stamp-image`), fichário (`binder`, e `binder-drag` para arrastar), adicionar e listas (`add-card`, `lists`), Relatórios (`activity`, `reports`), Consulta (`lookup-*`), câmera (`card-ocr`, `scan-match`, `scan-lot`), cópia (`backup`), Supabase (`supabase`), conta fechada e links dos e-mails do Auth (`auth-links`) e tipos (`types`). |
| `src/components/` | `ui.tsx` (componentes base e reexporta toast, folha de informação, esboços, ícones, layout), partes das telas (`home-*`, `card-*`, `collection-*`, `add-*`, `report-*`), `lookup-*` e `card-scanner` (Consulta e câmera), `binder-slot`, `binder-drag` (arrastar), `foil` (filete das cartas especiais), `digits`, `card-grid`, `card-image`, `price-panel`, `line-chart` e os buscadores `myp-refresher`, `myp-background` e `tcgplayer-refresher`. |
| `modules/card-ocr/` | Módulo nativo do Android que lê o texto da carta no aparelho (ML Kit). |
| `plugins/` | Plugins de configuração do build nativo: `with-async-storage-size.js` põe o limite do armazenamento local do Android (AsyncStorage) em 50 MB (padrão: 6 MB), registrado no `app.json`. |
| `src/theme.ts` | Tokens: cores com significado (`semantic`), tipografia (`type`), espaços, larguras e contraste. |
| `src/data/` | `pokedex.json` (1.025 Pokémon em PT, EN, JP, coreano e chinês) e a busca de espécies (`pokedex.ts`). |
| `supabase/` | `schema.sql` (o banco inteiro), `migrations/` (o que mudou em cada versão) e `functions/` (`catalog-sync`, `stamp-image`). |
| `tests/` | Testes automatizados (Jest com `jest-expo`) da lógica pura; configuração em `jest.config.js`. |
| `scripts/` | `make-icons.js` (ícones, imagem de abertura e os ícones da web instalável em `public/icons/`), `add-species-names.js` e `make-species-sql.js` (nomes das espécies), `lookup-audit.sql` (confere o índice com cartas-testemunha). |
| `public/` | Copiado para a raiz do site no export web: `index.html` (modelo da página), `manifest.json` e `icons/` do app instalável. Não use `public/assets`, que é reservado. |
| `eas.json` | Perfis de build do EAS (`preview` = APK interno, `production`) e o canal de atualização de cada um. Nunca guarda valores de variáveis. |

## Fluxo dos dados

### Coleção: aparelho ↔ Supabase

- **No aparelho** (AsyncStorage): uma chave por carta (`binder:e:<id>`), mais `binder:settings`, `binder:active`, `binder:pending` (alterações que a nuvem ainda não confirmou), `binder:deleted` (remoções ainda não confirmadas) e `binder:sync` (dono, cursor e datas). As gravações são agrupadas (400 ms). Uma chave que não dá para ler bloqueia a gravação dela naquela sessão, e um JSON estragado é copiado para `binder:ilegivel:*`: nada é apagado. A coleção é da última conta que entrou no aparelho (`holder` em `binder:sync`): outra conta que entra não a recebe; ela fica guardada à parte (`binder:conta:<conta>:*`) até a dona entrar de novo, e `binder:troca` marca uma troca em andamento (a abertura seguinte termina uma troca interrompida). Só um aparelho usado sem conta passa a coleção para a conta que entra.
- **Identidade da carta = posição**: `"<dex>-<espaço>"` no Pokédex e `"<fichário>:<bolso>"` nos fichários livres. Mover uma carta é apagar um id e criar outro; por isso as remoções precisam de registro no servidor.
- **Envio**: as alterações vão juntas 300 ms depois da última (upsert em `entries`; `binder_settings` à parte). As remoções vão pela RPC `delete_entries(p)` com a hora de cada remoção; o servidor não apaga uma carta alterada depois disso. O gatilho `entries_tombstone` registra cada carta apagada em `entry_tombstones` (180 dias); recolocar a carta no mesmo bolso apaga o registro.
- **Recebimento** (`runSync`): completo ao entrar no app, pelo menos 1×/dia, num aparelho que nunca sincronizou com a conta ou num banco sem a migração 3.0; nos outros casos, **incremental**: `entries` com `updated_at` depois do cursor (menos 2 min de folga) e `entry_tombstones` com `deleted_at` depois do cursor. O `updated_at` é do relógio do servidor (gatilho `touch_updated_at`); o `updatedAt` dentro de `data` é o da última edição do usuário. Sincroniza também na volta ao app e a cada 15 min.
- **Conflitos** (`mergeEntry`, `mergeSettings`): os campos do usuário seguem o `updatedAt` mais novo; os preços (`mypApi`, `tcgplayer`) seguem o `checkedAt` mais novo e só valem para a mesma carta, versão e idioma. No banco, `entries_keep_newer_prices` impede que um envio com preço mais velho desfaça o mais novo. Uma remoção vinda da nuvem não apaga uma alteração local ainda não enviada feita depois dela (folga de 2 min, `CLOCK_SKEW_MS`). Num aparelho que nunca sincronizou com a conta, vale a configuração da nuvem e os fichários livres são juntados por id.
- **Estado** (`syncStatus`): `local`, `syncing`, `ok`, `offline` ou `error`, com o número de pendências e a mensagem em português. Falha: nova tentativa em 30 s, 2 min e depois a cada 10 min.
- **Cópia pelo usuário**: `src/lib/backup.ts` (JSON e CSV, sem preços por padrão), usada por `exportCollection`/`importCollection`. No Android, o arquivo é gravado numa pasta escolhida pelo usuário (`Directory.pickDirectoryAsync`, sem passar pelo compartilhamento, que tem limite de tamanho) e lido de volta por `File.pickFileAsync` ("Importar cópia"); na web, download e escolha de arquivo do navegador.

### Preços

- **MYP Cards** (só no celular, porque a API sem token não atende servidores nem navegador): fila em `src/lib/myp-queue.ts` com as cartas nunca buscadas primeiro e depois as de preço mais antigo (a carta aberta na tela passa na frente), uma consulta a cada 6,5 s (no máximo 10 por minuto), renovação semanal, uma busca por nome serve todas as cartas com aquele nome. Com o app aberto, quem segue a fila é o `MypRefresher`, e a tela não apaga sozinha enquanto há fila (expo-keep-awake). Com o app em segundo plano, segue a tarefa de `myp-background` (expo-background-task: o Android a roda a cada 15 min ou mais, quando decide, por até 3 min). A tarefa só existe no APK: o Expo Go não roda tarefas em segundo plano no Android. As duas buscas dividem o ritmo, a pausa depois de um 429, as falhas e as buscas guardadas. O preço vai para a carta pela RPC `patch_entry_myp`, que mescla só o preço sobre o que está no banco, aplica a regra do "Meu valor", não mexe no `updatedAt` e ignora um preço mais velho que o gravado. Sem conta, fica só no aparelho.
- **TCGplayer** (`TcgplayerRefresher`, celular e web, cartas em inglês e japonês; a japonesa só com produto da categoria 85, ligada pela sigla da coleção e o número quando vem da TCGdex japonesa, em `src/lib/ja-catalog.ts`): acha o produto e a impressão em `tcg_catalog`, o preço em `tcg_prices` e o câmbio em `fx_rates` (`src/lib/tcgplayer.ts`) e grava pela RPC `patch_entry_tcgplayer`, só quando o preço mudou.
- **Valor na tela**: `valuation(entry)` (`src/lib/valuation.ts`) e as somas em `collectionTotals` (`src/lib/quotes.ts`). Os textos vêm de `src/lib/copy.ts`.

### Catálogo

- **`catalog-sync`** (Edge Function em Deno, `supabase/functions/catalog-sync/`): o pg_cron a chama a cada 10 min (`2-59/10 * * * *`) com o cabeçalho `x-sync-key`, conferido pela `check_liga_sync_key` contra a chave `liga_sync_key` do Vault. A cada execução: relê a lista de coleções do TCGCSV só quando ela muda; baixa as coleções alteradas (a fila vem pronta do banco, `catalog_due_groups`); lê as cartas da TCGdex guardadas (`tcgdex_sets`, ~1,4 MB) para ligar as cartas, só quando há coleção em inglês para copiar ou religar (a execução sem nada para fazer lê poucos KB do banco, por causa da cota de egress do plano Free); religa as coleções com regra antiga (`LINK_VERSION`, `relink_catalog`); copia os preços de cada coleção 1×/dia (`upsert_tcg_prices`) e a PTAX (`fx_rates`). A regra de ligação TCGCSV → TCGdex está em `link.ts`; as regras puras da cópia (o que é carta, a data de lançamento, a URL dos preços e a versão da cópia) em `products.ts`.
- **Japonês (categoria 85 do TCGCSV)**: a função copia também a seção japonesa da TCGplayer (catálogo e preços, 1×/dia). Na 85, carta sem número impresso (as antigas "Pocket Monsters", 1996–2003) entra quando o produto tem campo de carta (raridade, tipo, HP, ataque…), o que separa carta de produto lacrado; o relatório da execução (`report.unnumbered`) lista por coleção o que entrou e o que ficou de fora. A 85 não é ligada à TCGdex: em `link_version` ela guarda a versão da cópia (`JA_COPY_VERSION`), e subir esse número faz a 85 ser copiada de novo uma vez.
- **Registro**: cada execução vira uma linha em `catalog_sync_runs` (`ok`, `partial` ou `error`, com o relatório), guardada por 14 dias. `catalog_sync_status()` resume a última execução, as falhas de 24 h e a idade do catálogo, dos preços e do câmbio para a tela "Sobre e fontes".
- **No app**: `tcgdex.ts` junta a TCGdex, o catálogo e o Zukan, com cache na memória e no aparelho (chaves `tcgdex:`, `ptcg:`, `scrydex:`, `zukan:`, com validade; a limpeza diária tira as vencidas). `catalog.ts` lê `tcg_catalog` (`ENGLISH` = 3, `JAPANESE` = 85; `categoryOf(lang)`; `entryImageUrl` dá a foto da carta salva, inclusive a da japonesa pelo produto do preço); a busca usa `name_plain`, calculada no banco por `catalog_plain()`, igual ao `plainName()` do app. `variants.ts` monta as versões da carta; `ptcg.ts` acha a imagem reserva; a Edge Function `stamp-image` acha a foto da versão com selo.

### Histórico e cópia diária

| Cron (horário de Brasília) | O que faz |
|---|---|
| `price-snapshot` (23:50) | `snapshot_prices()` grava em `price_history` uma linha por carta com preço: "Meu valor", MYP, TCGplayer do dia (cartas em inglês e japonês, `tcg_prices` × câmbio) e a escolha "Usar na soma". |
| `collection-backup` (00:20) | `backup.snapshot_collection()` copia `entries` e `binder_settings` para `backup.entries_daily` e `backup.binder_settings_daily` e apaga as cópias com mais de 14 dias. |
| `daily-cleanup` (00:40) | Apaga o histórico do pg_cron com mais de 14 dias e os registros de remoção com mais de 180 dias. |
| `catalog-sync` (a cada 10 min) | Chama a Edge Function `catalog-sync`. |

- **Gráfico**: `collectionHistory()` (`src/lib/history.ts`) chama a RPC `collection_history(p_from)`, que soma cada dia no servidor pela mesma regra, escrita na própria consulta (uma função auxiliar com `set search_path` rodaria uma vez por foto e estouraria o limite de 8 s da API). Sem a função, o app soma no aparelho. A variação do período (`compareDays`) e o histórico de uma carta (`entryHistory`) comparam só a mesma carta e versão.
- **Restaurar uma cópia**: as cópias ficam fora da API; restaure pelo SQL Editor com `select backup.restore_collection('<id da conta>', '<AAAA-MM-DD>');`. A função recoloca as cartas do dia com data nova dentro de cada uma (para os aparelhos não mandarem de volta a cópia deles), traz de volta os fichários livres apagados e não apaga nada (no registro de mudanças, aparece com a origem `restore`); os aparelhos recebem na próxima sincronização. Não copie as linhas de `backup.entries_daily` direto: com a data antiga, um aparelho com a carta editada depois desfaz a restauração.

### Registro de mudanças (Relatórios)

- **No banco**: os gatilhos `entries_log_insert` e `entries_log_update` (função `entries_log_event`, por linha) e `entries_log_delete` (função `entries_log_removed`, um por comando, que lê o mapa de horas da `delete_entries` uma vez só: apagar milhares de cartas de uma vez continua rápido) gravam em `entry_events` um fato cru por bolso: carta que entrou (`added`), saiu (`removed`) ou mudou de chave (`replaced`), com o resumo da carta antes e depois (`entry_summary`). A chave é `cardId|idioma|versão|selo` (`entry_key`): um envio que só muda preço, texto ou estado não vira evento. A hora da pessoa (`happened_at`) vem do `updatedAt` da carta ou, na remoção, da hora que o aparelho mandou para a `delete_entries` (`app.removed_at`); a do servidor fica em `at`. A origem é `app`, `restore` (`backup.restore_collection` marca) ou `backfill` (montado na migração a partir das cópias diárias desde 24/10/2026). O RLS só deixa o dono ler; ninguém grava pela API. Os eventos ficam para sempre (~1 KB cada).
- **No app**: `loadActivity` (`src/lib/activity.ts`) lê o período e `classifyEntryEvents` transforma os fatos no que a pessoa fez: adicionou, trocou, moveu, removeu ou importou de uma vez (mais de 20 no mesmo envio). O "Desfazer" se anula, o mover (remoção + entrada da mesma carta, ou duas trocas cruzadas) vira uma movida, e mudanças seguidas no mesmo bolso em até 10 min viram uma só. Sem a tabela, a tela diz que o servidor ainda não tem o registro.
- **Tela** (`src/app/reports.tsx`, partes em `report-activity` e `report-highlights`): resumo do período (7, 30 ou 90 dias, no parâmetro `periodo`), últimas adicionadas, trocas no fichário Pokédex, movidas e removidas, maiores altas e quedas, mais valiosas, por coleção, compras e cartas sem preço. O valor vem só de `valuation` e `collectionTotals` (`src/lib/reports.ts`).

### Outras chaves no aparelho

`home:pages` (página de cada fichário), `home:hints` (dica de arrastar), `ui:myvalue-seen` (último aviso de "Meu valor" visto) e o cache do catálogo. Nenhuma vai para a nuvem.

## Onde mora cada regra

| Regra | Onde |
|---|---|
| Valor da carta ("Meu valor" → TCGplayer nas cartas em inglês e japonês → MYP; "Usar na soma") | `src/lib/valuation.ts`; nas fotos, `snapshotValue` em `src/lib/history.ts`; no banco, `collection_history` e `snapshot_prices`. Os quatro andam juntos. |
| "≈ Aproximado" (carta base de versão que a fonte não vende à parte, Reverse Foil em português pelo produto da carta no MYP, inglesa sem TCGplayer pelo MYP) | `approx` em `valuation()` e `mypApiFitsVariant` (`src/lib/valuation.ts`); os textos em `APPROX_REASON` e `HOW_WE_CALCULATE` (`copy.ts`). Só a marca: o número é o mesmo, e as fotos e o banco não guardam a marca. |
| "Meu valor" trocado quando o mercado passa dele | `myValuePatch` (`valuation.ts`) e as RPCs `patch_entry_myp` / `patch_entry_tcgplayer` |
| Nomes e textos do valor | `src/lib/copy.ts` |
| Reais, números e datas (inclusive ler "1.500,00") | `src/lib/format.ts` (`formatBRL`, `parseBRL`…) |
| Somas da coleção e idade dos preços | `src/lib/quotes.ts` |
| Variação do período e histórico de cada carta | `src/lib/history.ts` |
| O que a pessoa fez na coleção (adicionou, trocou, moveu…) | `classifyEntryEvents` (`src/lib/activity.ts`); no banco, `entry_key`/`entry_summary` e os gatilhos `entries_log_event` e `entries_log_removed` |
| Qual produto do MYP é a carta | `pickMypProduct` (`src/lib/myp-match.ts`) e `src/lib/myp-api.ts` (`MYP_MATCHER` sobe quando a regra muda e rebusca as cartas) |
| Qual produto e impressão da TCGplayer | `src/lib/tcgplayer.ts`; carta japonesa da TCGdex → produto da 85 pela sigla e o número em `src/lib/ja-catalog.ts` |
| Lista e busca de cartas japonesas (catálogo da 85 com foto, a TCGdex japonesa como reserva) | `src/lib/tcgdex.ts` (`withJapanese`, `loadJaSearch`) e `src/lib/add-card.ts` (código, `pickParams`) |
| Ligação TCGCSV → TCGdex e selos | `supabase/functions/catalog-sync/link.ts` (`LINK_VERSION` em `index.ts` sobe para religar) |
| Busca sem acento e apóstrofo | `plainName` (`src/lib/catalog.ts`) = `catalog_plain` no banco; espécies em `speciesKey` (`src/data/pokedex.ts`) |
| Páginas, regiões e posição física; folha cabendo na janela (`fitPocket`), lado dos furos (`spineSide`) e páginas abertas (`spreadOf`) | `src/lib/binder.ts` |
| Qual carta a câmera leu e o lote | `src/lib/card-ocr.ts`, `scan-match.ts` e `scan-lot.ts` |
| Preço, referência e links na Consulta | `src/lib/lookup-price.ts` e `lookup-links.ts`; o índice em `lookup_build()` |
| Arrastar cartas nos fichários livres | Regras em `src/lib/binder-drag.ts`; toque e carta flutuante em `src/components/binder-drag.tsx`; gravação e Desfazer em `moveCard` (`src/app/index.tsx`) |
| "Tenho" por versão | `ownershipOf` (`src/components/owned-badge.tsx`); o mesmo selo com o nome que versões anteriores do app davam ("Pre Release", "Logo da coleção (Booster Box)") em `stampKey`/`sameVersion` (`src/lib/variants.ts`), usados também pela tela da carta e pelo "Adicionar" |
| Carta salva por uma versão anterior do app que hoje é outra versão do catálogo (ex.: o Mirror japonês salvo sem selo) | `upgradeEntry` (`src/lib/entry-upgrade.ts`), ao ler do aparelho, da nuvem e de uma cópia; na nuvem, a migração que mudou o catálogo |
| Sincronização e conflitos | `src/store/collection.tsx` (`mergeEntry`, `mergeSettings`) e, no banco, os gatilhos e `delete_entries` |
| Cadastro fechado, nova senha e links dos e-mails do Auth | `src/lib/auth-links.ts` (leitura do link e textos), `src/app/account.tsx` e `src/app/nova-senha.tsx`; no painel do Supabase, as Redirect URLs ([Auth do Supabase](#auth-do-supabase-com-o-endereço-no-ar)) |
| Cores, tipografia, espaços | `src/theme.ts` e [DESIGN.md](../DESIGN.md) |

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

## Consulta de cartas (índice)

A Consulta não pergunta nada ao servidor a cada tecla: o app baixa um arquivo com todas as cartas e preços e consulta no aparelho.

- **Geração**: `public.lookup_build()` monta o arquivo dentro do Postgres e grava em `lookup_index` (uma linha, a única tabela nova que o app lê). Só grava se o md5 mudar e recusa um arquivo ruim. Cron `lookup-build` às 00:10 e 06:10 UTC.
- **Tabelas de apoio** (fechadas para o app): `catalog_species` (nomes das espécies; `kind` en, zh ou ja), `tcgdex_lang` (TCGdex por idioma) e `lookup_overrides` (correções manuais, sempre com o motivo). `tcg_catalog` ganhou `hp`, `card_type`, `stage` e `released_on`; `tcgdex_sets`, `release_date`.
- **`catalog-sync`, etapa 7** (`languages.ts`): lê um idioma da TCGdex por execução, quando o guardado tem mais de 7 dias, e só grava com o idioma inteiro lido. Um idioma que falha espera 6 h, para não travar os outros (marcador em `qvmc_cache`, chave `tcgdex-lang:falhas`).
- **App**: `lookup-store` (arquivo; na web, IndexedDB, conferido pelo md5 do manifesto a cada abertura), `lookup-format` e `lookup-index` (leitura), `lookup-query` (gramática do campo), `lookup-view` (filtros e grupos), `lookup-price`, `lookup-links`, `lookup-myp`. Tela em `src/app/consulta.tsx`.
- **O preço de referência de outro idioma é só da tela**: nada de `lookup-price` chega a `valuation` ou `snapshotValue`, e o teste `lookup-value-regression` garante isso.
- **Câmera**: `modules/card-ocr` (ML Kit no aparelho, só Android, `arm64-v8a`), `src/lib/card-ocr.ts` (leitura do texto), `scan-match.ts` (qual carta é), `scan-lot.ts` (lote) e as telas `scan` e `scan-review`. Sem o módulo (Expo Go, web, APK antigo), `isOcrAvailable` é falso. `ocr-probe` é a tela de medida para o primeiro APK, e sai depois dele.

**Consertar uma carta que saiu errada**: inclua a correção em `lookup_overrides` (`kind`, `key`, `value` e o motivo em `note`) e rode `select public.lookup_build();`. O app pega o arquivo novo ao abrir.

**Recopiar o catálogo** (só quando um campo novo do TCGCSV precisa entrar em tudo):
1. Publique o `catalog-sync` novo depois da migração.
2. Canário: `update public.tcg_groups set synced_at = '2000-01-01' where name in ('Base Set', 'SV03: Obsidian Flames', 'SV2a: Pokemon Card 151', 'SV5K: Wild Force', 'Expansion Pack');`
3. Depois da próxima execução, confira `report->'fields'` em `catalog_sync_runs` e a cobertura do campo nessas 5 coleções.
4. Recópia: o mesmo `update` em todas com `synced_at is not null`, menos as 5 do canário. São cerca de 682 requisições em 34 execuções, umas 5 h 40.
5. Rode `scripts/lookup-audit.sql` no fim. Tudo certo = nenhuma linha com `ok = false`.

A seção "Coleções sem lista de cartas" tem 87 coleções: as coreanas cujas cartas já aparecem no índice ficam de fora.

## Publicar uma Edge Function

```bash
npx supabase functions deploy catalog-sync --no-verify-jwt   # chamada pelo cron, protegida pela chave do Vault
npx supabase functions deploy stamp-image                    # chamada pelo app (com verificação de JWT)
```

- Aplique antes a migração de que a função depende.
- As funções usam só o que o Supabase já fornece: `SUPABASE_URL` e a chave secreta nova (a `default` de `SUPABASE_SECRET_KEYS`), com a legada `SUPABASE_SERVICE_ROLE_KEY` de reserva enquanto ela existir (a Supabase a aposenta até o fim de 2026). A `catalog-sync` anota no relatório de cada execução qual das duas usou (`report->>'apiKey'` em `catalog_sync_runs`); desative as chaves legadas só depois de ver `secret` ali. Um segredo novo vai com `npx supabase secrets set NOME=valor`, nunca no código.
- Confira depois: `npx supabase functions list` (só `catalog-sync` e `stamp-image`) e, para o catálogo, `select started_at, status, error from public.catalog_sync_runs order by started_at desc limit 5;` ou a tela "Sobre e fontes" do app.

## Publicar (web e APK Android)

Tudo no plano grátis da Expo (EAS): a web no EAS Hosting (`https://<nome>.expo.app`) e o app Android como APK de distribuição interna, atualizado pelo EAS Update. Já está no repositório:

- `public/index.html`, o modelo da página no `web.output: "single"` (criado com `npx expo customize public/index.html`; mantenha `%LANG_ISO_CODE%`, `%WEB_TITLE%` e o `<style id="expo-reset">`), com o link do manifesto e o `apple-touch-icon`. A cor do tema, a descrição e o favicon entram no export vindos de `web.*` do `app.json`. O `+html.tsx` só vale para `static`/`server` e não serve aqui.
- `public/manifest.json` e `public/icons/` (192, 512, 512 "maskable" e 180 do iPhone), gerados por `node scripts/make-icons.js`. Sem service worker, de propósito: o cache dele impediria a versão nova de chegar.
- `expo-updates` instalado (precisa estar no primeiro APK), `runtimeVersion: { "policy": "fingerprint" }` e `android.package` / `ios.bundleIdentifier` = `com.willkonrad.fichariopokedex`. O package é **permanente**: trocar cria outro app.
- `eas.json`: `preview` (APK interno, ambiente e canal `preview`) e `production` (ambiente e canal `production`, número do build sobe sozinho), com `cli.appVersionSource: "remote"` (o EAS guarda o número do build).

### Uma vez só

Faça tudo isto **antes do primeiro APK**: `owner`, `projectId` e `updates.url` entram no fingerprint, e um APK feito antes deles não recebe os updates de depois. Aplique também as migrações da versão no banco (seção "Mudar o banco") antes do primeiro APK ou deploy; sem elas o app novo mostra "O banco da nuvem ainda não tem a atualização desta versão do app."

1. **Dono**: conta grátis em expo.dev e, no terminal do projeto, `npx eas-cli@latest login` (a senha é digitada por ele) e `npx eas-cli@latest whoami`.
2. `npx eas-cli@latest init`: cria o projeto e grava `owner` e `extra.eas.projectId` no `app.json` (vão para o repositório; não são segredo).
3. `npx eas-cli@latest update:configure`: grava `updates.url` (`https://u.expo.dev/<projectId>`) e mantém o `runtimeVersion` e os canais do `eas.json`.
4. `npx eas-cli@latest env:push --environment preview --environment production --path .env`: leva as duas `EXPO_PUBLIC_*` do `.env` para o EAS (como *plaintext*). O `.env` fica fora do git, então não chega ao servidor de build, e o `eas update` só usa as variáveis do EAS. Sem elas o app abre em "só local", sem erro: confira com `npx eas-cli@latest env:list --environment preview` antes de cada build. Visibilidade *plaintext* ou *sensitive*, nunca *secret*, e nunca valores no `eas.json`. O `env:push` leva **todas** as variáveis do arquivo (as que não são `EXPO_PUBLIC_*` vão como *sensitive*): o `.env` só pode ter as duas `EXPO_PUBLIC_*`. Senão, cadastre uma a uma com `npx eas-cli@latest env:create`.

### APK Android

```bash
npx eas-cli@latest build -p android --profile preview
npx eas-cli@latest update --channel preview --environment preview -p android --message "3.0.1: ..."
```

- No primeiro build, responda **Y** para o EAS gerar o keystore. Instale pelo link ou QR da página do build (permitindo "instalar apps desconhecidos"; se o Android barrar, `adb install <arquivo>.apk` pelo PC).
- **Guarde o keystore**: `npx eas-cli@latest credentials -p android` → perfil `preview` → "Keystore: Manage everything needed to build your project" → "Download existing keystore", respondendo **sim** para mostrar as informações sensíveis. O arquivo `@<conta>__pokedex-binder.jks` cai na pasta do projeto (o `.gitignore` ignora `*.jks`): mova-o para fora e guarde junto as três informações que aparecem (*Keystore password*, *Key alias*, *Key password*), porque o arquivo sem elas não serve. Não use a opção "credentials.json", que grava as senhas em texto num arquivo da raiz do projeto. Sem o keystore, uma versão nova não instala por cima: seria preciso desinstalar, o que apaga os dados do aparelho.
- O app procura a atualização ao abrir (`checkAutomatically: ON_LOAD`, o padrão) e a aplica na abertura seguinte. Para voltar atrás: `npx eas-cli@latest update:rollback`.
- **Build novo** quando o fingerprint muda: biblioteca com código nativo (inclusive subir a versão de uma, como faz o `npx expo install --fix`), plugin, ícone, abertura, qualquer campo do `app.json` menos `version` (inclusive `web.*`), os `scripts` do `package.json`, o `.gitignore` ou o SDK. Confira antes com `npx expo-updates runtimeversion:resolve --platform android` e compare com o runtime do build no expo.dev; um update de outro runtime não chega ao build antigo.
- Rode o `build` e o `update` no mesmo PC (o Windows do dono): o fingerprint lê o `.gitignore` byte a byte, e o git do Windows o grava com fim de linha CRLF. Um `eas update` feito num Linux (por exemplo no GitHub Actions) sai com outro runtime e não chega ao APK.

### Web

```bash
npx expo export --platform web --clear
npx eas-cli@latest deploy --dev-domain <nome>    # só na 1ª vez; depois, npx eas-cli@latest deploy
npx eas-cli@latest deploy --prod
```

- O export lê o `.env` e embute as `EXPO_PUBLIC_*` no JS; refaça antes de cada deploy (os deploys são imutáveis). Confira em `dist/` o `index.html` com o link do manifesto, o `manifest.json` e `icons/`.
- O `--dev-domain` escolhe o subdomínio `<nome>.expo.app`, reservado para sempre. Trocar de endereço depois perde o login e os dados guardados no navegador.
- O deploy sem `--prod` é uma prévia (`https://<nome>--<id>.expo.app`): abra uma rota funda direto (`/card?dex=6&slot=0`) e recarregue; o EAS Hosting devolve o `index.html` em qualquer rota. Para promover a prévia testada, `npx eas-cli@latest deploy:alias --prod --id=<id>` (com um id antigo, volta atrás).
- Os arquivos ficam até 1 h no cache do navegador depois de um deploy. Na web, os preços do MYP Cards não atualizam (CORS): a web lê o que o celular grava.

### Auth do Supabase (com o endereço no ar)

No painel do Supabase, feito pelo dono:

- **Authentication → URL Configuration**: *Site URL* = `https://<nome>.expo.app` (nunca o `localhost:3000` padrão). *Redirect URLs*: `https://<nome>.expo.app/**` (web), `pokedexbinder://**` (APK) e `http://localhost:8081/**` (desenvolvimento); para testar a nova senha numa prévia, `https://<nome>--*.expo.app/**`; no Expo Go, só os endereços exatos do PC que roda o Expo, `exp://<IP do PC>:8081/--/nova-senha` e `exp://<IP do PC>:8081/--/account`, e nunca `exp://**`: com ele, quem souber o e-mail pede uma nova senha com a volta para um projeto Expo dele, e um toque no e-mail verdadeiro, num celular com o Expo Go, entrega o login a esse projeto. O app pede a volta em `nova-senha` (e `account` para a confirmação de cadastro) com `Linking.createURL`; um endereço fora da lista não é aceito, e o link do e-mail cai na *Site URL*.
- **Authentication → Sign In / Providers**: desligue "Allow new users to sign up" (só as contas que já existem entram; conta nova, pelo painel em *Add user*) e, no provedor Email, senha mínima de 8 caracteres (o `MIN_PASSWORD` de `src/lib/auth-links.ts`).
- O envio de e-mail padrão do Supabase só entrega para membros da organização no Supabase, no máximo 2 e-mails por hora: teste a nova senha sem pedir vários links seguidos.

## Testar

```bash
npm test             # Jest (jest-expo): lógica pura
npm run typecheck    # tsc --noEmit
npm run lint         # expo lint (projeto inteiro, inclusive Edge Functions e scripts)
```

- O GitHub Actions (`.github/workflows/ci.yml`) roda tipos, lint e testes a cada envio e varre segredos com o gitleaks.

- Os testes ficam em `tests/` (`*.test.ts`, com dados de exemplo em `tests/fixtures.ts`) e cobrem a lógica sem tela: valor da carta, formatação e `parseBRL`, histórico e variação, reconhecimento de produto do MYP e da TCGplayer, contas do fichário, o "+ Carta", as listas e o "tenho" por versão. `tests/setup.ts` deixa o ambiente sem nuvem (`supabase` nulo) e com o armazenamento do aparelho em memória: nenhum teste acessa a rede.
- Mudou a regra do valor? O mesmo caso tem que dar o mesmo número em `valuation.ts`, `snapshotValue` e `collection_history`.
- Telas: `npx expo start` e confira no celular (Expo Go, 375 px) e no navegador (≥ 960 px), inclusive com teclado e leitor de tela.

## Decisões que explicam o resto

- **MYP no aparelho**: sem token, a API do MYP responde 403 a servidores e não tem CORS no navegador. Por isso o celular busca e grava no banco, e a web só lê.
- **TCGCSV só no servidor**: as regras de uso pedem cópia diária e pouca carga; o app lê a cópia.
- **A carta é a posição**: o id é o bolso. Um id por cópia (uuid) resolveria trocas e movimentos de outro jeito, mas para um usuário as remoções registradas no servidor, o "Mover para…" e o "Desfazer" bastam.
- **Dois relógios**: o `updated_at` do servidor guia a busca incremental; o `updatedAt` do aparelho decide conflitos de edição; o `checkedAt` decide os preços.
- **Gravar preço não é editar**: as RPCs de preço não mexem no `updatedAt`, para não passar por cima de edições e remoções ainda não enviadas.
