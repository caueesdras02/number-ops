import { isAvailableForOperation } from "../models/number.js";
import { escapeHtml, formatPhone, nameFor, statusLabels } from "./number-presentation.js";

function renderAssociationList(ids, items, emptyMessage) {
  const associations = ids.map((id) => nameFor(items, id, null)).filter(Boolean);
  if (!associations.length) return `<p class="association-empty">${emptyMessage}</p>`;
  return `<ul class="association-list">${associations.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>`;
}

export function renderNumberDetailView({ number, locations, responsibles, clients, groups }) {
  const available = isAvailableForOperation(number);
  return `
    <section class="number-detail-page">
      <button class="back-link" type="button" data-action="back-to-list">← Voltar para Números</button>
      <div class="detail-heading">
        <div>
          <p class="eyebrow">Detalhes do número</p>
          <h2>${formatPhone(number.phone)}</h2>
          <p>${escapeHtml(number.identification || "Sem identificação")}</p>
        </div>
        <div class="detail-status"><span class="status-badge status-${number.status.toLowerCase()}">${statusLabels[number.status]}</span>${number.archivedAt ? '<span class="archive-label">Arquivado</span>' : ""}</div>
      </div>
      <div class="detail-grid">
        <article class="detail-card"><span>Disponibilidade</span><strong class="availability ${available ? "is-available" : "is-unavailable"}">${available ? "Disponível para operação" : "Indisponível para operação"}</strong></article>
        <article class="detail-card"><span>Localização</span><strong>${escapeHtml(nameFor(locations, number.locationId))}</strong></article>
        <article class="detail-card"><span>Responsável</span><strong>${escapeHtml(nameFor(responsibles, number.responsibleId))}</strong></article>
        <article class="detail-card detail-card-wide"><span>Observações</span><p>${escapeHtml(number.notes || "Nenhuma observação registrada.")}</p></article>
      </div>
      <div class="association-grid">
        <article class="association-card"><h3>Clientes</h3>${renderAssociationList(number.clientIds ?? [], clients, "Nenhum cliente associado a este número.")}</article>
        <article class="association-card"><h3>Grupos</h3>${renderAssociationList(number.groupIds ?? [], groups, "Nenhum grupo associado a este número.")}</article>
      </div>
    </section>`;
}
