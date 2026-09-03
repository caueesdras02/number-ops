import { escapeHtml, nameFor } from "./number-presentation.js";

const labels = {
  ANALYST: "Analista", ACCOUNT_MANAGER: "Gerente de Contas",
  ACTIVE: "Ativo", INACTIVE: "Inativo", ADMIN: "Admin", USER: "User", VIEWER: "Viewer",
};
const option = (value, current) => `<option value="${value}" ${value === current ? "selected" : ""}>${labels[value]}</option>`;

export function renderProfiles({ profiles, squads, currentProfile }) {
  const rows = profiles.map((profile) => `<tr><td><strong>${escapeHtml(profile.name)}</strong><span class="table-secondary">${escapeHtml(profile.email)}</span></td><td>${labels[profile.job_title]}</td><td>${escapeHtml(nameFor(squads, profile.squad_id, "Sem Squad"))}</td><td><span class="status-badge ${profile.status === "ACTIVE" ? "status-active" : "status-inactive"}">${labels[profile.status]}</span></td><td><strong>${labels[profile.access_level]}</strong></td><td class="table-actions">${currentProfile.access_level === "ADMIN" ? `<button class="button button-quiet" data-action="edit-profile" data-id="${profile.id}">Editar</button>` : "Somente leitura"}</td></tr>`).join("");
  return `<section class="numbers-page"><div class="page-heading"><div><p class="eyebrow">Acesso</p><h2>Usuários</h2><p>Gerencie profiles, cargos, Squads, status e níveis de acesso. Senhas permanecem exclusivamente no Supabase Auth.</p></div></div><div class="table-card"><div class="table-scroll"><table><thead><tr><th>Usuário</th><th>Cargo</th><th>Squad</th><th>Status</th><th>Acesso</th><th>Ações</th></tr></thead><tbody>${rows || '<tr><td class="empty-cell" colspan="6">Nenhum profile encontrado.</td></tr>'}</tbody></table></div></div></section>`;
}

export function renderProfileForm(profile, squads) {
  return `<div class="modal-backdrop"><form id="profile-form" class="modal-card" data-id="${profile.id}"><div class="modal-header"><div><p class="eyebrow">Usuários</p><h2>Editar profile</h2><p>${escapeHtml(profile.email)}</p></div><button class="icon-button" type="button" data-action="close-profile-form">×</button></div><div class="number-form"><label>Nome<input class="input" name="name" required value="${escapeHtml(profile.name)}"></label><label>Cargo<select class="input" name="job_title" required>${option("ANALYST",profile.job_title)}${option("ACCOUNT_MANAGER",profile.job_title)}</select></label><label>Squad<select class="input" name="squad_id"><option value="">Sem Squad</option>${squads.map((squad) => `<option value="${squad.id}" ${squad.id === profile.squad_id ? "selected" : ""}>${escapeHtml(squad.name)}</option>`).join("")}</select></label><label>Status<select class="input" name="status">${option("ACTIVE",profile.status)}${option("INACTIVE",profile.status)}</select></label><label>Nível de acesso<select class="input" name="access_level">${option("ADMIN",profile.access_level)}${option("USER",profile.access_level)}${option("VIEWER",profile.access_level)}</select></label><div class="form-actions"><button class="button button-quiet" type="button" data-action="close-profile-form">Cancelar</button><button class="button button-primary">Salvar</button></div></div></form></div>`;
}
