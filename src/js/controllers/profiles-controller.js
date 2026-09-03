import { renderProfileForm, renderProfiles } from "../ui/profiles-view.js";
import { showToast } from "../ui/toast.js";

export class ProfilesController {
  constructor({ service, content, currentProfile }) { this.service = service; this.content = content; this.currentProfile = currentProfile; this.data = null; }
  async render() {
    try {
      this.data = await this.service.list();
      this.content.innerHTML = renderProfiles({ ...this.data, currentProfile: this.currentProfile });
      this.content.querySelectorAll('[data-action="edit-profile"]').forEach((button) => button.addEventListener("click", () => this.openForm(button.dataset.id)));
    } catch (error) { this.content.innerHTML = `<div class="backup-feedback" role="alert">${error.message}</div>`; }
  }
  openForm(id) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) return;
    this.content.insertAdjacentHTML("beforeend", renderProfileForm(profile, this.data.squads));
    const close = () => this.content.querySelector(".modal-backdrop")?.remove();
    this.content.querySelectorAll('[data-action="close-profile-form"]').forEach((button) => button.addEventListener("click", close));
    this.content.querySelector("#profile-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try { await this.service.update(id, Object.fromEntries(new FormData(event.currentTarget)), this.currentProfile); showToast("Profile atualizado.", "success"); await this.render(); }
      catch (error) { showToast(error.message, "error"); }
    });
  }
}
