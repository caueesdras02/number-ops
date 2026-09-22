import { renderProfileForm, renderProfiles } from "../ui/profiles-view.js";
import { renderSignupAuthorizationForm, renderSignupAuthorizations } from "../ui/signup-authorizations-view.js";
import { showToast } from "../ui/toast.js";
import { escapeHtml } from "../ui/number-presentation.js";
import { confirmDialog } from "../ui/confirm-dialog.js";
import { guardedSubmit } from "../ui/form-submit-guard.js";
import { isMaster } from "../models/access.js";

export class ProfilesController {
  constructor({ service, authorizationsService = null, content, currentProfile }) { this.service = service; this.authorizationsService = authorizationsService; this.content = content; this.currentProfile = currentProfile; this.data = null; this.authorizations = null; }
  async render() {
    try {
      this.data = await this.service.list();
      let authorizationsHtml = "";
      if (this.authorizationsService && isMaster(this.currentProfile)) {
        this.authorizations = await this.authorizationsService.list();
        authorizationsHtml = renderSignupAuthorizations(this.authorizations, this.data.squads);
      }
      this.content.innerHTML = renderProfiles({ ...this.data, currentProfile: this.currentProfile }) + authorizationsHtml;
      this.content.querySelectorAll('[data-action="edit-profile"]').forEach((button) => button.addEventListener("click", () => this.openForm(button.dataset.id)));
      this.content.querySelectorAll('[data-action="hard-delete-profile"]').forEach((button) => button.addEventListener("click", () => this.hardDelete(button.dataset.id)));
      this.content.querySelector('[data-action="add-authorization"]')?.addEventListener("click", () => this.openAuthorizationForm());
      this.content.querySelectorAll('[data-action="revoke-authorization"]').forEach((button) => button.addEventListener("click", () => this.revokeAuthorization(button.dataset.id)));
    } catch (error) { this.content.innerHTML = `<div class="backup-feedback" role="alert">${escapeHtml(error.message)}</div>`; }
  }
  openForm(id) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) return;
    this.content.insertAdjacentHTML("beforeend", renderProfileForm(profile, this.data.squads, this.currentProfile));
    const close = () => this.content.querySelector(".modal-backdrop")?.remove();
    this.content.querySelectorAll('[data-action="close-profile-form"]').forEach((button) => button.addEventListener("click", close));
    this.content.querySelector("#profile-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try { await this.service.update(id, Object.fromEntries(new FormData(event.currentTarget)), this.currentProfile); showToast("Usuário atualizado.", "success"); await this.render(); }
      catch (error) { showToast(error.message, "error"); }
    });
  }
  async hardDelete(id) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) return;
    const confirmed = await confirmDialog(this.content, {
      icon: "!",
      title: "Excluir definitivamente este usuário?",
      bodyHtml: `<p>O perfil será removido do sistema.</p><p class="confirm-dialog-phone">${escapeHtml(profile.name)} (${escapeHtml(profile.email)})</p>`,
      noteHtml: `<p>A credencial de login deve ser removida no painel do Supabase Auth.</p>`,
      confirmLabel: "Excluir usuário",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await this.service.hardDelete(id, this.currentProfile);
      showToast("Perfil removido. Remova a credencial no Supabase Auth para concluir.", "warning");
      await this.render();
    } catch (error) { showToast(error.message, "error"); }
  }
  openAuthorizationForm() {
    this.content.insertAdjacentHTML("beforeend", renderSignupAuthorizationForm(this.data.squads, isMaster(this.currentProfile)));
    const close = () => this.content.querySelector(".modal-backdrop")?.remove();
    this.content.querySelectorAll('[data-action="close-authorization-form"]').forEach((button) => button.addEventListener("click", close));
    const form = this.content.querySelector("#authorization-form");
    form?.addEventListener("submit", (event) => guardedSubmit(form, event, async () => {
      try {
        const values = Object.fromEntries(new FormData(form));
        await this.authorizationsService.create(values, this.currentProfile);
        showToast("E-mail autorizado.", "success");
        await this.render();
      } catch (error) { showToast(error.message || "Não foi possível autorizar o e-mail.", "error"); }
    }));
  }
  async revokeAuthorization(id) {
    const authorization = this.authorizations?.find((item) => item.id === id);
    if (!authorization) return;
    const confirmed = await confirmDialog(this.content, {
      icon: "!",
      title: "Revogar esta autorização?",
      bodyHtml: `<p>O e-mail deixa de poder concluir o cadastro até ser autorizado de novo.</p><p class="confirm-dialog-phone">${escapeHtml(authorization.email)}</p>`,
      confirmLabel: "Revogar",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await this.authorizationsService.revoke(id, this.currentProfile);
      showToast("Autorização revogada.", "warning");
      await this.render();
    } catch (error) { showToast(error.message, "error"); }
  }
}
