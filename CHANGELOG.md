# Notas da versão

## 3.0.2 — Ano das coleções (25/10/2026)

- **Ano ao lado da coleção** na lista de cartas de um Pokémon e na busca para adicionar ("Realeza Absoluta Galeria de Galar · 2023"). O ano vem da TCGdex (todas as coleções numa consulta só, guardada por 7 dias) e, para as coleções que só existem no catálogo (promos, Battle Academy…), da data de lançamento do TCGCSV, que o servidor passou a guardar.

## 3.0.1 — Preparação para publicar (24/10/2026)

- **Fichário no computador usa a tela inteira**: sem o teto de 1.440 px, o bolso cresce até a página caber na altura da janela (até 220 px). Numa tela de 2000 px o bolso passou de ~75 para ~126 px, e páginas, painel e barra do topo ficam centralizados e alinhados.
- **Trocar, Mover e Remover à vista** na tela da carta, logo abaixo da posição (continuam também no ⋯ do topo).
- **Web instalável**: o endereço publicado vira um app na tela inicial ("Instalar app" no Chrome, "Adicionar à Tela de Início" no Safari), com nome, cor e ícone do Fichário.
- **Pronto para um APK Android** (EAS Build e atualizações pela internet), se um dia for preciso: só o app nativo atualiza os preços do MYP.
- **Cadastro fechado**: só as contas que já existem entram; "Criar conta" explica e some. Senha com no mínimo 8 caracteres.
- **Nova senha**: o link do "Esqueci minha senha" abre a tela "Nova senha", no app ou na web.
- **Menos consumo de dados no servidor**: a cópia do catálogo só relê as cartas guardadas da TCGdex quando há coleção em inglês para ligar (de ~6,7 GB para ~0,2 GB por mês, abaixo do limite de 5 GB do plano grátis).
- **Segurança**: as funções dos gatilhos saíram da API, e as Edge Functions usam a chave secreta nova do Supabase (as chaves antigas deixam de valer até o fim de 2026).

## 3.0.0 — Fichário mais fácil de usar, valor mais claro e cópia diária (24/10/2026)

Revisão completa do app a partir de duas revisões da 2.8.0 (a geral e a "de estúdio"), em fundações, telas e qualidade.

### Fichário
- **Topo compacto e fixo**: menu, nome do fichário ⌄ com o progresso ("48 de 1.025 Pokémon"), busca e ajustes, com uma linha de progresso. A barra usa a **cor da capa** do fichário e ocupa bem menos altura, então a página sobe.
- **Botão "+ Carta"** (flutuante no celular, na barra no computador): abre o novo fluxo de adicionar.
- **Cada fichário lembra a página** em que você parou. Toque em "Pág. N de M" para **ir direto a uma página**, com o quanto cada uma está cheia. "Vazio" virou **"Próxima falta"**, e a linha embaixo mostra "#241–#260 · 15/20" ou "completa ✓".
- **Régua de regiões** no Pokédex ("Kanto 31/151", ✓ quando completa): acompanha a página e leva à região com um toque.
- **Busca ao vivo** enquanto você digita, sem depender de acento, apóstrofo ou hífen ("farfetchd", "mr mime"): Pokémon (tenho/falta, valor e página), cartas deste fichário, bolso pelo número (inclusive vazio), outros fichários, "Procurar em toda a coleção" e "Adicionar carta de …". O destaque fica enquanto há texto na busca, e Enter de novo vai para o próximo resultado.
- **Folha com cara de página de fichário**: furos na lombada, bolsos como capas plásticas. A **borda amarela fica só nas especiais de verdade** (1ª edição, Shadowless, Poké/Master Ball, promo com selo, staff, raras altas), e só depois que a imagem aparece; holo e reverse ganham uma marca no canto (✦ / R). O preço do bolso é neutro, com ≈ (aproximado) ou ✎ (Meu valor).
- **Folhear acompanha o dedo** e a carta recém-colocada entra com um pequeno salto (sem animação com "reduzir movimento").
- Bolso vazio do Pokédex com o número, o Pokémon maior e o nome. No celular, **toque longo num bolso** mostra uma prévia da carta.
- **Cartas fora do fichário** na configuração atual (faixa, espaços por Pokémon ou tamanho menores) não somem mais em silêncio: "N cartas fora do fichário nesta configuração · Ver" lista cada uma com o motivo. Elas continuam salvas e no valor. Ao salvar uma configuração que muda cartas de lugar no fichário físico, o app avisa quantas mudam e pede confirmação, e mostra quantos fichários físicos o Pokédex ocupa ("Cabe em 2 fichários de 40 folhas").
- Valor do topo: **"Valor deste fichário"**, a linha de créditos ("Preços: MYP Cards ↗ · TCGplayer ↗ · Meu valor") e, com conta, a variação de 7 dias. Saiu a linha mín · méd · máx.
- Enquanto a coleção carrega, aparece a página em esboço, e as miniaturas das páginas vizinhas já vêm baixadas.

