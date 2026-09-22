import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// BLOCO 21 — botões de navegação horizontal ("‹"/"›") nas tabelas mobile.
// Refina o selo decorativo do bloco 20 (só visual) transformando-o em botão
// real, centralizado em table-scroll-hint.js (nenhuma tabela tem lógica
// própria — todas ganham automaticamente via o mesmo observer).
//
// Só JS/CSS puro aqui (sem DOM real no Node) — o comportamento de clique,
// scroll suave, ocultar/mostrar nas bordas e reação ao arraste manual foi
// verificado à parte com Playwright (início/meio/fim, clique E swipe) antes
// de escrever este teste.
// ---------------------------------------------------------------------------

const js = await readFile(new URL("../src/js/ui/table-scroll-hint.js", import.meta.url), "utf8");
const css = await readFile(new URL("../src/css/components.css", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// Lógica central, sem duplicação por tabela — um só enhance()/updateScrollAffordances().
// ---------------------------------------------------------------------------
assert.equal((js.match(/function updateScrollAffordances/g) ?? []).length, 1, "lógica de mostrar/esconder tem que existir uma única vez, reaproveitada por todas as tabelas");
assert.equal((js.match(/function enhance/g) ?? []).length, 1);
assert.equal((js.match(/scrollByStep/g) ?? []).length, 3, "definida uma vez (1 declaração + 2 usos, prev/next) — não duplicada por botão");

// Avança 60-70% da largura visível por clique.
const ratioMatch = js.match(/NAV_STEP_RATIO\s*=\s*([\d.]+)/);
assert.ok(ratioMatch, "precisa existir uma constante clara pro tamanho do passo");
const ratio = Number(ratioMatch[1]);
assert.ok(ratio >= 0.6 && ratio <= 0.7, `passo de navegação (${ratio}) precisa estar entre 60% e 70% da largura visível`);
assert.match(js, /scrollEl\.clientWidth \* NAV_STEP_RATIO/, "o passo precisa ser proporcional à largura visível do container (clientWidth), não um valor fixo em px");

// Scroll suave.
assert.match(js, /scrollBy\(\{ left: [^,]+, behavior: "smooth" \}\)/, "precisa usar scrollBy com behavior:'smooth', não salto instantâneo");

// Botão "‹" volta (direção negativa), "›" avança (direção positiva).
assert.match(js, /navPrev\.addEventListener\("click", \(\) => scrollByStep\(-1\)\)/);
assert.match(js, /navNext\.addEventListener\("click", \(\) => scrollByStep\(1\)\)/);

// Acessibilidade: <button> de verdade (não <div> com onclick) + aria-label em cada um.
assert.match(js, /button\.type = "button";/);
assert.match(js, /navButton\("table-scroll-nav-prev", "Ver colunas anteriores", "‹"\)/);
assert.match(js, /navButton\("table-scroll-nav-next", "Ver mais colunas", "›"\)/);

// Some via [hidden] (some do DOM/acessível), não só opacity — não pode ficar focável por teclado
// escondido. E reage tanto a clique (scrollBy dispara "scroll" a cada frame) quanto a swipe manual,
// porque os dois passam pelo MESMO listener "scroll" do elemento.
assert.match(js, /navPrev\.hidden = !hasBefore;/);
assert.match(js, /navNext\.hidden = !hasAhead;/);
assert.match(js, /scrollEl\.addEventListener\("scroll", \(\) => updateScrollAffordances\(scrollEl, refs\)/, "um único listener de scroll cobre clique nos botões E arraste manual — sem lógica duplicada");

// Início: sem conteúdo antes, "‹" não aparece. Fim: sem conteúdo depois, "›" não aparece.
assert.match(js, /const hasBefore = scrollEl\.scrollLeft > 1;/);
assert.match(js, /const hasAhead = scrollEl\.scrollLeft < maxScroll - 1;/);

// ---------------------------------------------------------------------------
// CSS — visual do selo verde mantido, agora com estados de botão; nunca cobre
// célula (34px, cantos da tabela, z-index só acima do fade que já existia);
// nunca vaza pro desktop.
// ---------------------------------------------------------------------------
const mediaMatch = css.match(/@media \(max-width: 860px\) \{([\s\S]*?)\n\}/);
assert.ok(mediaMatch);
const mobileBlock = mediaMatch[1];

assert.match(mobileBlock, /\.table-scroll-nav \{[^}]*background: var\(--color-primary\);/s, "mesma cor de marca do selo original");
assert.match(mobileBlock, /\.table-scroll-nav \{[^}]*width: 34px; height: 34px;/s, "tamanho de toque pequeno o bastante pra não cobrir célula/texto/badge ao redor");
assert.match(mobileBlock, /\.table-scroll-nav \{[^}]*z-index: 2;/s);
assert.match(mobileBlock, /\.table-scroll-nav\[hidden\] \{ display: none; \}/, "precisa sobrescrever explicitamente o display quando [hidden] — senão a classe .table-scroll-nav{display:grid} venceria e o botão ficaria visível mesmo escondido");
assert.match(mobileBlock, /\.table-scroll-nav:hover \{/, "estado hover");
assert.match(mobileBlock, /\.table-scroll-nav:active \{/, "estado active");
assert.match(mobileBlock, /\.table-scroll-nav:focus-visible \{/, "estado focus (acessibilidade via teclado)");
assert.match(mobileBlock, /\.table-scroll-nav-prev \{ left: 6px; \}/);
assert.match(mobileBlock, /\.table-scroll-nav-next \{ right: 6px; \}/);

// Hint "Deslize para ver mais →" preservado.
assert.match(mobileBlock, /\.table-scroll-hint \{/);

// Fora do @media, só pode existir a linha que ESCONDE por padrão (display:none) — qualquer outra
// menção seria uma regra vazando pro desktop.
const outsideMobile = css.replace(mediaMatch[0], "").replace(".table-scroll-hint, .table-scroll-fade, .table-scroll-nav { display: none; }", "");
assert.doesNotMatch(outsideMobile, /table-scroll-nav/, "nada além do display:none padrão pode existir fora do @media mobile");
assert.match(css, /\.table-scroll-hint, \.table-scroll-fade, \.table-scroll-nav \{ display: none; \}/, "escondido por padrão fora do breakpoint mobile, mesma linha das outras duas peças do padrão");

console.log("Bloco 21 (botões de navegação horizontal nas tabelas mobile): todos os cenários passaram.");
