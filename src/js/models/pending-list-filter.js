// "Caixa de correio" transitória (só memória, nunca persistida) pra levar um filtro pronto do
// Dashboard pra Números/Ocorrências ao clicar num card de KPI — mesmo padrão de
// pending-campaign-prefill.js. set() no clique de origem, take() consome E limpa no destino
// (nunca fica pendurado pra uma navegação futura sem relação com isso). `view` evita que um
// filtro destinado a "numbers" seja acidentalmente consumido por "incidents".
let pending = null;

export function setPendingListFilter(view, filters) {
  pending = { view, filters };
}

export function takePendingListFilter(view) {
  if (!pending || pending.view !== view) return null;
  const filters = pending.filters;
  pending = null;
  return filters;
}