### Carta
- **Corrigido**: trocar uma carta por outra podia gravar na nova o estado, as observações e o "Meu valor" da antiga.
- **Trocar pela mesma carta em outro idioma ou com selo** agora funciona. A tela avisa "Vai substituir X", oferece "Manter estado, origem e observações" e "Mover a antiga para…".
- **"Mover para…"**: outro fichário, outro bolso ou os espaços do Pokémon no Pokédex, com a posição física; se o bolso estiver ocupado, as duas cartas trocam de lugar.
- **Toast com "Desfazer"** ao colocar, trocar, mover e remover. Remover não pede mais confirmação: o Desfazer traz a carta de volta com tudo.
- **"Meu valor" e "Valor pago" lidos como no Brasil**: "1.500" e "1500" viram R$ 1.500,00 (antes, "1.500" virava R$ 1,50), e a tela mostra "= R$ 1.500,00". Texto inválido mostra o erro e não apaga o valor salvo.
- **Quadro de preço mais curto**: os nomes verdadeiros de cada preço (MYP: menor anúncio, média dos anúncios, maior anúncio; TCGplayer: menor anúncio, mercado, mediana), "Usar na soma", "≈ Aproximado" só quando vale, um link por loja e os detalhes da cotação recolhidos. O ⓘ abre "Como calculamos o valor".
- Carta em inglês com o preço dos EUA longe dos anúncios daqui: um aviso mostra a faixa do MYP Cards e oferece "✎ Usar meu valor". "✎ Definir meu valor" leva direto ao campo.
- "Meu valor" trocado em segundo plano (o mercado passou dele) não volta mais na próxima edição, e a tela avisa.
- **Histórico do preço** de cada carta, com gráfico quando há dois dias ou mais.
- **"Qual é a sua versão?"** mostra também as versões com selo do catálogo, cada uma com a foto oficial.
- **Posição física de verdade**: "Fichário 2 · folha 5 (frente) · bolso 8" quando o Pokédex ocupa mais de um fichário. "Ver no fichário" abre a página e destaca o bolso.
- **No celular**, a imagem fica ao lado do nome e o Estado perto do topo; Trocar, Mover e Remover ficam no menu ⋯. Carta nova mostra só Estado e Variação, com "Mais detalhes (opcional)".
- "Você já tem esta carta" agora separa as versões: outro selo, reverse ou holo aparecem como "outra versão".
- Carta nova cuja ficha não carrega: mensagem própria e "Tentar de novo".
- Textos corrigidos ("Existe 1 versão", "bolso extra", "Mais variações") e nenhum erro técnico na tela.

### Coleção e valores
- **Um nome para cada valor**: "Valor da carta", "Valor deste fichário", "Valor da coleção · N fichários", "Usar na soma", com a mesma regra e os mesmos textos em todas as telas.
- **Minha coleção**: cartão de valor em grafite (sem vermelho sobre vermelho), total sem centavos e, com menos destaque, "Se cada carta saísse pelo menor anúncio … · pela média …". A soma dos maiores anúncios foi para "Como calculamos", com o aviso de que não é preço de venda.
- **"Como calculamos o valor"** numa folha que abre pelo ⓘ, no lugar dos parágrafos espalhados pelas telas.
- **Variação do período só com as mesmas cartas** nos dois dias: carta nova, removida ou trocada aparece à parte ("+3 cartas novas · −1 removida") e não conta como alta ou queda.
- Gráfico com a linha do valor em tinta neutra e um resumo para leitor de tela. O total de cada dia vem somado do servidor (o gráfico abre mais rápido).
- **Mais valiosas** com miniatura, a base do valor ("pelo menor anúncio", "✎ Meu valor") e a participação de cada carta no total; "Ver as 20 mais valiosas".
- **Maiores altas e quedas** do período e **Compras**: quanto você pagou × quanto as cartas compradas valem hoje.
- Aviso quando o mercado passa de um "Meu valor" que você digitou.
- **A foto diária** guarda só as cartas com preço, e as cartas em inglês entram com o preço da TCGplayer do dia mesmo sem o app aberto. A TCGplayer vale só para cartas em inglês, também no histórico.
- "Atualizado em" virou a idade dos preços ("Preços de 15/10 a 22/10 · 3 cartas com preço de mais de 7 dias").
- **MYP Cards**: as cartas não encontradas antes e as promos de coleções de promos (SWSH, DP, HGSS…) são buscadas de novo, também pelo número sem a letra. As cartas em inglês que já têm preço da TCGplayer vão para o fim da fila.
- Nova tela **"Sobre e fontes"**: como calculamos, fontes e créditos com link, estado do servidor (última atualização do catálogo, falhas nas últimas 24 h, data dos preços e do câmbio) e a versão do app.

