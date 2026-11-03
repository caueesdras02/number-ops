// Portal do cliente — tela única, somente leitura, do acesso CLIENT (e da pré-visualização
// "ver como o cliente vê" de MASTER/ADMIN). Só renderiza o que buildPortalView() entregou.
import { escapeHtml, formatPhone, formatDateTime, formatDate, statusLabels } from "./number-presentation.js";
import { CHIP_HEALTH_LABELS } from "../services/client-portal-service.js";

const healthClass = { CRITICAL: "is-error", ATTENTION: "is-warning", OK: "is-ok", INACTIVE: "is-muted" };
const phone = (value) => (value && (value.length === 12 || value.length === 13) ? formatPhone(value) : escapeHtml(value || "—"));

const healthBadge = (health) => `<span class="bot-status-badge ${healthClass[health.level]}" title="${escapeHtml(health.reasons.join(" · "))}">${CHIP_HEALTH_LABELS[health.level]}</span>${health.reasons.length ? `<span class="table-secondary">${escapeHtml(health.reasons.join(" · "))}</span>` : ""}`;

const metric = (label, value, tone = "") => `<article class="portal-metric ${tone}"><strong>${value}</strong><span>${escapeHtml(label)}</span></article>`;

function chipCampaignCell(chip) {
  if (chip.currentLinks.length) return chip.currentLinks.map((link) => `<strong>${escapeHtml(link.campaignName)}</strong><span class="table-secondary">${escapeHtml(link.roleLabel)} · desde ${formatDate(link.startedAt)}</span>`).join("");
  if (chip.lastCampaignName) return `<span class="table-secondary">Sem campanha agora · última: ${escapeHtml(chip.lastCampaignName)}${chip.lastLinkEndedAt ? ` (até ${formatDate(chip.lastLinkEndedAt)})` : ""}</span>`;
  return '<span class="table-secondary">—</span>';
}

