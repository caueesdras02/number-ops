import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderCampaigns } from "../src/js/ui/campaigns-view.js";

// ---------------------------------------------------------------------------
// BLOCO 20 — padrão mobile consistente pra TODAS as tabelas largas (Campanhas,
// Usuários, Number Ops Bot, Autorizações de cadastro, Log de atividades).
//
// Histórico: a primeira tentativa fixava (position:sticky) a primeira coluna
// só de Campanhas. Verificação visual mostrou dois problemas reais: (1) não
// resolvia a percepção de "a tabela termina aqui" — sticky não tem nada a
// ver com o usuário perceber que existe scroll; (2) a célula de Ações com
// vários botões ficava parcialmente atrás da coluna fixa no fim do scroll,
// e a correção (botões empilhados) deixava as linhas mais altas — o oposto
// do pedido. Removido. A solução atual é central (table-scroll-hint.js +
// components.css), sem nenhuma coluna fixa em nenhuma tabela, e por isso já
// vale pra todas as tabelas automaticamente, sem precisar marcar cada uma.
//
// Só JS puro + asserções de texto no CSS/JS (mesmo estilo dos blocos
// 6/18/19) — a verificação visual (320/375/390/430px, claro/escuro, início/
// meio/fim do scroll, em Campanhas/Usuários/Bot) foi feita à parte com
// Playwright antes de escrever este teste.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Nenhuma tabela usa coluna fixa — nem Campanhas, nem nenhuma outra.
// ---------------------------------------------------------------------------
const squads = [{ id: "s1", name: "Squad Alpha" }];
const clients = [{ id: "c1", name: "Cliente A" }];
const responsibles = [{ id: "r1", name: "Fulano" }];
const campaigns = [{ id: "camp1", name: "Campanha", notes: "", squadId: "s1", clientId: "c1", responsibleId: "r1", status: "ACTIVE", stage: "CAPTACAO" }];
const html = renderCampaigns({ campaigns, clients, squads, responsibles, filters: { query: "", status: "", stage: "" }, gaps: [], canEdit: true });
assert.doesNotMatch(html, /table-sticky-first-col/, "coluna fixa foi removida — não deve sobrar nenhum vestígio na tabela de Campanhas");
assert.match(html, /<th>Campanha<\/th><th>Squad<\/th><th>Cliente<\/th><th>Responsável<\/th><th>Situação<\/th><th>Ações<\/th>/, "estrutura/ordem das colunas preservada — não é regra de negócio, só apresentação");
// Ações voltam a ficar lado a lado (não empilhadas) — sem coluna fixa, não há mais overlap a evitar.
assert.doesNotMatch(html, /flex-wrap/, "renderCampaigns não deve gerar nenhum estilo inline de quebra de linha nos botões");

for (const file of ["numbers-view.js", "profiles-view.js", "audit-log-view.js", "directory-view.js", "signup-authorizations-view.js", "bot-view.js"]) {
  const content = await readFile(new URL(`../src/js/ui/${file}`, import.meta.url), "utf8").catch(() => "");
  if (content) assert.doesNotMatch(content, /table-sticky-first-col/, `${file}: coluna fixa nunca foi usada aqui — confirma que não sobrou nada`);
}

const componentsCss = await readFile(new URL("../src/css/components.css", import.meta.url), "utf8");
const themeCss = await readFile(new URL("../src/css/theme.css", import.meta.url), "utf8");
assert.doesNotMatch(componentsCss, /table-sticky-first-col/, "nenhuma regra de coluna fixa deve sobrar no CSS");
assert.doesNotMatch(themeCss, /table-sticky-first-col/, "nenhum override de dark mode da coluna fixa deve sobrar");
assert.doesNotMatch(componentsCss, /position: sticky; left: 0;.*table-scroll/is, "sem position:sticky ligado a .table-scroll — a solução atual não fixa nenhuma coluna");

// ---------------------------------------------------------------------------
// CSS — mesmo breakpoint (860px) do resto do padrão mobile, indicador mais
// forte, linhas mais compactas, nunca vaza pro desktop.
// ---------------------------------------------------------------------------
const mediaMatch = componentsCss.match(/@media \(max-width: 860px\) \{([\s\S]*?)\n\}/);
assert.ok(mediaMatch, "bloco @media (max-width: 860px) precisa existir — mesmo breakpoint de sempre");
const mobileBlock = mediaMatch[1];

// Indicador ("Deslize para ver mais →") em cor de marca, não cinza neutro — precisa se destacar.
assert.match(mobileBlock, /\.table-scroll-hint \{[^}]*background: var\(--color-primary-soft\);/s, "indicador precisa usar cor de marca pra realmente chamar atenção, não um cinza que passa despercebido");

// Fade mais largo/forte que a primeira versão (28px/.14 era quase imperceptível).
assert.match(mobileBlock, /\.table-scroll-fade \{[^}]*width: 40px;/s, "fade precisa ser mais largo que a versão original (28px) pra ficar visível");
assert.match(mobileBlock, /rgb\(11 51 38 \/ \.22\)/, "opacidade do fade claro precisa ser mais forte que a original (.14)");

// Botão de navegação na borda direita (ver bloco 21 para o comportamento completo): reforço que
// não depende só do gradiente de cor, e agora também é clicável.
assert.match(mobileBlock, /\.table-scroll-nav \{/, "precisa ter um botão de navegação além do gradiente — cor sozinha é fácil de não notar");

// Linhas mais compactas no mobile — só padding vertical, mantém padding lateral e leitura.
assert.match(mobileBlock, /\.table-scroll th, \.table-scroll td \{ padding-block: 10px; \}/, "altura de linha precisa ser reduzida no mobile (padding vertical menor que os 15px do desktop)");

// Nada disso pode vazar pro desktop.
const outsideMobileBlock = componentsCss.replace(mediaMatch[0], "");
assert.doesNotMatch(outsideMobileBlock, /padding-block: 10px/, "redução de altura de linha não pode valer fora do breakpoint mobile");

console.log("Bloco 20 (padrão mobile das tabelas largas — indicador reativo, sem coluna fixa): todos os cenários passaram.");
