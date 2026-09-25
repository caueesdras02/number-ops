import { displayTerminology, escapeHtml, formatDateTimeShort } from "./number-presentation.js";

const labels = { ACTIVE: "Ativo", WARMING: "Em aquecimento", UNDER_REVIEW: "Em análise", BLOCKED: "Bloqueado", INACTIVE: "Inativo", OPEN: "Aberta", RESOLVED: "Resolvida" };
const icons = { total: "⌘", available: "✓", inuse: "◆", warming: "◌", review: "!", blocked: "×", incidents: "↗", ACTIVE: "✓", WARMING: "◌", UNDER_REVIEW: "!", BLOCKED: "×", INACTIVE: "−" };
const date = (v) => formatDateTimeShort(v, "Sem data");
const phone = (numbers, id) => numbers.find((n) => n.id === id)?.phone || "Número não localizado";
const empty = (title, text) => `<div class="dash-empty"><span>✓</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div></div>`;

const statuses = (items) => {
  const counts = Object.fromEntries(items.map((x) => [x.label, x.count]));
  const order = ["ACTIVE", "WARMING", "UNDER_REVIEW", "BLOCKED", "INACTIVE"];
  const max = Math.max(1, ...Object.values(counts));
  return order.map((key) => ({ key, count: counts[key] || 0, value: Math.round(((counts[key] || 0) / max) * 100) }));
};

const ranking = (title, eyebrow, items, emptyText) => `<article class="dash-panel dash-ranking"><div class="dash-panel-heading"><div><p class="dash-kicker">${escapeHtml(eyebrow)}</p><h3>${escapeHtml(title)}</h3></div></div>${items.length ? `<ol>${items.slice(0, 5).map((item, index) => `<li><span class="dash-rank">${index + 1}</span><span class="dash-rank-label">${escapeHtml(item.label)}</span><strong>${item.count}</strong></li>`).join("")}</ol>` : empty("Sem associações", emptyText)}</article>`;

const compactList = (title, kicker, items, emptyTitle, emptyText) => `<article class="dash-panel dash-distribution"><div class="dash-panel-heading"><div><p class="dash-kicker">${kicker}</p><h3>${title}</h3></div></div>${items.length ? `<div class="dash-compact-list">${items.slice(0, 6).map((item) => `<div><span>${escapeHtml(item.label)}</span><b>${item.count}</b></div>`).join("")}</div>` : empty(emptyTitle, emptyText)}</article>`;

/** Tendência dos últimos 7 dias (só quedas/CONNECTIVITY) — dados já carregados no state, sem
 * consulta nova nenhuma (ver DashboardService). Barras verticais, mais fácil de ler em sequência
 * cronológica do que linhas horizontais (que já são usadas pra Distribuição por status). */
const trendPanel = (trend) => `<article class="dash-panel dash-trend"><div class="dash-panel-heading"><div><p class="dash-kicker">Tendência</p><h3>Quedas nos últimos 7 dias</h3></div><span class="dash-panel-note">${trend.total} no período</span></div>${trend.total ? `<div class="dash-trend-bars">${trend.days.map((day) => `<div class="dash-trend-col" title="${escapeHtml(day.fullDate)}: ${day.count} queda${day.count === 1 ? "" : "s"}"><span class="dash-trend-count">${day.count || ""}</span><div class="dash-trend-track" aria-label="${escapeHtml(day.fullDate)}: ${day.count}"><i style="height:${Math.round((day.count / trend.max) * 100)}%"></i></div><span class="dash-trend-label">${escapeHtml(day.label)}</span></div>`).join("")}</div>` : empty("Sem quedas no período", "Alertas de conectividade dos últimos 7 dias aparecerão aqui.")}</article>`;