### Busca, adicionar e listas
- **"+ Carta"**: busque, toque na carta e escolha a versão, o estado e **onde colocar**, com sugestões prontas (o fichário aberto, o espaço vazio do Pokémon no Pokédex, o primeiro bolso livre de cada fichário, o bolso extra). "Colocar" salva na hora, com "Desfazer", e a tela segue pronta para a próxima ("N cartas adicionadas · Concluir").
- **Adicionar por código**: "MEG 133", "133/132 MEG", "SIT 186", "swsh12-186"…
- **Busca sem acento e sem apóstrofo** ("pocao", "farfetchd", "flabebe", "nidoran♀") e **por nome e número** ("Gengar TG06", "Charizard 4/102"). Os avisos dizem o que aconteceu: "Nenhuma carta com o nº X; mostrando todas", "As 1.200 mais recentes, refine a busca" (antes, cortava em 300 sem avisar).
- **Lista de cartas agrupada por coleção**, com ordem (Mais novas, Mais antigas, Nº), atalhos por série e filtro por nome, coleção, selo e número. A grade usa de 3 a 8 colunas conforme a largura.
- A lista de um Pokémon aparece antes e as versões com selo chegam logo depois. Quando uma fonte não responde, o app avisa e oferece "Buscar de novo" (antes, guardava a lista incompleta por 24 h).
- O selo "tenho" na lista considera a versão.
- **Buscar na coleção**: em todos os fichários, sem internet, por nome, coleção, selo, variação ou número, com a posição física de cada carta.
- **Listas "Preciso" e "Tenho repetida"**, prontas para mandar no WhatsApp ou copiar. Sem preço por padrão; com "Mostrar preços", a lista leva a atribuição ao MYP Cards e à TCGplayer.

### Sincronização e backup
- **Carta removida não volta mais** pela sincronização de outro aparelho: a remoção fica registrada no servidor e chega a todos os aparelhos.
- **Sincronização incremental**: depois da primeira, só o que mudou vai e vem.
- **Gravar um preço não conta mais como edição**: um preço não passa por cima de uma edição ou remoção ainda não enviada, e um aparelho atrasado não desfaz um preço mais novo.
- **Aparelho novo não apaga mais a nuvem**: na primeira sincronização, vale a configuração da nuvem, e os fichários livres dos dois lados são juntados.
- **A coleção no aparelho ficou mais segura**: uma carta por chave (cada mudança grava só a carta que mudou); uma falha de leitura não apaga mais nada, e dado ilegível é guardado à parte.
- **Estado da sincronização em português**, no menu e na conta: salvo só neste aparelho, sincronizando, sem conexão · N aguardando, erro, sincronizado em… Uma falha é tentada de novo sozinha (30 s, 2 min e depois a cada 10 min).
- **Cópia da coleção**: exporte em JSON ou em planilha (CSV, sem preços por padrão) e importe de volta (na web, pelo arquivo; no celular, colando o texto). Funciona também sem conta.
- **Cópia diária automática no servidor**, às 00:20, guardada por 14 dias.
- Primeira abertura: sem a seta de voltar que não levava a lugar nenhum e com **"Já uso em outro aparelho · Entrar"**, que traz o fichário da nuvem.
- Campos antigos das fontes que saíram foram tirados das cartas (cada carta ficou bem menor).

