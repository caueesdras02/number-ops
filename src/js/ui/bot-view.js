import { escapeHtml, formatDateTimeShort, formatPhone } from "./number-presentation.js";
import { PROCESSING_STATUS_LABELS, EVENT_TYPE_LABELS, CLASSIFICATION_LABELS } from "../services/bot-service.js";

const BOT_ART = "./src/assets/number-ops-bot-logo.jpeg";
const date = formatDateTimeShort;
export const phoneLabel = (digits) => (digits && (digits.length === 12 || digits.length === 13) ? formatPhone(digits) : (digits ? escapeHtml(digits) : "—"));

const statusClass = { RECEIVED: "is-pending", MATCHED: "is-ok", LINKED_TO_INCIDENT: "is-ok", PENDING_ASSOCIATION: "is-warning", IGNORED: "is-muted", IGNORED_NOT_OWNED: "is-muted", ERROR: "is-error" };
const statusBadge = (processingStatus) => `<span class="bot-status-badge ${statusClass[processingStatus] ?? "is-muted"}">${escapeHtml(PROCESSING_STATUS_LABELS[processingStatus] ?? processingStatus)}</span>`;

// Empresa/Liveshop/Conta do Cliente vêm do próprio texto do alerta do Telegram (metadata do
// integration_event) — existem mesmo quando o telefone não é nosso e não há Número/Campanha
// cadastrados aqui. Mostrar como linha secundária evita "sumir" com uma informação que o alerta
// já trouxe, mesmo sem vínculo formal ainda.
const numberCell = (event) => {
  if (event.number) return `<button class="link-button" type="button" data-action="open-number" data-id="${event.number.id}">${formatPhone(event.number.phone)}</button>`;
  const contaCliente = event.metadata?.contaCliente;
  if (event.processingStatus === "IGNORED_NOT_OWNED") {
    return `<span class="bot-muted">Não é nosso</span>${contaCliente ? `<span class="table-secondary">Conta: ${escapeHtml(contaCliente)}</span>` : ""}`;
  }
  if (event.processingStatus === "PENDING_ASSOCIATION") {
    return `<span class="bot-muted">Não encontrado</span>${contaCliente ? `<span class="table-secondary">Conta: ${escapeHtml(contaCliente)}</span>` : ""}`;
  }
  return `<span class="bot-muted">—</span>`;
};

const campaignCell = (event) => {
  if (event.campaign) return `<button class="link-button" type="button" data-action="open-campaign" data-id="${event.campaign.id}">${escapeHtml(event.campaign.name)}</button>`;
  const liveshop = event.metadata?.liveshop;
  return `<span class="bot-muted">—</span>${liveshop ? `<span class="table-secondary">Liveshop: ${escapeHtml(liveshop)}</span>` : ""}`;
};

const incidentCell = (event) => event.incident
  ? `<button class="link-button" type="button" data-action="open-incident" data-id="${event.incident.id}">${event.incident.status === "OPEN" ? "Aberta" : "Resolvida"}</button>`
  : `<span class="bot-muted">—</span>`;

const classificationCell = (event) => event.incident?.classification
  ? escapeHtml(CLASSIFICATION_LABELS[event.incident.classification] ?? event.incident.classification)
  : `<span class="bot-muted">—</span>`;

function activityRow(event) {
  return `<tr class="${event.processingStatus === "PENDING_ASSOCIATION" ? "is-pending-row" : ""}">
    <td>${phoneLabel(event.phoneNormalized)}</td>
    <td>${numberCell(event)}</td>
    <td>${campaignCell(event)}</td>
    <td>${escapeHtml(EVENT_TYPE_LABELS[event.eventType] ?? event.eventType)}</td>
    <td>${statusBadge(event.processingStatus)}</td>
    <td>${classificationCell(event)}</td>
    <td>${incidentCell(event)}</td>
    <td class="table-actions"><button class="button button-quiet" type="button" data-action="bot-detail" data-id="${event.id}">Detalhes</button></td>
  </tr>`;
}

function metricCard(kind, label, value, hint) {
  const actionable = kind === "pending" || kind === "connectivity";
  const tag = actionable ? "button" : "div";
  const attrs = actionable ? `type="button" data-bot-metric="${kind}"` : "";
  return `<${tag} class="metric-card bot-metric-${kind}" ${attrs}><span class="metric-label">${label}</span><strong>${value}</strong>${hint ? `<span class="metric-link">${hint}</span>` : ""}</${tag}>`;
}

