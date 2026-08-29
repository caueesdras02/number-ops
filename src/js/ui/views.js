const views = Object.freeze({
  dashboard: { title: "Visão geral", description: "A base visual está pronta. Os indicadores operacionais serão incluídos quando a gestão de números estiver implementada." },
  numbers: { title: "Números", description: "A área de cadastro, listagem, edição e arquivamento será construída nas próximas fases." },
  clients: { title: "Clientes", description: "" }, groups: { title: "Grupos", description: "" }, responsibles: { title: "Colaboradores", description: "" },
  incidents: { title: "Ocorrências", description: "O modelo de ocorrências já está definido. O registro e a resolução serão implementados em uma etapa posterior." },
  guide: { title: "Boas práticas", description: "Esta área reunirá orientações operacionais organizadas para consulta da equipe." },
});

export function renderView(viewName) {
  const view = views[viewName] ?? views.dashboard;
  return `<article class="placeholder-card"><h2>${view.title}</h2><p>${view.description}</p><ul class="foundation-list"><li>Layout responsivo e navegação inicial</li><li>Modelos de dados definidos sem dados reais</li><li>Persistência local preparada e isolada da interface</li></ul></article>`;
}

export function getViewTitle(viewName) { return (views[viewName] ?? views.dashboard).title; }
