import { escapeHtml, nameFor } from "./number-presentation.js";
import { ACCESS_LEVEL_LABELS, isMaster } from "../models/access.js";
import { matchesSearch } from "../models/search-match.js";

const labels = {
  ANALYST: "Analista", ACCOUNT_MANAGER: "Gerente de Contas", OTHER: "Outro",
  ACTIVE: "Ativo", INACTIVE: "Inativo",
  ...ACCESS_LEVEL_LABELS,
};

export function filterProfiles(profiles, query) {
  return profiles.filter((profile) => matchesSearch(profile.name, query) || matchesSearch(profile.email, query));
}

/** Só as linhas da tabela (ou o estado vazio) — usado pelo controller pra atualizar a busca SEM
 * substituir o <input> (que fica fora do table-scroll), preservando o foco a cada letra digitada.
 * O HTML completo (renderProfiles, abaixo) usa exatamente esta mesma função. */
export function renderProfileRows(profiles, squads, currentProfile) {
  const master = isMaster(currentProfile);
  const admin = master || currentProfile.access_level === "ADMIN";
  const rows = profiles.map((profile) => {
    const canEdit = master || (admin && profile.access_level !== "MASTER");
    const canDelete = master && profile.id !== currentProfile.id;
    return `<tr><td><strong>${escapeHtml(profile.name)}</strong><span class="table-secondary">${escapeHtml(profile.email)}</span></td><td>${labels[profile.job_title] ?? escapeHtml(profile.job_title || "—")}</td><td>${escapeHtml(nameFor(squads, profile.squad_id, "Sem Squad"))}</td><td><span class="status-badge ${profile.status === "ACTIVE" ? "status-active" : "status-inactive"}">${labels[profile.status] ?? escapeHtml(profile.status)}</span></td><td><strong class="access-level access-${(profile.access_level || "").toLowerCase()}">${labels[profile.access_level] ?? escapeHtml(profile.access_level || "—")}</strong></td><td class="table-actions">${canEdit ? `<button class="button button-quiet" data-action="edit-profile" data-id="${profile.id}">Editar</button>` : '<span class="table-secondary">Somente leitura</span>'}${canDelete ? `<button class="button button-danger" data-action="hard-delete-profile" data-id="${profile.id}" data-master-only>Excluir definitivamente</button>` : ""}</td></tr>`;
  }).join("");
  return rows || '<tr><td class="empty-cell" colspan="6">Nenhum usuário encontrado.</td></tr>';
}

export function renderProfiles({ profiles, squads, currentProfile, query = "" }) {
  const visible = filterProfiles(profiles, query);
  return `<section class="numbers-page"><div class="page-heading"><div><p class="eyebrow">Acesso</p><h2>Usuários</h2><p>Hierarquia: <strong>Master</strong> &gt; Admin &gt; User &gt; Viewer. Somente MASTER altera nível de acesso ou exclui definitivamente. Senhas permanecem no Supabase Auth.</p></div></div><div class="list-controls"><label class="search-panel">Buscar<input class="input" data-action="search" type="search" value="${escapeHtml(query)}" placeholder="Nome ou e-mail" autocomplete="off"></label></div><div class="table-card"><div class="table-scroll"><table><thead><tr><th>Usuário</th><th>Cargo</th><th>Squad</th><th>Status</th><th>Acesso</th><th>Ações</th></tr></thead><tbody>${renderProfileRows(visible, squads, currentProfile)}</tbody></table></div></div></section>`;
}

export function renderProfileForm(profile, squads, currentProfile) {
  const master = isMaster(currentProfile);
  const editingMaster = profile.access_level === "MASTER";
  const levelDisabled = !master;
  const jobOpt = (value) => `<option value="${value}" ${value === profile.job_title ? "selected" : ""}>${labels[value]}</option>`;
  const statusOpt = (value) => `<option value="${value}" ${value === profile.status ? "selected" : ""}>${labels[value]}</option>`;
  const levels = master ? ["MASTER", "ADMIN", "USER", "VIEWER"] : ["ADMIN", "USER", "VIEWER"];
  const levelOpt = (value) => `<option value="${value}" ${value === profile.access_level ? "selected" : ""}>${labels[value]}</option>`;
  return `<div class="modal-backdrop"><form id="profile-form" class="modal-card" data-id="${profile.id}"><div class="modal-header"><div><p class="eyebrow">Usuários</p><h2>Editar usuário</h2><p>${escapeHtml(profile.email)}</p></div><button class="icon-button" type="button" data-action="close-profile-form">×</button></div>${editingMaster && !master ? '<p class="form-message" role="alert">Somente um MASTER pode alterar um usuário MASTER.</p>' : ""}<div class="number-form"><label>Nome<input class="input" name="name" required value="${escapeHtml(profile.name)}"></label><label>Cargo<select class="input" name="job_title" required>${jobOpt("ANALYST")}${jobOpt("ACCOUNT_MANAGER")}${jobOpt("OTHER")}</select></label><label>Squad<select class="input" name="squad_id"><option value="">Sem Squad</option>${squads.map((squad) => `<option value="${squad.id}" ${squad.id === profile.squad_id ? "selected" : ""}>${escapeHtml(squad.name)}</option>`).join("")}</select></label><label>Status<select class="input" name="status">${statusOpt("ACTIVE")}${statusOpt("INACTIVE")}</select></label><label>Nível de acesso<select class="input" name="access_level" ${levelDisabled ? "disabled" : ""}>${levels.map(levelOpt).join("")}</select>${levelDisabled ? '<small class="form-hint">Somente MASTER pode alterar o nível de acesso.</small>' : ""}</label><div class="form-actions"><button class="button button-quiet" type="button" data-action="close-profile-form">Cancelar</button><button class="button button-primary">Salvar</button></div></div></form></div>`;
}