function pendingPanel(pendingEvents) {
  if (!pendingEvents.length) return "";
  const rows = pendingEvents.slice(0, 6).map((event) => `<li><span>${phoneLabel(event.phoneNormalized)}</span><small>${date(event.receivedAt)}</small><button class="button button-quiet" type="button" data-action="bot-detail" data-id="${event.id}">Ver</button></li>`).join("");
  return `<section class="bot-pending-panel"><div><span aria-hidden="true">!</span><div><strong>${pendingEvents.length} alerta${pendingEvents.length === 1 ? "" : "s"} sem número associado</strong><p>Estes telefones não corresponderam a nenhum número cadastrado. Revise manualmente quando possível — nenhum número é criado automaticamente.</p></div></div><ul class="bot-pending-list">${rows}</ul>${pendingEvents.length > 6 ? `<p class="bot-pending-more">+${pendingEvents.length - 6} outro${pendingEvents.length - 6 === 1 ? "" : "s"} — use o filtro de status abaixo para ver todos.</p>` : ""}</section>`;
}

export function renderBotCentral({ available, events = [], metrics, filters = {} }) {
  if (!available) {
    return `<section class="bot-polished"><div class="directory-empty"><span aria-hidden="true">◈</span><div><h3>Central indisponível neste modo</h3><p>A Central Number Ops Bot depende dos dados compartilhados do Supabase e não está disponível no modo local/offline.</p></div></div></section>`;
  }
  const lastEvent = metrics.lastEvent;
  const lastEventSummary = lastEvent
    ? `Último evento recebido em ${date(lastEvent.receivedAt)} · ${escapeHtml(EVENT_TYPE_LABELS[lastEvent.eventType] ?? lastEvent.eventType)}`
    : "Nenhum evento recebido ainda.";
  const pendingEvents = events.filter((event) => event.processingStatus === "PENDING_ASSOCIATION");
  const filtered = events.filter((event) => !filters.status || event.processingStatus === filters.status);

  return `<section class="bot-polished">
    <header class="bot-hero">
      <div>
        <p class="eyebrow">Integrações</p>
        <h2>Number Ops Bot</h2>
        <p>Recebe alertas de conectividade do grupo de infraestrutura via Telegram, associa o número e a campanha quando possível e cria/atualiza o acompanhamento correspondente em Ocorrências. Nenhuma ação operacional (status, restrição, utilização, vínculo de campanha) é feita automaticamente.</p>
        <p class="bot-last-event">${lastEventSummary}</p>
      </div>
      <img class="bot-hero-art" src="${BOT_ART}" alt="" aria-hidden="true">
    </header>

    <div class="metric-grid metric-grid-polished bot-metric-grid">
      ${metricCard("total", "Eventos recebidos", metrics.total, "")}
      ${metricCard("matched", "Processados", metrics.matched, "")}
      ${metricCard("pending", "Pendentes de associação", metrics.pending, metrics.pending ? "Ver pendentes →" : "")}
      ${metricCard("connectivity", "Ocorrências de conectividade abertas", metrics.openConnectivity, metrics.openConnectivity ? "Ver Ocorrências →" : "")}
    </div>

    ${pendingPanel(pendingEvents)}

    <div class="numbers-heading bot-activity-heading">
      <div><p class="eyebrow">Atividade</p><h3>Eventos recebidos</h3></div>
      <label class="filter-label bot-status-filter">Status<select class="input" data-bot-filter="status"><option value="">Todos</option>${Object.entries(PROCESSING_STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${filters.status === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
    </div>

    ${filtered.length ? `<div class="table-card bot-table"><div class="table-scroll"><table><thead><tr><th>Telefone</th><th>Número</th><th>Campanha</th><th>Tipo</th><th>Status</th><th>Classificação</th><th>Ocorrência</th><th></th></tr></thead><tbody>${filtered.map(activityRow).join("")}</tbody></table></div></div>` : `<div class="numbers-empty"><span>◈</span><div><h3>Nenhum evento encontrado</h3><p>${filters.status ? "Ajuste o filtro de status para ver outros eventos." : "Ainda não chegou nenhum alerta do Telegram."}</p></div></div>`}
  </section>`;
}

function timelineStep({ done, icon, title, description }) {
  return `<li class="${done ? "is-done" : "is-pending"}"><span class="detail-event-icon">${done ? "✓" : icon}</span><div><strong>${title}</strong><p>${description}</p></div></li>`;
}

function alertInfoBlock(event) {
  const { empresa, liveshop, contaCliente } = event.metadata ?? {};
  if (!empresa && !liveshop && !contaCliente) return "";
  const row = (label, value) => value ? `<li><strong>${escapeHtml(value)}</strong><span>${label}</span></li>` : "";
  return `<div class="bot-detail-note bot-alertinfo-note"><p class="table-secondary">Dados informados no alerta do Telegram (ainda não vinculados a um registro cadastrado):</p><ul class="bot-alertinfo-list">${row("Empresa", empresa)}${row("Liveshop / Campanha", liveshop)}${row("Conta do Cliente", contaCliente)}</ul></div>`;
}

