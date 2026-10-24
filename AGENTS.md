This is an Expo/React Native mobile application (Fichário Pokédex: Pokémon TCG binders with card values in reais). Prioritize mobile-first patterns, performance, and cross-platform compatibility. The app also runs on the web.

Leia antes de mexer:

- [docs/arquitetura.md](docs/arquitetura.md) — mapa do projeto: pastas, fluxo dos dados (aparelho ↔ Supabase, preços, catálogo, histórico, cópia diária), onde mora cada regra, como aplicar uma migração, publicar uma função e testar.
- [docs/design.md](docs/design.md) — sistema visual: cores com significado, tipografia, espaços, componentes, acessibilidade e web.
- [README.md](README.md) — o que o app faz, fontes de dados e a regra do valor; [CHANGELOG.md](CHANGELOG.md) — o que mudou em cada versão.

## Regras do projeto (fixas)

Valem para qualquer mudança, feita por pessoa ou por agente. Na dúvida, pare e pergunte ao dono do projeto.

### Fontes de dados

- **Nada de raspar páginas.** Não ler HTML de mypcards.com, Liga Pokémon, Cartinha, Deck Certo, PokeBook nem de outro site de preço. O MYP Cards só pela API pública dele.
- **Não contornar bloqueios.** Nada de burlar a Cloudflare ou outro bloqueio (trocar user-agent, proxy, navegador automatizado, cookies copiados…). Uma API que responde 403 ou 429 é um "não": pare e avise.
- **Sem Apify** (nem outro serviço de raspagem).
- **O app nunca chama o TCGCSV.** Só a Edge Function `catalog-sync` fala com o TCGCSV, seguindo as [regras de uso](https://tcgcsv.com/docs#usage-guidelines) (User-Agent próprio, cada coleção só quando muda, pausa entre requisições). O app lê a cópia no Supabase (`tcg_catalog`, `tcg_prices`, `fx_rates`).
- **Atribuição ao MYP Cards com link** em toda tela que mostra preço do MYP: "MYP Cards" com `ExternalLink` para `MYP_URL` (`src/lib/copy.ts`). Não tire o crédito ao enxugar uma tela.

### Valor das cartas

- **O app nunca estima preço**: nada de desconto pelo estado da carta, média inventada ou preço de outra carta. O que existe é preço real marcado "≈ Aproximado": o da carta base quando a versão (selo, Poké Ball…) não é vendida à parte, e o do MYP Cards numa carta em inglês sem preço na TCGplayer. Sem fonte, a carta fica sem valor até o usuário preencher "Meu valor".
- **Ordem da regra**: "Meu valor" → TCGplayer (EUA, só cartas em inglês, em reais pela PTAX) → MYP Cards. Em cada carta o usuário escolhe mínimo, média ou máximo ("Usar na soma", campo `valueBasis`; a média por padrão). "Meu valor" vale até a média da fonte passar dele.
- A regra existe em quatro lugares que andam juntos: `src/lib/valuation.ts` (valor atual), `src/lib/history.ts` (`snapshotValue`), e as funções SQL `history_value` e `snapshot_prices` (`supabase/schema.sql`). Mudou um, mude os outros e os testes.
- Nomes e textos do valor só em `src/lib/copy.ts` ("Valor da carta", "Valor deste fichário", "Valor da coleção", rótulos de cada fonte); dinheiro, números e datas só por `src/lib/format.ts`.

### Segredos e repositório

- **Segredos só nos Secrets do Supabase** (Edge Functions), no Vault (chave do cron) ou no `.env` local, que fica fora do git. Nunca no código, em commit, em log, em captura de tela nem na documentação. O `.env.example` só tem os nomes das variáveis.
- **O repositório é público.** Antes de cada push, procure segredos no que vai subir: uma varredura (ex.: `gitleaks git`) ou, no mínimo, uma busca no diff por `key`, `token`, `secret`, `password`, `service_role` e `eyJ`.
- Commit e push só quando o dono pedir.

### Banco e servidor

- **Mudança no banco** = arquivo novo em `supabase/migrations/` (idempotente, comentado em português), aplicado e depois **espelhado em `supabase/schema.sql`**, que é sempre o retrato completo do banco. Passo a passo em `docs/arquitetura.md`.
- **Nunca apagar dado do usuário.** Tabela ou campo que sai vai para o schema `backup` (fora da API) ou é limpo só quando já não guarda nada útil.
- Toda tabela nova em `public` tem RLS ligado e policy explícita; funções com `set search_path = ''`; `security definer` só quando precisa, com `revoke` de `public, anon, authenticated`.
- Depois de publicar uma Edge Function, confira as funções publicadas no projeto: hoje são só `catalog-sync` (sem verificação de JWT, protegida pela chave do Vault) e `stamp-image`. Função que não está em `supabase/functions/` não deveria estar publicada.

### Código

- Comentários em português, curtos; nomes em inglês; interface em português do Brasil.
- Cores, tamanhos e espaços pelos tokens de `src/theme.ts` (sem `#hex` ou `rgba(` soltos nas telas) e componentes de `src/components/ui.tsx`, como em `docs/design.md`.
- Antes de dar uma tarefa por pronta: `npm test`, `npm run typecheck` e `npm run lint`.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json` (this project: SDK 58).
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npm test                    # unit tests (Jest, jest-expo)
npm run typecheck           # tsc --noEmit
npm run lint                # expo lint
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run tests, lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `npx eas-cli@latest <command>`; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
