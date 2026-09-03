import { renderDirectory, renderDirectoryDetail, renderDirectoryForm } from "../ui/directory-view.js";
import { showToast } from "../ui/toast.js";

const labels = { clients: "Cliente", groups: "Squad", responsibles: "Colaborador" };

export class DirectoryController {
  constructor({ service, campaignsService = null, content, type }) { this.service = service; this.campaignsService = campaignsService; this.content = content; this.type = type; this.query = ""; }

  render() {
    this.content.innerHTML = renderDirectory(this.type, this.service.list(this.type, true), this.query, this.service.numbersService.state.groups);
    this.content.querySelector('[data-action="add"]')?.addEventListener("click", () => this.openForm());
    this.content.querySelector('[data-action="search"]')?.addEventListener("input", (event) => { this.query = event.target.value; this.render(); });
    this.content.querySelector('[data-action="clear-search"]')?.addEventListener("click", () => { this.query = ""; this.render(); });
    this.content.querySelectorAll('[data-action="view"]').forEach((button) => button.addEventListener("click", () => this.detail(button.dataset.id)));
    this.content.querySelectorAll('[data-action="edit"]').forEach((button) => button.addEventListener("click", () => this.openForm(button.dataset.id)));
    this.content.querySelectorAll('[data-action="archive"]').forEach((button) => button.addEventListener("click", () => this.archive(button.dataset.id)));
    this.content.querySelectorAll('[data-action="restore"]').forEach((button) => button.addEventListener("click", async () => { try { this.service.restore(this.type, button.dataset.id); await this.service.flush(); showToast(`${labels[this.type]} restaurado.`, "success"); this.render(); } catch(error) { showToast(error.message,"error"); } }));
  }

  detail(id) {
    const item = this.service.get(this.type, id);
    if (!item) return this.render();
    const numbers = this.service.numbersService.getNumbersFor(this.type, id);
    const state = this.service.numbersService.state;
    const campaigns = this.type === "clients" && this.campaignsService ? this.campaignsService.list({ clientId: id }) : [];
    this.content.innerHTML = renderDirectoryDetail(this.type, item, numbers, state.locations, state.responsibles, campaigns, state.groups, state.numberCampaignLinks);
    this.content.querySelector('[data-action="back"]')?.addEventListener("click", () => this.render());
    this.content.querySelectorAll('[data-action="open-number"]').forEach((button) => button.addEventListener("click", () => { window.location.hash = `#numbers/${button.dataset.id}`; }));
    this.content.querySelectorAll('[data-action="open-campaign"]').forEach((button) => button.addEventListener("click", () => { window.location.hash = `#campaigns/${button.dataset.id}`; }));
    this.content.querySelectorAll('[data-action="close-campaign"]').forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm("Finalizar esta campanha? Os vínculos ativos serão encerrados e o histórico será preservado.")) return;
      this.campaignsService.close(button.dataset.id);
      try { await this.campaignsService.flush(); } catch(error) { showToast(error.message,"error"); return; }
      showToast("Campanha finalizada.", "warning");
      this.detail(id);
    }));
  }

  async archive(id) {
    const label = labels[this.type];
    if (!window.confirm(`Arquivar este ${label.toLocaleLowerCase("pt-BR")}? Ele continuará preservado na base.`)) return;
    this.service.archive(this.type, id);
    try { await this.service.flush(); } catch(error) { showToast(error.message,"error"); return; }
    showToast(`${label} arquivado.`, "warning");
    this.render();
  }

  openForm(id = null) {
    this.content.insertAdjacentHTML("beforeend", renderDirectoryForm(this.type, id ? this.service.get(this.type, id) : {}, this.service.list("groups")));
    const close = () => this.content.querySelector(".modal-backdrop")?.remove();
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button) => button.addEventListener("click", close));
    this.content.querySelector("#directory-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const values = Object.fromEntries(new FormData(form));
        const isUpdate = Boolean(form.dataset.id);
        if (isUpdate) this.service.update(this.type, form.dataset.id, values); else this.service.create(this.type, values);
        await this.service.flush();
        showToast(`${labels[this.type]} ${isUpdate ? "atualizado" : "adicionado"}.`, "success");
        this.render();
      } catch (error) { showToast(error.message || "Não foi possível salvar o registro.", "error"); }
    });
  }
}
