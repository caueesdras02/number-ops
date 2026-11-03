import assert from "node:assert/strict";
import { setPendingListFilter, takePendingListFilter } from "../src/js/models/pending-list-filter.js";
import { renderDashboard } from "../src/js/ui/dashboard-view.js";

// ---------------------------------------------------------------------------
// BLOCO 29 — clicar num card de KPI do Dashboard (Disponíveis/Em uso/Em
// aquecimento/Em análise/Bloqueados/Ocorrências abertas) já leva o filtro
// correspondente pronto pra Números/Ocorrências, em vez de sempre cair na
// lista genérica sem filtro nenhum.
// ---------------------------------------------------------------------------

// 1) pending-list-filter: take() consome E limpa — nunca "sobra" pra uma navegação futura
{
  assert.equal(takePendingListFilter("numbers"), null, "nada pendente por padrão");
  setPendingListFilter("numbers", { status: "BLOCKED" });
  assert.deepEqual(takePendingListFilter("numbers"), { status: "BLOCKED" });
  assert.equal(takePendingListFilter("numbers"), null, "segunda leitura já vem vazia — consumido só uma vez");
}

// 2) take() só devolve o filtro pra QUEM ele foi destinado (view certa) — nunca vaza pra outra tela
{
  setPendingListFilter("numbers", { status: "BLOCKED" });
  assert.equal(takePendingListFilter("incidents"), null, "filtro de \"numbers\" não vaza pra \"incidents\"");
  assert.deepEqual(takePendingListFilter("numbers"), { status: "BLOCKED" }, "continua disponível pra quem era de verdade o destino");
}

// 3) renderDashboard: cada card de KPI carrega o filtro certo (ou nenhum, pro Total)
{
  const data = {
    metrics: { total: 22, available: 7, inUse: 7, warming: 0, review: 0, blocked: 1, open: 0 },
    status: [], attention: { blocked: [], review: [], open: [], botConnectivity: [] },
    trend: { days: [], max: 1, total: 0 },
    responsibles: [], locations: [], clients: [], groups: [], recent: { history: [], incidents: [] }, numbers: [],
  };
  const html = renderDashboard(data);
  // data-filter carrega JSON escapado (aspas viram &quot; no HTML cru) — decodificado de volta
  // pra objeto de verdade pelo navegador (dataset) e pelo JSON.parse do controller.
  const filterOf = (kind) => {
    const match = html.match(new RegExp(`metric-${kind}"[^>]*data-filter='([^']*)'`));
    return match ? JSON.parse(match[1].replace(/&quot;/g, '"')) : null;
  };
  assert.doesNotMatch(html, /metric-total"[^>]*data-filter/, "\"Total de números\" nunca leva filtro — mostra tudo, como sempre");
  assert.deepEqual(filterOf("available"), { utilization: "AVAILABLE" });
  assert.deepEqual(filterOf("inuse"), { utilization: "IN_USE" });
  assert.deepEqual(filterOf("warming"), { status: "WARMING" });
  assert.deepEqual(filterOf("review"), { status: "UNDER_REVIEW" });
  assert.deepEqual(filterOf("blocked"), { status: "BLOCKED" });
  assert.deepEqual(filterOf("incidents"), { status: "OPEN" });
}

console.log("Bloco 29 (Dashboard: cliques nos cards já levam o filtro certo): todos os cenários passaram.");