function notOwnedNote(event) {
  if (event.processingStatus !== "IGNORED_NOT_OWNED") return "";
  const info = event.metadata?.notOwned;
  const line = info?.auto
    ? "Ignorado automaticamente — este telefone já havia sido classificado como não pertencente à operação."
    : `Classificado manualmente como não pertence à operação${info?.classifiedAt ? ` em ${date(info.classifiedAt)}` : ""}.`;
  const record = event.externalRecord;
  const revertedLine = record?.reverted_at ? `<p class="bot-muted">Classificação de externo revertida em ${date(record.reverted_at)} — novos alertas deste telefone voltam a ficar pendentes de associação.</p>` : "";
  return `<div class="bot-detail-note bot-notowned-note"><p>${line}</p>${revertedLine}</div>`;
}

function numberPickerRow(number) {
  const label = `${formatPhone(number.phone)}${number.identification ? ` · ${escapeHtml(number.identification)}` : ""}`;
  return `<label class="check-option link-role-row" data-relation-option><span class="link-role-check"><input type="radio" name="numberId" value="${number.id}" required><span>${label}</span></span></label>`;
}

/** Campanhas às quais este número externo JÁ está vinculado (BotService.enrich) — link direto pra
 * cada uma (mesmo data-action="open-campaign" que o resto da tela já usa). */
function existingExternalLinksNote(event) {
  const links = event.existingExternalLinks ?? [];
  if (!links.length) return "";
  const rows = links.map((link) => `<li class="derived-list-item"><span><button class="link-button" type="button" data-action="open-campaign" data-id="${link.campaignId}">${escapeHtml(link.campaignName ?? link.campaignId)}</button>${link.clientName ? ` · ${escapeHtml(link.clientName)}` : ""}</span></li>`).join("");
  return `<div class="bot-detail-note"><p>Já vinculado ${links.length > 1 ? "às campanhas" : "à campanha"}:</p><ul class="derived-list">${rows}</ul></div>`;
}

function campaignPickerRow(campaign) {
  const label = `${escapeHtml(campaign.name)}${campaign.clientName ? ` · ${escapeHtml(campaign.clientName)}` : ""}`;
  return `<label class="check-option link-role-row" data-relation-option><span class="link-role-check"><input type="radio" name="campaignId" value="${campaign.id}" required><span>${label}</span></span></label>`;
}

/** Vincula um número JÁ classificado como externo (IGNORED_NOT_OWNED) a uma Campanha existente —
 * nunca cria Campanha nova. Mesmo padrão visual/de busca de pendingActions/numberPickerRow, só
 * trocando "número" por "campanha ativa"; busca pré-preenchida com o Liveshop do alerta pra
 * facilitar achar uma campanha já existente com nome parecido (bot-controller.js reaproveita o
 * mesmo filtro data-link-search já usado no form de associar número). */
function notOwnedLinkActions(event, { canModify, availableCampaigns }) {
  if (event.processingStatus !== "IGNORED_NOT_OWNED" || !canModify) return "";
  const rows = availableCampaigns.map(campaignPickerRow).join("");
  const prefill = event.metadata?.liveshop || "";
  return `<div class="bot-detail-actions">
    <details class="bot-associate-details">
      <summary class="button button-primary">Vincular à campanha</summary>
      <form class="number-form bot-link-campaign-form" data-bot-link-campaign-form data-id="${event.id}">
        <label class="form-full">Buscar campanha já cadastrada<input class="input" type="search" data-link-search value="${escapeHtml(prefill)}" placeholder="Buscar por nome da campanha" autocomplete="off"></label>
        <fieldset class="link-role-list" data-link-options>${rows || '<p class="table-secondary">Nenhuma campanha ativa disponível para vincular.</p>'}</fieldset>
        <p class="relation-empty-hint" data-link-empty hidden>Nenhuma campanha encontrada.</p>
        <small class="form-hint">Vincula este número (que não é nosso) à campanha e ao cliente escolhidos — nenhuma campanha nova é criada aqui.</small>
        <div class="form-actions"><button class="button button-primary" type="submit">Vincular</button></div>
      </form>
    </details>
  </div>`;
}

function pendingActions(event, { canModify, availableNumbers }) {
  if (event.processingStatus !== "PENDING_ASSOCIATION" || !canModify) return "";
  const rows = availableNumbers.map(numberPickerRow).join("");
  return `<div class="bot-detail-actions">
    <details class="bot-associate-details">
      <summary class="button button-primary">Associar número</summary>
      <form class="number-form bot-associate-form" data-bot-associate-form data-id="${event.id}">
        <label class="form-full">Buscar número já cadastrado<input class="input" type="search" data-link-search placeholder="Buscar por telefone ou identificação" autocomplete="off"></label>
        <fieldset class="link-role-list" data-link-options>${rows || '<p class="table-secondary">Nenhum número cadastrado disponível.</p>'}</fieldset>
        <p class="relation-empty-hint" data-link-empty hidden>Nenhum número encontrado.</p>
        <small class="form-hint">Somente números já cadastrados podem ser selecionados — nenhum número é criado automaticamente.</small>
        <div class="form-actions"><button class="button button-primary" type="submit">Confirmar associação</button></div>
      </form>
    </details>
    <button class="button button-quiet" type="button" data-action="bot-mark-not-owned" data-id="${event.id}">Não pertence à operação</button>
  </div>`;
}