### Catálogo
- **Mais cartas ligadas à TCGdex**: Nidoran ♀/♂, Unown, Gold Star (☆), Prism Star (◇), promos SWSH e DP e cartas dos kits de treinador. Nomes quebrados do catálogo foram corrigidos (ex.: "Deoxys (Delta Species" → "Deoxys").
- **Cartas do Zukan não aparecem mais em dobro** com a versão "só do catálogo".
- A foto do catálogo fica salva na carta, e as imagens reserva vêm em tamanho de miniatura. A versão com selo usa a foto conhecida sem buscar de novo.
- Listas e fichas ficam guardadas no aparelho com validade, e a limpeza tira só o que é grande quando o armazenamento enche.
- **Registro de cada atualização do catálogo** no servidor (a cada 10 min), visível em "Sobre e fontes".

### Visual e acessibilidade
- **Cada cor com um significado só**: dinheiro em tinta neutra, amarelo só para especiais, seleção em grafite, ciano para destaque e foco, verde e vermelho só para alta e queda.
- **Contraste AA** nos textos claros, bordas de campo visíveis e texto escuro nas capas claras (laranja, amarelo, verde, turquesa, rosa e cinza).
- Escala de tipografia e de espaçamento; números com algarismos tabulares; nada abaixo de 10 px nos bolsos, nem cortado com a fonte do sistema em 130%.
- Alvos de toque de 44 px; chips, segmentos e interruptores dizem ao leitor de tela se estão marcados.
- **Leitores de tela**: o bolso diz nome, coleção, variação, estado, preço e "destacado"; troca de página, resultados da busca e avisos são anunciados; o custo de ataque é lido ("Custo: Fogo e Incolor").
- **Esboços no lugar do carregando** nas listas de cartas e na página do fichário.
- Poké Ball desenhada em SVG, no lugar do ícone da fonte MaterialCommunityIcons.
- Erro numa tela mostra uma tela amigável com "Tentar de novo" e "Voltar ao fichário", em vez do app quebrado.

### Computador e web
- **Home no computador**: uma barra só (busca no meio, "+ Carta"), a página cabe na altura da janela e um painel lateral mostra valor, créditos, variação, avisos, regiões e atalhos. A partir de ~1280 px, fichários frente e verso abrem duas páginas, com "Faltam N Pokémon" na capa.
- **Teclado**: ←/→ e PgUp/PgDn folheiam, Home/End, "/" busca, F vai para a próxima falta, Esc limpa. Foco visível e hover em bolsos, botões e sugestões.
- **Tudo tem URL**: o fichário e a página ficam no endereço (recarregar volta ao mesmo lugar), e os bolsos são links de verdade (Ctrl+clique abre em outra aba).
- **Carta no computador**: sem a faixa vermelha vazia, a imagem fica parada à esquerda enquanto a direita rola; a partir de 1280 px, "Valor da carta" e "Minha carta" lado a lado.
- **Minha coleção no computador** em colunas: valor ao lado do gráfico, números da coleção, vitrine das mais valiosas com as artes e os ajustes à direita.
- Links externos abrem numa aba nova, pelo teclado também. O título da aba diz onde você está ("Charizard · Fichário Pokédex"), a página é marcada como português e o voltar é anunciado "Voltar".

### Bastidores
- **Testes automatizados** (Jest, com o `jest-expo`) da lógica pura, com `npm test`; `npm run typecheck` e `npm run lint` conferem o resto. O GitHub roda tudo isso a cada envio (`.github/workflows/ci.yml`), mais uma varredura de segredos (gitleaks).
- `supabase/schema.sql` é o retrato completo do banco e pode rodar mais de uma vez; as mudanças de banco ficam em `supabase/migrations/`.
- Regras fixas do projeto em `AGENTS.md`, mapa para quem chega em `docs/arquitetura.md` e o sistema visual em `docs/design.md`.
- No servidor ficaram só as Edge Functions em uso (`catalog-sync` e `stamp-image`). As tabelas das fontes que saíram foram guardadas no schema `backup`, fora da API, e o histórico do pg_cron e os registros de remoção são limpos todo dia.
- Trocar uma carta pela mesma em outro idioma não herda mais o preço da antiga.
- Formatação de dinheiro e datas num lugar só (`src/lib/format.ts`) e os textos do valor em `src/lib/copy.ts`. A coleção é lida por assunto (cartas, fichários, configuração, sincronização), então gravar um preço não redesenha mais a página do fichário.
- Versão 3.0.0 no app; pacotes sem uso removidos e as dependências do Expo atualizadas.

## 2.8.0 — Cartas em inglês pelo preço da TCGplayer (23/10/2026)

