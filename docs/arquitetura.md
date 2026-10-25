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
| `src/app/` | Telas (cada arquivo é uma rota): `index` (fichário), `card`, `search` (escolher carta e "+ Carta"), `pokemon/[dex]`, `find`, `lists`, `menu` (Minha coleção), `binders`, `binder-edit`, `setup`, `account`, `nova-senha` (aberta pelo link do e-mail de nova senha), `about`. `_layout.tsx` monta o provider da coleção, os buscadores de preço, o toast e as telas de erro. |
| `src/store/` | `collection.tsx`: estado da coleção, armazenamento no aparelho, sincronização e os ganchos de leitura (`useEntries`, `useEntry`, `useSettings`, `useBinders`, `useActiveBinderId`, `useSyncStatus`, `useCollectionActions`…). |
| `src/lib/` | Lógica sem tela: valor (`valuation`, `quotes`, `history`), textos e formatos (`copy`, `format`), preços (`myp-api`, `myp-match`, `tcgplayer`), catálogo (`tcgdex`, `catalog`, `variants`, `ptcg`, `stamp-image`), fichário (`binder`), adicionar e listas (`add-card`, `lists`), cópia (`backup`), Supabase (`supabase`), conta fechada e links dos e-mails do Auth (`auth-links`) e tipos (`types`). |
| `src/components/` | `ui.tsx` (componentes base e reexporta toast, folha de informação, esboços, ícones, layout), partes das telas (`home-*`, `card-*`, `collection-*`, `add-*`), `binder-slot`, `card-grid`, `card-image`, `price-panel`, `line-chart` e os buscadores `myp-refresher` e `tcgplayer-refresher`. |
| `src/theme.ts` | Tokens: cores com significado (`semantic`), tipografia (`type`), espaços, larguras e contraste. |
| `src/data/` | `pokedex.json` (1.025 Pokémon em PT, EN e JP) e a busca de espécies (`pokedex.ts`). |
| `supabase/` | `schema.sql` (o banco inteiro), `migrations/` (o que mudou em cada versão) e `functions/` (`catalog-sync`, `stamp-image`). |
| `tests/` | Testes automatizados (Jest com `jest-expo`) da lógica pura; configuração em `jest.config.js`. |
| `scripts/` | `make-icons.js` (ícones, imagem de abertura e os ícones da web instalável em `public/icons/`). |
| `public/` | Copiado para a raiz do site no export web: `index.html` (modelo da página), `manifest.json` e `icons/` do app instalável. Não use `public/assets`, que é reservado. |
| `eas.json` | Perfis de build do EAS (`preview` = APK interno, `production`) e o canal de atualização de cada um. Nunca guarda valores de variáveis. |

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

- **`catalog-sync`** (Edge Function em Deno, `supabase/functions/catalog-sync/`): o pg_cron a chama a cada 10 min (`2-59/10 * * * *`) com o cabeçalho `x-sync-key`, conferido pela `check_liga_sync_key` contra a chave `liga_sync_key` do Vault. A cada execução: relê a lista de coleções do TCGCSV só quando ela muda; baixa as coleções alteradas; lê as cartas da TCGdex guardadas (`tcgdex_sets`, ~1,4 MB) para ligar as cartas, só quando há coleção em inglês para copiar ou religar (a execução sem nada para fazer lê poucos KB do banco, por causa da cota de egress do plano Free); religa as coleções com regra antiga (`LINK_VERSION`, `relink_catalog`); copia os preços de cada coleção 1×/dia (`upsert_tcg_prices`) e a PTAX (`fx_rates`). A regra de ligação TCGCSV → TCGdex está em `link.ts`.
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
| Cadastro fechado, nova senha e links dos e-mails do Auth | `src/lib/auth-links.ts` (leitura do link e textos), `src/app/account.tsx` e `src/app/nova-senha.tsx`; no painel do Supabase, as Redirect URLs ([Auth do Supabase](#auth-do-supabase-com-o-endereço-no-ar)) |
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

- **Authentication → URL Configuration**: *Site URL* = `https://<nome>.expo.app` (nunca o `localhost:3000` padrão). *Redirect URLs*: `https://<nome>.expo.app/**` (web), `pokedexbinder://**` (APK) e `http://localhost:8081/**` (desenvolvimento); para testar a nova senha numa prévia, `https://<nome>--*.expo.app/**`; no Expo Go, `exp://**`. O app pede a volta em `nova-senha` (e `account` para a confirmação de cadastro) com `Linking.createURL`; um endereço fora da lista não é aceito, e o link do e-mail cai na *Site URL*.
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
- Mudou a regra do valor? O mesmo caso tem que dar o mesmo número em `valuation.ts`, `snapshotValue` e `history_value`.
- Telas: `npx expo start` e confira no celular (Expo Go, 375 px) e no navegador (≥ 960 px), inclusive com teclado e leitor de tela.

## Decisões que explicam o resto

- **MYP no aparelho**: sem token, a API do MYP responde 403 a servidores e não tem CORS no navegador. Por isso o celular busca e grava no banco, e a web só lê.
- **TCGCSV só no servidor**: as regras de uso pedem cópia diária e pouca carga; o app lê a cópia.
- **A carta é a posição**: o id é o bolso. Um id por cópia (uuid) resolveria trocas e movimentos de outro jeito, mas para um usuário as remoções registradas no servidor, o "Mover para…" e o "Desfazer" bastam.
- **Dois relógios**: o `updated_at` do servidor guia a busca incremental; o `updatedAt` do aparelho decide conflitos de edição; o `checkedAt` decide os preços.
- **Gravar preço não é editar**: as RPCs de preço não mexem no `updatedAt`, para não passar por cima de edições e remoções ainda não enviadas.
