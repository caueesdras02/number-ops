// Só os títulos das páginas (usados no <h1> do topbar) — cada rota real tem seu próprio
// controller/view hoje; isto não é mais um placeholder de rota (era, numa fase bem inicial do
// projeto, antes de Números/Campanhas/Ocorrências existirem de verdade).
const titles = Object.freeze({
  dashboard: "Visão geral",
  numbers: "Números",
  campaigns: "Campanhas",
  profiles: "Usuários",
  clients: "Clientes",
  groups: "Squads",
  responsibles: "Colaboradores",
  locations: "Localizações",
  incidents: "Ocorrências",
  history: "Histórico",
  activity: "Registro de atividades",
  guide: "Boas práticas",
  backup: "Dados e Backup",
  bot: "Number Ops Bot",
});

export function getViewTitle(viewName) { return titles[viewName] ?? titles.dashboard; }