- **Cartas em inglês valem pelo preço da TCGplayer (EUA)**, o principal mercado de cartas em inglês, em reais pela **PTAX do Banco Central**: mínimo = menor anúncio, média = valor de mercado (vendas recentes), máximo = mediana dos anúncios. A escolha de mínimo/média/máximo de cada carta continua valendo. O MYP aparece como referência (ele mistura todos os idiomas).
- O preço é da impressão certa (normal, holo, reverse, 1ª edição…) e da versão com selo, Poké Ball, Master Ball, holo especial (Cosmos, Cracked Ice, Reverse Cosmos da Costco…) ou de loja (Best Buy…) quando a TCGplayer vende à parte; senão, o da carta base, com confiança baixa. Carta sem vendas recentes na TCGplayer usa o MYP, com confiança baixa — o app não estima.
- O servidor copia os preços do **TCGCSV** 1×/dia por coleção (espelho gratuito da TCGplayer; o app nunca chama o TCGCSV) e a PTAX dos dias úteis; o app lê do banco, então os preços em inglês aparecem também na versão web.
- O "Meu valor" de uma carta em inglês é trocado quando o valor de mercado da TCGplayer passa dele (o MYP não troca mais nas cartas em inglês); a tela da carta diz qual fonte trocou e, enquanto o "Meu valor" vale, mostra o mínimo/média/máximo da TCGplayer como referência.
- O app só grava o preço da TCGplayer quando ele muda e olha cada carta no máximo 1×/hora enquanto o servidor copia as coleções, então não gera escritas repetidas nem muda a data das cartas nos outros aparelhos à toa.
- A tela da carta mostra o valor em dólar, o câmbio usado, o link "TCGplayer ↗" e o crédito "via TCGCSV · PTAX do Banco Central".
- Versões "Non-Holo" do catálogo (de deck, Target, DVD…) aparecem como **normais**, não como holo. Trocar a variação pelos chips volta para a versão comum (o selo de uma versão escolhida em "Ver versões" sai).
- A bandeira do idioma sobre a imagem saiu; quando a foto é da versão em inglês, uma linha embaixo do nome avisa.

## 2.7.0 — Você escolhe o valor de cada carta (22/10/2026)

- **Mínimo, média ou máximo**: na tela da carta, toque no preço do MYP que vale para ela (ex.: o mínimo para cartas novas, em que ele costuma ser o valor real; a média para as antigas). A escolha fica salva na carta; sem escolha, vale a média.
- **Valor calculado**: a soma da coleção mostra em destaque o valor calculado (o valor escolhido de cada carta) e, embaixo, a soma dos mínimos, das médias e dos máximos. O cabeçalho do fichário, a lista de fichários, as mais valiosas, os bolsos e a comparação com o valor de compra usam o valor escolhido.
- **Gráfico de rendimento**: a linha passa a ser o valor calculado (a foto diária guarda a escolha de cada carta), com a faixa do mínimo ao máximo.
- A API do MYP não separa os preços por idioma nem por estado: os três valores juntam todos os anúncios do produto.
- **Foto da carta em português**: quando a TCGdex só tem a foto em inglês de uma carta em português, o app usa a foto em português do MYP, se ela existir (o MYP às vezes informa uma foto que não existe; o app confere antes). Sem foto em português, a tela avisa numa linha que a foto é da versão em inglês; a bandeira sobre a imagem saiu.
- **Busca pelo código do produto no MYP** quando o nome não acha: o MYP cadastra algumas cartas com o número no nome e sem nome em português (ex.: "Mega Clefable ex - 031/088", "Nidorina (30th Celebration)"); nas coleções clássicas, o número original vem do catálogo do TCGCSV (ex.: Gengar da coleção de 30 anos = "Gengar (Prime)" 94/102).

## 2.6.1 — Preços que faltavam (22/10/2026)

- **A carta aberta na tela passa na frente da fila** de busca do MYP no celular: abriu uma carta sem preço, ela é buscada na hora.
- "Nidoran♀"/"Nidoran♂" também são buscadas como "Nidoran Fêmea"/"Nidoran Macho" (o MYP escreve "Nidoran F").
- Carta que falhou na busca tenta de novo assim que é aberta, sem esperar a pausa de 1 hora.
- **Versão especial sem produto próprio no MYP usa o preço da carta base** (ex.: Bulbasaur 133 com o selo da Booster Box = Bulbasaur 133 comum), que tem valor parecido: mínimo/média/máximo entram no valor e nos totais, com confiança baixa e o aviso "preço da carta base". A regra do "Meu valor" vale igual para essas versões.

## 2.6.0 — Valor por mínimo, média e máximo (22/10/2026)