function revertAction(event, { canModify }) {
  const record = event.externalRecord;
  if (event.processingStatus !== "IGNORED_NOT_OWNED" || !canModify || !record || record.reverted_at) return "";
  return `<div class="bot-detail-actions"><button class="button button-quiet" type="button" data-action="bot-revert-not-owned" data-external-id="${record.id}">Reverter classificação de externo</button></div>`;
}

export function renderBotEventDetail(event, { canModify = false, availableNumbers = [], availableCampaigns = [] } = {}) {
  const campaignNote = !event.numberId ? "Não aplicável — número não foi encontrado." : event.metadata?.campaignMatch === "ambiguous" ? "Ambíguo entre mais de uma campanha ativa — não associado automaticamente." : event.metadata?.campaignMatch === "none" ? "Número sem campanha ativa vinculada." : "Ainda não associada.";
  const steps = [
    timelineStep({ done: true, icon: "1", title: "Recebido", description: `Evento recebido via Telegram em ${date(event.receivedAt)}.` }),
    timelineStep({ done: event.eventType !== "UNKNOWN", icon: "2", title: "Interpretado", description: event.eventType !== "UNKNOWN" ? `Reconhecido como ${escapeHtml(EVENT_TYPE_LABELS[event.eventType] ?? event.eventType)}.` : (event.errorMessage ? escapeHtml(event.errorMessage) : "Mensagem não reconhecida como alerta de conectividade.") }),
    timelineStep({ done: Boolean(event.numberId) || event.processingStatus === "IGNORED_NOT_OWNED", icon: "3", title: "Número", description: event.numberId ? `Associado a ${formatPhone(event.number?.phone ?? event.phoneNormalized)}.` : event.processingStatus === "IGNORED_NOT_OWNED" ? `${phoneLabel(event.phoneNormalized)} não pertence à operação.` : (event.phoneNormalized ? `Nenhum número encontrado para ${phoneLabel(event.phoneNormalized)}.` : "Telefone não identificado no texto do alerta.") }),
    timelineStep({ done: Boolean(event.campaignId), icon: "4", title: "Campanha", description: event.campaignId ? `Associada a ${escapeHtml(event.campaign?.name ?? event.campaignId)}.` : campaignNote }),
    timelineStep({ done: Boolean(event.incident?.classification), icon: "5", title: "Classificação", description: event.incident?.classification ? escapeHtml(CLASSIFICATION_LABELS[event.incident.classification] ?? event.incident.classification) : "Ainda não classificado." }),
    timelineStep({ done: Boolean(event.linkedIncidentId), icon: "6", title: "Ocorrência", description: event.linkedIncidentId ? "Acompanhamento criado/atualizado em Ocorrências." : "Nenhum acompanhamento vinculado." }),
  ].join("");

  const links = [];
  if (event.numberId) links.push(`<button class="button button-quiet" type="button" data-action="open-number" data-id="${event.numberId}">Ver número</button>`);
  if (event.campaignId) links.push(`<button class="button button-quiet" type="button" data-action="open-campaign" data-id="${event.campaignId}">Ver campanha</button>`);
  if (event.linkedIncidentId) links.push(`<button class="button button-quiet" type="button" data-action="open-incident" data-id="${event.linkedIncidentId}">Ver ocorrência</button>`);

  return `<div class="modal-backdrop" data-bot-modal><article class="modal-card bot-detail-modal" role="dialog" aria-modal="true" aria-labelledby="bot-detail-title"><div class="modal-header"><div><p class="eyebrow">Evento Telegram</p><h2 id="bot-detail-title">${escapeHtml(EVENT_TYPE_LABELS[event.eventType] ?? event.eventType)}</h2><p>${phoneLabel(event.phoneNormalized)} · ${date(event.receivedAt)}</p></div><button class="icon-button" type="button" data-action="close-bot-detail" aria-label="Fechar">×</button></div><ol class="detail-timeline bot-timeline">${steps}</ol>${alertInfoBlock(event)}${notOwnedNote(event)}${existingExternalLinksNote(event)}${links.length ? `<div class="form-actions bot-detail-links">${links.join("")}</div>` : ""}${pendingActions(event, { canModify, availableNumbers })}${notOwnedLinkActions(event, { canModify, availableCampaigns })}${revertAction(event, { canModify })}</article></div>`;
}
