# Rodadas de revisão da versão 2.0.0

Cada rodada: área verificada → o que foi encontrado → correção.

1. **Carta · estado** — os 6 botões de estado quebravam em 2 linhas em 375 px (o "D" sozinho) → controle segmentado numa linha (`Segmented`).
2. **Carta · quadro de preço** — com uma fonte só, a tabela repetia o valor grande → tabela só com 2+ fontes; botão "Ver anúncios no MYP Cards".
3. **Carta · ficha** — energia incolor (recuo) quase invisível no branco → borda escura sutil e cinza mais forte.
4. **Primeira abertura** — testado sem dados: boas-vindas, botão "Começar" sempre visível, sem voltar para tela vazia → nenhum problema.
5. **Escolher carta · imagens** — cartas sem imagem mostravam o *verso* de uma carta Pokémon (reserva Scrydex): no navegador a ETag que identifica o verso fica escondida (CORS) → também confere o tamanho (45.551 bytes), mede a imagem quando os cabeçalhos estão ocultos; cache renovado (v4).
6. **Busca · campos de texto** — no navegador o campo mostrava o contorno de foco padrão (retângulo laranja) dentro da cápsula; 3 buscas com código repetido → componente `SearchField` (foco = borda vermelha da cápsula, lupa busca, botão limpar); `Input` com o mesmo foco.
7. **Preço · Galeria de Treinador** (relatado: Gengar TG06 sem valor) — a TCGdex usa `swsh11tg-TG06` e o Zukan `swsh11-TG06` → o servidor tenta os dois códigos (vale para TG e GG); carta sem preço passa a ser consultada todo dia, não 1×/semana. Gengar TG06 agora R$ 199,00.
8. **Preço · cartas em inglês de coleções antigas** — Wartortle (EX Guardiões do Cristal, EN) sem preço: o servidor só aceitava o registro "NM em inglês", que não existe para coleções só em inglês → usa o menor anúncio geral do MYP nesses casos; a descrição do valor no app vem do servidor ("menor anúncio NM (inglês)" ou "menor anúncio").
9. **Fichário no computador** (sugestão sua) — em tela larga (≥ 960 px), fichário frente e verso mostra duas páginas abertas como um fichário de verdade: página 1 sozinha ao lado da capa, depois 2–3, 4–5…, e a última sozinha ao lado da contracapa quando cai à esquerda; setas e arrastar avançam de par em par. No celular continua uma página.
10. **Capa** (sugestão sua) — a capa ao lado da primeira página mostra o nome do fichário e o progresso, na cor da capa (texto escuro em capa clara).
11. **Minha coleção (menu)** — revisado no celular: valor, gráfico (pede login quando não há conta), Pokédex/cartas e mais valiosas legíveis → nenhum problema.
12. **Bolsos livres da última página** (sugestão sua) — o fichário Pokédex escondia os bolsos que sobram depois do último Pokémon → aparecem como "bolso livre" (⭐); tocar abre a busca geral (qualquer carta); a carta fica com posição física certa ("Pág. 17 · bolso 8 (livre)"), entra no valor e não conta no progresso da Pokédex; a configuração avisa se uma mudança deixar carta especial sem bolso. Testado de ponta a ponta no navegador. Também: o contorno de foco do navegador ainda aparecia no campo de busca → `outlineStyle: none`.
13. **Ícone e abertura** — o app usava o ícone e a abertura padrão do Expo e declarava tema escuro → ícone próprio (fichário branco com grade de cartas e uma carta especial amarela, sobre o vermelho Pokémon), ícone adaptativo do Android, favicon e abertura vermelha; `app.json` em tema claro; imagens padrão do Expo removidas. Gerador reproduzível em `scripts/make-icons.js`.
14. **Código morto** — varredura de exportações sem uso: lista de cores de capa duplicada (`BINDER_COLORS`) e função exportada à toa → removidas/unificadas.
15. **Salvamento automático** — testado no navegador: estado (SP) salvo na hora e mantido após recarregar; "Meu valor" salvo 700 ms depois de digitar; observação digitada e saída imediata da tela → salva ao sair → nenhum problema.
16. **Acessibilidade · estado da carta** — os botões M/NM/SP… apareciam para leitores de tela como "radio" sem nome → nome e descrição ("SP, Slightly Played — marcas leves").
17. **Carta sem ficha no catálogo** — erro 404 da TCGdex dizia "Confira a internet" (enganoso) e a variação ficava "Carregando…" para sempre → mensagem própria ("a ficha não está no catálogo neste idioma; a carta continua salva") e a variação deixa de esperar. Carta japonesa: o quadro explica que o MYP não cota japonês e sugere "Meu valor".
18. **Novo fichário · capa amarela** — prévia com texto escuro, legível → ok.
19. **Novo fichário · nome** — prévia mostrava "Meu fichário" com o nome vazio, mas o fichário era salvo com o nome da finalidade ("Coleção") → prévia e campo mostram o nome que será salvo.
20. **Conta** — tela de entrar: botões desativados até e-mail válido e senha de 6+ caracteres, "Esqueci minha senha" visível → ok.
21. **Navegação** — fichário → menu → conta pelo app: botão de voltar branco na barra vermelha → ok.
22. **Meus fichários** — fichário aberto destacado, progresso e valor por fichário (o valor do Pokédex inclui as cartas especiais) → ok.
23. **Revisão de código · tela da carta** — ao *trocar* uma carta por outra, tocar em "Colocar no fichário" antes da ficha nova carregar salvava a carta nova com o nome, coleção e imagem da antiga (os dados antigos serviam de reserva) → a reserva só vale para a mesma carta; carta nova só pode ser colocada depois que a ficha carrega.
24. **Botão "Vazio"** — pulava direto para a página seguinte, ignorando os vazios da página atual → percorre os vazios um a um a partir da página atual (testado: Ivysaur → Venusaur). Arrastar a página testado (2 → 3) → ok.
25. **Destaque × carta especial** — o destaque da busca/"Vazio" era amarelo, igual à borda das cartas especiais → destaque em ciano (a cor de seleção do Nintendo Switch).
26. **Carta no computador** — em tela larga a carta ficava numa coluna estreita com muito espaço vazio → carta grande (360 px) à esquerda e informações à direita, como uma ficha de loja.
27. **Textos e comentários** — varredura por menções à Liga/fontes antigas: 2 comentários desatualizados (estados "da Liga", "cotação às 6h, 13h e 20h") → corrigidos; nenhuma menção restante nas telas.
28. **Tablet** — bolsos enormes (~220 px) e a página 3×3 não cabia na tela → a partir de 600 px de largura, o tamanho do bolso é limitado para a página inteira caber na altura da tela; a folha escura encolhe junto.
29. **Documentação** — README sem as novidades → bolsos livres, duas páginas no computador, Minha coleção com gráfico, salvamento automático, visual Pokédex, estrutura (ui, tema, gerador de ícones) e link para o CHANGELOG.
30. **Regressão completa** — todas as telas abertas no celular, console do navegador conferido: a estante tinha botão dentro de botão (engrenagem dentro do cartão do fichário; HTML inválido na web e confuso para leitores de tela) → dois botões lado a lado; varredura nas outras telas: nenhum caso.
31. **Verificação final de código** — checagem de tipos e lint limpos em todo o app, sem avisos.
32. **Segredos** — varredura das 53 alterações por chaves, tokens, e-mail, telefone e endereço do Supabase antes de versionar → nada encontrado.