- **O valor da carta é a faixa do MYP**: mínimo, média e máximo dos anúncios, como a API do MYP informa, lado a lado na tela da carta (a média em destaque).
- **Minha coleção em três colunas**: soma dos mínimos, das médias e dos máximos. Cartas com "Meu valor" entram com ele nas três.
- **Gráfico de rendimento com a faixa**: área do mínimo ao máximo e a linha da média, com legenda; a variação do período continua pela média.
- Faixa também no cabeçalho do fichário, na lista de fichários, nas cartas mais valiosas e na comparação com o valor de compra (quanto a carta rende no mínimo e no máximo).
- O "Meu valor" não mudou: continua fixo até a média do MYP passar dele. Nos bolsos do fichário aparece a média.

### Versões com selo
- **Mais de 4 mil versões especiais reconhecidas**: a TCGplayer guarda muitas versões com selo em coleções "de tudo um pouco" (Miscellaneous, Prize Pack, Deck Exclusives, Liga e Campeonatos, Trick or Trade…). Agora cada uma é ligada à carta da coleção de origem pelo número completo (ex.: "Bulbasaur - 133/132 (Mega Evolution Stamped)" = Bulbasaur Megaevolução 133 com o selo da Booster Box).
- A versão da Booster Box e a do Pokémon Day aparecem uma vez só, com a **foto oficial** da TCGplayer e o nome do selo em português.
- A busca dos fichários livres também mostra as versões com selo.

### Preços do MYP
- Mais cartas encontradas: nomes como "Alakazam-EX", promos cadastradas com letra ("MEP 079a"), as coleções clássicas (30 anos e Celebrations, que o MYP numera pela carta original) e promos de coleções de promos sem selo marcado.
- Uma busca por nome serve todas as cartas com aquele nome (ex.: vários Gengar com uma consulta só), então o app no celular termina a fila bem mais rápido. As cartas não encontradas antes são buscadas de novo.
- O cabeçalho do fichário avisa quantas cartas esperam o preço; no celular, o app precisa ficar aberto enquanto busca.

## 2.5.0 — Valor só pelo MYP Cards e "Meu valor" (22/10/2026)

- **Duas fontes de valor**: o "Meu valor" (fixo até a média do MYP passar dele) ou a média dos anúncios no MYP Cards, mostrada com o mínimo e o máximo. A média é o que entra nos totais e no gráfico de rendimento.
- Saíram as outras fontes: o menor anúncio via Zukan (provisório), as vendas reais do "Quanto vale minha carta?" e a leitura das ofertas por estado nas páginas do MYP (que nunca chegou a rodar, porque o MYP bloqueia servidores).
- O quadro de valor da carta ficou mais simples: valor, mínimo/média/máximo do MYP, links para o MYP e a Liga. O gráfico de 30 dias do menor anúncio saiu (o gráfico de rendimento da coleção continua, pela média).
- No servidor, o cron de preços (price-sync) foi desligado e a foto diária do valor guarda só o "Meu valor" e o mínimo/média/máximo do MYP. O Zukan continua só no catálogo (cartas novas e imagem reserva).

## 2.4.0 — Catálogo do TCGCSV e preços do MYP por mínimo/média/máximo (22/10/2026)

### Preços
- **Mínimo, média e máximo do MYP Cards** em cada carta, pela API pública do MYP. A **média** é o valor da carta e entra nos totais e no **gráfico de rendimento**; a coleção mostra também a faixa (soma dos mínimos e dos máximos).
- **"Meu valor" é o único valor fixo**: quando a média do MYP passa dele, ele é apagado e a carta volta a usar mínimo/média/máximo (a tela da carta avisa).
- Sem token, a API do MYP só atende aparelhos: **o app no celular busca os preços aos poucos** (no máximo 10 consultas por minuto), cartas novas primeiro, e grava no banco mesclando só o preço; a versão web mostra os valores e avisa quando ainda faltam.
- Versões com selo usam o produto próprio da versão no MYP quando ele existe (ex.: "Pokemon Day 2026"); senão, o preço do produto comum aparece só como referência.
- Crédito "MYP Cards" com link nas páginas do fichário e na lista de fichários, como a API exige.

### Catálogo

