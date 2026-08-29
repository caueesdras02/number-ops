import { NUMBER_STATUSES } from "../config/constants.js";
import { isAvailableForOperation } from "../models/number.js";
import { escapeHtml, formatPhone, nameFor, statusLabels } from "./number-presentation.js";

export function renderNumbersView(numbers, locations, responsibles, query = "", archiveFilter = "ALL", filters = {}, clients = [], groups = []) {
  const rows = numbers.map((number) => `
    <tr>
      <td><button class="number-link" type="button" data-action="view" data-id="${number.id}">${formatPhone(number.phone)}</button><span class="table-secondary">${escapeHtml(number.identification || "Sem identificação")}</span></td>
      <td><span class="status-badge status-${number.status.toLowerCase()}">${statusLabels[number.status]}</span>${number.archivedAt ? '<span class="archive-label">Arquivado</span>' : ""}</td>
      <td>${escapeHtml(nameFor(locations, number.locationId))}</td>
      <td>${escapeHtml(nameFor(responsibles, number.responsibleId))}</td>
      <td><span class="availability ${isAvailableForOperation(number) ? "is-available" : "is-unavailable"}">${isAvailableForOperation(number) ? "Disponível" : "Indisponível"}</span></td>
      <td class="table-actions"><button class="button button-quiet" type="button" data-action="edit" data-id="${number.id}">Editar</button>${number.archivedAt ? `<button class="button button-primary" type="button" data-action="restore" data-id="${number.id}">Desarquivar</button>` : `<button class="button button-danger" type="button" data-action="archive" data-id="${number.id}">Arquivar</button>`}</td>
    </tr>`).join("");
  const emptyMessage = query ? "Nenhum número encontrado para esta busca." : "Nenhum número cadastrado.";
  return `
    <section class="numbers-page">
      <div class="page-heading"><div><h2>Números</h2><p>Controle os números da operação e sua disponibilidade atual.</p></div><button class="button button-primary" type="button" data-action="add">Adicionar número</button></div>
      <div class="list-controls"><div class="search-panel"><label class="search-label" for="number-search">Buscar por número</label><input id="number-search" class="input" type="search" inputmode="tel" value="${escapeHtml(query)}" placeholder="Ex.: +55 (11) 99999-0000" autocomplete="off" /></div><label class="filter-label">Status<select class="input" data-filter="status"><option value="">Todos</option>${Object.values(NUMBER_STATUSES).map(s=>`<option value="${s}" ${filters.status===s?'selected':''}>${statusLabels[s]}</option>`).join('')}</select></label><label class="filter-label">Cliente<select class="input" data-filter="clientId"><option value="">Todos</option>${clients.map(i=>`<option value="${i.id}" ${filters.clientId===i.id?'selected':''}>${escapeHtml(i.name)}</option>`).join('')}</select></label><label class="filter-label">Grupo<select class="input" data-filter="groupId"><option value="">Todos</option>${groups.map(i=>`<option value="${i.id}" ${filters.groupId===i.id?'selected':''}>${escapeHtml(i.name)}</option>`).join('')}</select></label></div>
      <div class="table-card"><div class="table-scroll"><table><thead><tr><th>Número</th><th>Status</th><th>Localização</th><th>Responsável</th><th>Disponibilidade</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${rows || `<tr><td class="empty-cell" colspan="6">${emptyMessage}</td></tr>`}</tbody></table></div></div>
    </section>`;
}

export function renderNumberForm({ number = null, locations, responsibles, clients = [], groups = [], message = "" } = {}) {
  const selected = (value, expected) => value === expected ? "selected" : "";
  const locationOptions = locations.map((location) => `<option value="${location.id}" ${selected(number?.locationId, location.id)}>${escapeHtml(location.name)}</option>`).join("");
  const responsibleOptions = responsibles.map((responsible) => `<option value="${responsible.id}" ${selected(number?.responsibleId, responsible.id)}>${escapeHtml(responsible.name)}</option>`).join("");
  const isArchived = Boolean(number?.archivedAt);
  const checks = (items, field, ids = []) => items.map((item) => `<label class="check-option"><input type="checkbox" name="${field}" value="${item.id}" ${ids.includes(item.id) ? "checked" : ""} /> ${escapeHtml(item.name)}</label>`).join("") || '<span class="table-secondary">Nenhum cadastro ativo.</span>';
  return `
    <div class="modal-backdrop"><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="number-form-title">
      <div class="modal-header"><div><p class="eyebrow">${number ? "Edição" : "Cadastro"}</p><h2 id="number-form-title">${number ? "Editar número" : "Adicionar número"}</h2></div><button class="icon-button" type="button" data-action="close-form" aria-label="Fechar">×</button></div>
      ${message ? `<p class="form-message" role="alert">${escapeHtml(message)}</p>` : ""}
      ${isArchived ? '<p class="archived-notice">Este número está arquivado. Seus dados podem ser consultados, mas seu status permanece inativo nesta etapa.</p>' : ""}
      <form id="number-form" class="number-form" data-id="${number?.id ?? ""}">
        <label>Número de telefone<input class="input" name="phone" type="tel" inputmode="tel" maxlength="18" required value="${escapeHtml(number?.phone ?? "")}" placeholder="+55 (81) 99999-9999" /></label>
        <label>Identificação<input class="input" name="identification" type="text" value="${escapeHtml(number?.identification ?? "")}" placeholder="Ex.: Operação comercial" /></label>
        <label>Status<select class="input" name="status" ${isArchived ? "disabled" : ""}>${Object.values(NUMBER_STATUSES).map((status) => `<option value="${status}" ${selected(number?.status ?? NUMBER_STATUSES.ACTIVE, status)}>${statusLabels[status]}</option>`).join("")}</select></label>
        <label>Localização<select class="input" name="locationId"><option value="">Não definida</option>${locationOptions}</select></label>
        <label>Responsável<select class="input" name="responsibleId"><option value="">Não definido</option>${responsibleOptions}</select></label>
        <fieldset class="form-full"><legend>Clientes</legend>${checks(clients, "clientIds", number?.clientIds ?? [])}</fieldset>
        <fieldset class="form-full"><legend>Grupos</legend>${checks(groups, "groupIds", number?.groupIds ?? [])}</fieldset>
        <label class="form-full">Observações<textarea class="input" name="notes" rows="3" placeholder="Informações internas sobre o número">${escapeHtml(number?.notes ?? "")}</textarea></label>
        <div class="form-actions"><button class="button button-quiet" type="button" data-action="close-form">Cancelar</button><button class="button button-primary" type="submit">${number ? "Salvar alterações" : "Cadastrar número"}</button></div>
      </form>
    </section></div>`;
}