function chipsTable(chips) {
  if (!chips.length) return '<p class="portal-empty">Nenhum chip vinculado às suas campanhas até agora.</p>';
  const rows = chips.map((chip) => `<tr>
    <td><strong>${phone(chip.phone)}</strong><span class="table-secondary">${escapeHtml(chip.identification || "Sem identificação")}</span></td>
    <td>${healthBadge(chip.health)}</td>
    <td><span class="status-badge status-${String(chip.status).toLowerCase()}">${escapeHtml(statusLabels[chip.status] ?? chip.status)}</span></td>
    <td>${escapeHtml(chip.location || "Não informada")}</td>
    <td>${chipCampaignCell(chip)}</td>
    <td class="portal-number">${Number(chip.groupCount) || 0}</td>
    <td class="portal-number">${chip.outages30d}</td>
  </tr>`).join("");
  return `<div class="table-card"><div class="table-scroll"><table class="portal-table"><thead><tr><th>Chip</th><th>Saúde</th><th>Status</th><th>Localização</th><th>Campanha</th><th>Grupos</th><th>Quedas (30 dias)</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function campaignsSection(campaigns) {
  if (!campaigns.length) return '<p class="portal-empty">Nenhuma campanha registrada ainda.</p>';
  return `<div class="portal-campaigns">${campaigns.map((campaign) => `<article class="portal-campaign ${campaign.status === "CLOSED" ? "is-closed" : ""}">
    <header><div><strong>${escapeHtml(campaign.name)}</strong><span class="table-secondary">Início ${formatDate(campaign.startedAt)}${campaign.endedAt ? ` · Encerrada em ${formatDate(campaign.endedAt)}` : ""}</span></div><span class="bot-status-badge ${campaign.status === "CLOSED" ? "is-muted" : "is-ok"}">${escapeHtml(campaign.stageLabel)}</span></header>
    ${campaign.chipsNow.length ? `<ul>${campaign.chipsNow.map((chip) => `<li><span>${phone(chip.phone)}${chip.identification ? ` · ${escapeHtml(chip.identification)}` : ""}</span><span class="bot-status-badge ${healthClass[chip.health.level]}">${CHIP_HEALTH_LABELS[chip.health.level]}</span></li>`).join("")}</ul>` : `<p class="table-secondary">${campaign.status === "CLOSED" ? "Campanha encerrada." : "Nenhum chip vinculado no momento."}</p>`}
  </article>`).join("")}</div>`;
}

function outagesTable(outages) {
  if (!outages.length) return '<p class="portal-empty">Nenhuma queda registrada nos chips das suas campanhas.</p>';
  const rows = outages.slice(0, 100).map((outage) => `<tr>
    <td>${formatDateTime(outage.createdAt)}</td>
    <td><strong>${phone(outage.phone)}</strong><span class="table-secondary">${escapeHtml(outage.identification || "")}</span></td>
    <td>${escapeHtml(outage.campaignName)}</td>
    <td><span class="bot-status-badge ${outage.status === "OPEN" ? "is-error" : "is-ok"}">${outage.status === "OPEN" ? "Em aberto" : "Resolvida"}</span></td>
    <td>${outage.resolvedAt ? formatDateTime(outage.resolvedAt) : "—"}</td>
  </tr>`).join("");
  return `<div class="table-card"><div class="table-scroll"><table class="portal-table"><thead><tr><th>Quando</th><th>Chip</th><th>Campanha</th><th>Situação</th><th>Resolvida em</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function externalSection(externalChips) {
  if (!externalChips.length) return "";
  const rows = externalChips.map((chip) => `<tr><td><strong>${phone(chip.phone)}</strong></td><td>${escapeHtml(chip.campaignName)}</td><td>${formatDate(chip.linkedAt)}</td><td class="portal-number">${chip.alerts7d}</td><td>${chip.lastAlertAt ? formatDateTime(chip.lastAlertAt) : "—"}</td></tr>`).join("");
  return `<section class="portal-section"><div class="portal-section-heading"><div><p class="eyebrow">Monitorados pelo alerta</p><h3>Outros chips acompanhados</h3></div></div><p class="table-secondary">Chips acompanhados apenas pelos alertas de desconexão — sem status, localização ou grupos registrados.</p><div class="table-card"><div class="table-scroll"><table class="portal-table"><thead><tr><th>Chip</th><th>Campanha</th><th>Acompanhado desde</th><th>Alertas (7 dias)</th><th>Último alerta</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>`;
}

export function renderClientPortal(view, { preview = false } = {}) {
  const { summary } = view;
  return `<section class="client-portal">
    ${preview ? `<div class="portal-preview-note" role="note"><strong>Pré-visualização</strong> — é exatamente isto que um acesso de cliente de <strong>${escapeHtml(view.client?.name ?? "")}</strong> enxerga. Nada aqui pode ser editado.</div>` : ""}
    <header class="portal-heading"><div><p class="eyebrow">Acompanhamento da operação</p><h2>${escapeHtml(view.client?.name ?? "Cliente")}</h2><p>Situação dos seus chips nas campanhas. Atualizado em ${formatDateTime(view.generatedAt)}.</p></div><button class="button button-quiet" type="button" data-action="portal-refresh">Atualizar</button></header>
    <div class="portal-metrics">
      ${metric("Chips acompanhados", summary.chips)}
      ${metric("Em campanha agora", summary.inCampaignNow)}
      ${metric("Precisam de atenção", summary.needAttention, summary.needAttention ? "is-warning" : "")}
      ${metric("Quedas em aberto", summary.openOutages, summary.openOutages ? "is-error" : "")}
      ${metric("Quedas nos últimos 7 dias", summary.outages7d)}
    </div>
    <section class="portal-section"><div class="portal-section-heading"><div><p class="eyebrow">Chips</p><h3>Saúde e localização dos chips</h3></div></div>${chipsTable(view.chips)}</section>
    <section class="portal-section"><div class="portal-section-heading"><div><p class="eyebrow">Campanhas</p><h3>Suas campanhas</h3></div></div>${campaignsSection(view.campaigns)}</section>
    <section class="portal-section"><div class="portal-section-heading"><div><p class="eyebrow">Quedas</p><h3>Histórico de quedas</h3></div></div>${outagesTable(view.outages)}</section>
    ${externalSection(view.externalChips)}
  </section>`;
}

export function renderClientPortalError(message) {
  return `<section class="directory-empty"><div><h2>Acompanhamento indisponível</h2><p>${escapeHtml(message)}</p><button class="button button-quiet" type="button" data-action="portal-refresh">Tentar novamente</button></div></section>`;
}