- **Base principal do catálogo: TCGCSV** (cópia diária e gratuita do catálogo da TCGplayer). As listas de cartas trazem todas as coleções, inclusive as recém-lançadas, e as versões com selo vendidas à parte, cada uma com a foto oficial. A TCGdex continua como base secundária: nome e imagem em português, ficha da carta, variações e preços.
- Cartas que só existem no TCGCSV abrem com a foto e a ficha básica (bandeira 🇺🇸 EN).
- A versão com selo escolhida na lista guarda a foto oficial e aparece com ela no fichário.
- Cartas japonesas continuam vindo da TCGdex por enquanto.

## 2.3.0 — Todas as cartas, todas as artes (21/10/2026)

- **Cartas que faltavam**: a lista de cada Pokémon completa com o catálogo do Zukan as cartas que a TCGdex ainda não tem (ex.: Nidorina MEP 101 da ETB de 30 anos, coleção me06).
- **Promos com arte**: cartas em português sem imagem usam a do catálogo em inglês (quase todas as promos SWSH e SM), e as reservas Scrydex e Zukan cobrem o resto (SVP 175+, MEP, me06).
- **Versões com selo na lista**: aparecem como cartas à parte (ex.: Bulbasaur Megaevolução 133 da Booster Box), já com a variação e o selo marcados.
- **Foto oficial da versão com selo**: quando a TCGplayer lista a versão à parte (Pokémon Center, campeonatos, concursos), a foto vem do TCGCSV.
- **Bandeira do idioma da imagem** na tela da carta (ex.: 🇺🇸 EN quando a foto é da carta em inglês).
- **Valor por versão**: versões especiais (selo, Poké Ball, Master Ball, 1ª edição…) não usam mais o preço do MYP da versão comum.
- **Voltar**: recarregar a página numa carta não deixa mais sem a seta de voltar ao fichário.
- Listas de cartas renovadas todo dia (promos novas aparecem logo).

## 2.2.0 — Versão da carta, origem e "Meu valor" automático (21/10/2026)

- **"Qual é a sua versão?"**: ao escolher uma carta que tem mais de uma versão visual (normal, reverse, holo, Poké Ball, 1ª edição, promo com selo…), aparecem as versões lado a lado para tocar na sua. Promos com selo já preenchem o nome do selo (ex.: Bulbasaur da Megaevolução 133 com o selo da coleção).
- Botão **"Ver versões"** na seção Variação, para rever ou trocar a versão depois.
- **Origem da carta**: Troca, Booster ou Compra. Na compra, o campo "Valor de compra" mostra quanto a carta valorizou (ou desvalorizou) desde então.
- **"Meu valor" automático**: se o preço do MYP passar do seu "Meu valor", ele é apagado e a carta volta a usar o MYP; a tela da carta avisa quando isso acontece.
- **MYP pelo menos semanal**: o preço de cada carta é renovado a cada 6 dias, para nunca ter mais de uma semana.
- **Vendas reais sem registro**: quando o Quanto vale minha carta? não tem nenhuma venda da carta, a tela agora avisa (antes não aparecia nada).

## 2.1.0 — Vendas reais como fonte de valor reserva (21/10/2026)