export function renderDashboard(data) {
  const m = data.metrics;
  // 5º item (filter) é o filtro que o card já deixa aplicado ao navegar (ver
  // dashboard-controller.js + models/pending-list-filter.js) — null pra "Total" (mostra tudo,
  // sem filtro, como já era). Chaves/valores batendo exatamente com os filtros que
  // numbers-view.js/incidents-view.js já aceitam (data-filter="status"/"utilization").
  const kpis = [
    ["total", "Total de números", m.total, "numbers", null],
    ["available", "Disponíveis", m.available, "numbers", { utilization: "AVAILABLE" }],
    ["inuse", "Em uso", m.inUse, "numbers", { utilization: "IN_USE" }],
    ["warming", "Em aquecimento", m.warming, "numbers", { status: "WARMING" }],
    ["review", "Em análise", m.review, "numbers", { status: "UNDER_REVIEW" }],
    ["blocked", "Bloqueados", m.blocked, "numbers", { status: "BLOCKED" }],
    ["incidents", "Ocorrências abertas", m.open, "incidents", { status: "OPEN" }],
  ];
  const attention = [
    ["blocked", "Bloqueados", data.attention.blocked, "numbers"],
    ["review", "Em análise", data.attention.review, "numbers"],
    ["incidents", "Ocorrências abertas", data.attention.open, "incidents"],
  ];
  return `<section class="dashboard dashboard-polished"><div class="dashboard-intro"><div><p class="eyebrow">Visão operacional</p><h2>Saúde da operação</h2><p>Acompanhe disponibilidade, utilização, pontos de atenção e atividade recente a partir dos dados cadastrados.</p></div><span class="dash-live"><i></i> Dados compartilhados atualizados</span></div>
  <div class="metric-grid metric-grid-polished">${kpis.map(([kind, label, value, target, filter]) => `<button type="button" class="metric-card metric-${kind}" data-target="${target}"${filter ? ` data-filter='${escapeHtml(JSON.stringify(filter))}'` : ""}><span class="metric-icon" aria-hidden="true">${icons[kind]}</span><span class="metric-label">${escapeHtml(label)}</span><strong data-kpi-value="${value}">0</strong><span class="metric-link">Ver ${target === "numbers" ? "números" : "ocorrências"} <b>→</b></span></button>`).join("")}</div>
  <div class="dashboard-primary-grid"><article class="dash-panel dash-status-panel"><div class="dash-panel-heading"><div><p class="dash-kicker">Panorama</p><h3>Distribuição por status</h3></div><span class="dash-panel-note">Números não arquivados</span></div><div class="dash-status-list">${statuses(data.status).map((item) => `<div class="dash-status-row dash-status-${item.key.toLowerCase()}"><div><span class="dash-status-icon">${icons[item.key]}</span><span>${labels[item.key]}</span></div><strong>${item.count}</strong><div class="dash-progress" aria-label="${labels[item.key]}: ${item.count}"><i style="--bar-value:${item.value}%"></i></div></div>`).join("")}</div></article>
  <article class="dash-panel dash-attention"><div class="dash-panel-heading"><div><p class="dash-kicker">Prioridade</p><h3>Atenção necessária</h3></div><span class="attention-count">${data.attention.blocked.length + data.attention.review.length + data.attention.open.length}</span></div><div class="attention-list">${attention.map(([kind, title, items, target]) => items.length ? `<section class="attention-group attention-${kind}"><div class="attention-group-heading"><span>${icons[kind]}</span><strong>${title}</strong><b>${items.length}</b>${kind === "incidents" && data.attention.botConnectivity.length ? `<button type="button" class="attention-bot-hint" data-target="bot" title="Ocorrências de conectividade abertas pela integração com o Telegram">◈ ${data.attention.botConnectivity.length} via Bot</button>` : ""}</div>${items.slice(0, 3).map((item) => `<button type="button" data-target="${target}" class="attention-item"><span>${escapeHtml(kind === "incidents" ? item.title : phone(data.numbers, item.id))}</span><small>${escapeHtml(kind === "incidents" ? phone(data.numbers, item.numberId) : labels[item.status])}</small><b>→</b></button>`).join("")}</section>` : "").join("") || empty("Operação sob controle", "Não há números bloqueados, em análise ou ocorrências abertas.")}</div></article></div>
  ${trendPanel(data.trend)}
  <div class="dashboard-secondary-grid">${compactList("Números por colaborador", "Cobertura", data.responsibles, "Sem distribuição", "Defina responsáveis nos números para acompanhar esta visão.")}${compactList("Números por localização", "Alocação", data.locations, "Sem localizações", "Defina localizações nos números para acompanhar esta visão.")}${ranking("Clientes com mais números", "Relacionamentos", data.clients, "Associe clientes aos números para visualizar o ranking.")}${ranking("Squads com mais números", "Relacionamentos", data.groups, "Associe squads aos números para visualizar o ranking.")}</div>
  <div class="dashboard-activity-grid"><article class="dash-panel dash-timeline-panel"><div class="dash-panel-heading"><div><p class="dash-kicker">Rastreabilidade</p><h3>Atividade recente</h3></div><a href="#history">Ver histórico</a></div>${data.recent.history.length ? `<ol class="dash-timeline">${data.recent.history.map((event) => `<li><span class="timeline-dot timeline-${event.type.includes("INCIDENT") ? "incident" : "number"}"></span><div><strong>${escapeHtml(displayTerminology(event.description))}</strong><small>${escapeHtml(phone(data.numbers, event.numberId))} · ${date(event.occurredAt)}</small></div></li>`).join("")}</ol>` : empty("Sem eventos recentes", "As alterações importantes aparecerão aqui.")}</article>
  <article class="dash-panel dash-recent-incidents"><div class="dash-panel-heading"><div><p class="dash-kicker">Acompanhamento</p><h3>Ocorrências recentes</h3></div><a href="#incidents">Abrir ocorrências</a></div>${data.recent.incidents.length ? `<div class="dash-incident-list">${data.recent.incidents.map((incident) => `<div><span class="incident-status incident-${incident.status.toLowerCase()}">${labels[incident.status] || escapeHtml(incident.status)}</span><strong>${escapeHtml(incident.title)}</strong><small>${escapeHtml(phone(data.numbers, incident.numberId))} · ${date(incident.updatedAt)}</small></div>`).join("")}</div>` : empty("Nenhuma ocorrência", "Ocorrências registradas aparecerão nesta área.")}</article></div></section>`;
}
