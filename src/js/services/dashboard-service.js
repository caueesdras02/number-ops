import { NUMBER_STATUSES } from "../config/constants.js";
import { getUtilization, UTILIZATION } from "../models/number.js";

export class DashboardService {
  constructor(numbersService) { this.numbersService = numbersService; }
  getData() {
    const s = this.numbersService.state, active = s.numbers.filter((n) => !n.archivedAt), name = (items, id) => items.find((item) => item.id === id)?.name ?? "Não definido";
    const links = s.numberCampaignLinks ?? [];
    const hasActiveLink = (numberId) => links.some((link) => link.numberId === numberId && !link.endedAt);
    const utilization = (n) => getUtilization(n, hasActiveLink(n.id));
    const countBy = (items, key, labels = null) => Object.entries(items.reduce((a, item) => { const k = labels ? labels(item) : item[key]; a[k] = (a[k] || 0) + 1; return a; }, {})).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    const related = (field, entities) => entities.map((e) => ({ label: e.name, count: active.filter((n) => (n[field] || []).includes(e.id)).length })).filter((x) => x.count).sort((a, b) => b.count - a.count);
    const open = s.incidents.filter((i) => i.status === "OPEN");
    // Indicador discreto do Bot: só ocorrências CONNECTIVITY abertas criadas pela
    // integração (Telegram) — nenhuma escrita/regra operacional aqui, só leitura.
    const botConnectivity = open.filter((i) => i.classification === "CONNECTIVITY" && i.origin === "TELEGRAM_BOT");
    // Tendência dos últimos 7 dias — só quedas (CONNECTIVITY), contadas por dia de abertura
    // (createdAt). Não precisa de tabela/consulta nova: os dados já estão carregados em
    // s.incidents. Fuso do navegador do usuário (mesma convenção do resto da tela de Ocorrências).
    const connectivityIncidents = s.incidents.filter((i) => i.classification === "CONNECTIVITY");
    const dayKey = (iso) => new Date(iso).toLocaleDateString("sv-SE"); // yyyy-mm-dd estável, sem depender de locale pro parsing
    const today = new Date();
    const last7Days = Array.from({ length: 7 }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() - (6 - i)); return d; });
    const countsByDay = connectivityIncidents.reduce((acc, incident) => { const key = dayKey(incident.createdAt); acc[key] = (acc[key] || 0) + 1; return acc; }, {});
    // Só o dia da semana (3 letras, sem ponto) — cabe em qualquer largura sem cortar, e ajuda a
    // notar padrão ("toda segunda cai mais") melhor do que só a data. A data completa fica
    // disponível no title="" de cada barra (ver dashboard-view.js), pra quem passar o mouse/tocar.
    const trendDays = last7Days.map((d) => {
      const key = dayKey(d.toISOString());
      const weekday = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
      return { label: weekday.charAt(0).toUpperCase() + weekday.slice(1), fullDate: d.toLocaleDateString("pt-BR"), count: countsByDay[key] || 0 };
    });
    const trendMax = Math.max(1, ...trendDays.map((d) => d.count));
    return {
      metrics: {
        total: active.length,
        available: active.filter((n) => utilization(n) === UTILIZATION.AVAILABLE).length,
        inUse: active.filter((n) => utilization(n) === UTILIZATION.IN_USE).length,
        warming: active.filter((n) => n.status === NUMBER_STATUSES.WARMING).length,
        review: active.filter((n) => n.status === NUMBER_STATUSES.UNDER_REVIEW).length,
        blocked: active.filter((n) => n.status === NUMBER_STATUSES.BLOCKED).length,
        open: open.length,
      },
      status: countBy(active, "status"),
      responsibles: countBy(active, "responsibleId", (n) => name(s.responsibles, n.responsibleId)),
      locations: countBy(active, "locationId", (n) => name(s.locations, n.locationId)),
      clients: related("clientIds", s.clients),
      groups: related("groupIds", s.groups),
      attention: { blocked: active.filter((n) => n.status === NUMBER_STATUSES.BLOCKED), review: active.filter((n) => n.status === NUMBER_STATUSES.UNDER_REVIEW), open, botConnectivity },
      trend: { days: trendDays, max: trendMax, total: trendDays.reduce((sum, d) => sum + d.count, 0) },
      recent: {
        history: [...s.historyEvents].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 6),
        incidents: [...s.incidents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6),
      },
      numbers: s.numbers,
    };
  }
}