### Preços
- **Nova fonte reserva: vendas reais finalizadas** do [Quanto vale minha carta?](https://quantovaleminhacarta.com.br), no estado e idioma da carta. O MYP Cards continua sendo a fonte principal; quando a carta não tem anúncio no MYP, a mediana das vendas reais vira o valor (confiança média com 3 ou mais vendas, baixa com 1 ou 2).
- **Vendas reais por estado** (M, NM, SP, MP, HP, D) na tela da carta, com o número de vendas de cada um.
- **Só vale a mesma variação**: vendas de outra versão (ex.: Normal para uma promo carimbada) aparecem com aviso e não entram no valor.
- Cartas japonesas, que o MYP não cobre, agora podem ter valor pelas vendas reais.
- O gráfico da coleção usa a mesma regra; o histórico diário passa a guardar as vendas reais.
- No servidor, a função `myp-sync` virou `price-sync` (MYP + vendas reais, com cache de 7 dias).

### Correções
- Editar uma carta não apaga mais os dados de vendas reais já buscados.

## 2.0.0 — Visual Pokédex e revisão completa (21/10/2026)

O app foi revisado de ponta a ponta, em 32 rodadas de verificação e correção. Esta versão traz um visual novo, inspirado na Pokédex e no Nintendo Switch, novos recursos pedidos e várias correções.

### Visual novo
- **Tema Pokédex**: barras do topo em vermelho Pokémon, fundo claro com cartões brancos (como a interface do Nintendo Switch) e destaques no amarelo e no azul do logo Pokémon.
- **Páginas do fichário escuras**, como as folhas plásticas de um fichário de verdade; cartas especiais (holo, reverse, promo…) com borda amarela.
- **Destaque em ciano** (a cor de seleção do Switch) para a busca e o botão "Vazio", diferente do amarelo das cartas especiais.
- Botões em pílula, controle segmentado para o estado da carta, campos com foco em vermelho, ícones de Poké Ball nos estados de carregando e vazio.
- **Ícone e tela de abertura novos**: um fichário branco com grade de cartas e uma carta especial em amarelo, sobre o vermelho Pokémon.

### Novidades
- **Duas páginas abertas no computador**: em tela larga, fichários frente e verso abrem como um fichário de verdade — a página 1 sozinha ao lado da capa, depois 2–3, 4–5… e a última sozinha ao lado da contracapa quando cai do lado esquerdo.
- **Capa com o nome do fichário** e o progresso, ao lado da primeira página.
- **Bolsos livres na última página do fichário Pokédex**: os bolsos que sobram depois do último Pokémon ficam livres para cartas especiais (qualquer carta). Elas entram no valor do fichário, mas não contam no progresso da Pokédex.
- **Folhear arrastando**: arraste a página para o lado para trocar de página; os botões de página também aparecem embaixo da página.
- **Minha coleção**: valor total em destaque, **gráfico da evolução do valor da coleção** (1M, 3M, 6M, 1A) com a variação no período, e as 5 cartas mais valiosas.
- **Salvamento automático** na tela da carta: mudar o estado, a variação, o "Meu valor" ou as observações salva na hora (inclusive se você sair da tela logo depois de digitar).
- **Carta no computador**: imagem grande à esquerda e informações à direita.
- **Tablet e computador**: a página inteira do fichário cabe na altura da tela.
- **Boas-vindas** na primeira vez que o app abre.
- **Esqueci minha senha** na tela da conta, e mensagens de login em português.
- **"Vazio"** agora percorre os espaços vazios um por um, a partir da página atual.
- **Botão "Liga Pokémon"** na tela da carta, ao lado do "MYP Cards": abre a carta na Liga para consulta (o valor continua vindo só do MYP).

### Preços (MYP Cards)
- O valor de cada carta vem **só do MYP Cards** ("Meu valor" tem prioridade); carta sem anúncio mostra "sem preço".
- **Cartas de Galeria de Treinador e Galeria Galar** (ex.: Gengar TG06) passaram a ter preço.
- **Cartas em inglês de coleções antigas** (ex.: Wartortle de EX Guardiões do Cristal) passaram a ter preço.
- Cartas **sem preço** são consultadas de novo todo dia (antes, 1 vez por semana).
- Cartas japonesas mostram que o MYP não informa preço de cartas japonesas e sugerem "Meu valor", em vez de ficarem "buscando" para sempre.
- Link "Ver anúncios no MYP Cards" no quadro de preço e na tela Minha coleção.

### Correções
- Ao **trocar uma carta por outra**, colocar a nova antes da ficha carregar podia salvá-la com o nome, a coleção e a imagem da carta antiga.
- Cartas sem imagem mostravam o **verso de uma carta Pokémon** no lugar (imagem reserva) no navegador.
- Os botões de estado (M, NM, SP…) quebravam em duas linhas em celulares de 375 px.
- Quando a ficha da carta não existe no catálogo, o aviso dizia "confira a internet" e a variação ficava "carregando" para sempre.
- No navegador, os campos de busca mostravam o contorno de foco padrão (retângulo laranja) dentro da cápsula.
- Na estante de fichários, o botão de personalizar ficava dentro do botão do fichário (inválido no navegador e confuso para leitores de tela).
- Energia incolor quase invisível na ficha da carta; capa amarela com texto branco ilegível; prévia do fichário novo com um nome diferente do que seria salvo.
- Leitores de tela: nomes nos botões de estado, nas cores de capa e nos controles de página.

### Por dentro
- Removido todo o código das fontes antigas (Liga, vendas reais, TCGplayer, Cardmarket), as imagens padrão do Expo e código sem uso.
- Componentes visuais compartilhados (`src/components/ui.tsx`), grade de cartas e gráfico reutilizáveis, tema centralizado (`src/theme.ts`).
- `scripts/make-icons.js` gera o ícone, o ícone adaptativo do Android, o favicon e a imagem de abertura.

O registro de cada rodada de revisão está em [docs/revisoes-2.0.0.md](docs/revisoes-2.0.0.md).
