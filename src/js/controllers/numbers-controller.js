import { renderNumberForm, renderNumbersView } from "../ui/numbers-view.js";
import { renderCampaignLinkForm, renderNumberDetailView, renderRestrictionForm } from "../ui/number-detail-view.js";
import { showToast } from '../ui/toast.js';

export class NumbersController {
  constructor({ service, campaignsService, content }) {
    this.service = service;
    this.campaignsService = campaignsService;
    this.content = content;
    this.query = "";
    this.archiveFilter = "ALL";
    this.filters = {};
    this.filtersOpen = window.matchMedia('(min-width: 701px)').matches;
  }

  render() {
    this.content.innerHTML = renderNumbersView(this.service.getNumbers(this.query, { ...this.filters, archiveFilter: this.archiveFilter }), this.service.getLocations(), this.service.getResponsibles(), this.query, this.archiveFilter, this.filters, this.service.getClients(), this.service.getGroups(), this.filtersOpen, this.service.state.campaigns, this.service.state.numberCampaignLinks);
    this.decorateCampaignContext();
    this.bindPageEvents();
  }

  decorateCampaignContext() {
    const panel=this.content.querySelector(".filters-panel");
    if(panel) {
      const campaignLabel=document.createElement("label");campaignLabel.className="filter-label";campaignLabel.textContent="Campanha";
      const campaignSelect=document.createElement("select");campaignSelect.className="input";campaignSelect.dataset.filter="campaignId";
      campaignSelect.append(new Option("Todas",""),...this.service.state.campaigns.filter((item)=>item.status==="ACTIVE").map((item)=>new Option(item.name,item.id,false,item.id===this.filters.campaignId)));
      campaignLabel.append(campaignSelect);panel.append(campaignLabel);
      const stateLabel=document.createElement("label");stateLabel.className="filter-label";stateLabel.textContent="Campanha atual";
      const stateSelect=document.createElement("select");stateSelect.className="input";stateSelect.dataset.filter="campaignState";
      stateSelect.append(new Option("Todos",""),new Option("Disponível","AVAILABLE",false,this.filters.campaignState==="AVAILABLE"),new Option("Em campanha","IN_CAMPAIGN",false,this.filters.campaignState==="IN_CAMPAIGN"));
      stateLabel.append(stateSelect);panel.append(stateLabel);
    }
    this.content.querySelectorAll('[data-action="view"]').forEach((button)=>{
      const link=this.campaignsService.activeLinkFor(button.dataset.id),campaign=this.campaignsService.get(link?.campaignId);
      const badge=document.createElement("span");badge.className=`status-badge ${link?"status-active":"status-inactive"}`;badge.textContent=link?`Em campanha: ${campaign?.name||"Ativa"}`:"Disponível";
      button.closest(".number-record")?.querySelector(".record-status")?.append(badge);
    });
  }

  bindPageEvents() {
    this.content.querySelector("#number-search")?.addEventListener("input", (event) => {
      this.query = event.target.value;
      const cursorPosition = event.target.selectionStart;
      this.render();
      const searchInput = this.content.querySelector("#number-search");
      searchInput?.focus();
      searchInput?.setSelectionRange(cursorPosition, cursorPosition);
    });
    this.content.querySelector('[data-action="add"]')?.addEventListener("click", () => this.openForm());
    this.content.querySelectorAll('[data-action="view"]').forEach((button) => button.addEventListener("click", () => this.showDetail(button.dataset.id)));
    this.content.querySelectorAll('[data-action="edit"]').forEach((button) => button.addEventListener("click", () => this.openForm(button.dataset.id)));
    this.content.querySelectorAll('[data-action="review"]').forEach((button) => button.addEventListener("click", () => this.markUnderReview(button.dataset.id)));
    this.content.querySelectorAll('[data-action="archive"]').forEach((button) => button.addEventListener("click", () => this.archive(button.dataset.id)));
    this.content.querySelectorAll('[data-action="restore"]').forEach((button) => button.addEventListener("click", async () => { try { this.service.restore(button.dataset.id); await this.service.flush(); this.render(); showToast('Número restaurado para operação.', 'success'); } catch(error) { showToast(error.message,"error"); } }));
    this.content.querySelector("#archive-filter")?.addEventListener("change", (event) => { this.archiveFilter = event.target.value; this.render(); });
    this.content.querySelectorAll("[data-filter]").forEach((input) => input.addEventListener("change", () => { this.filters[input.dataset.filter] = input.value; this.render(); }));
    this.content.querySelectorAll('[data-action="toggle-filters"]').forEach((button) => button.addEventListener('click', () => { this.filtersOpen = !this.filtersOpen; this.render(); }));
    this.content.querySelectorAll('[data-action="clear-filters"]').forEach((button) => button.addEventListener('click', () => { this.query = ''; this.archiveFilter = 'ALL'; this.filters = {}; this.render(); }));
  }

  showDetail(id) {
    const number = this.service.getNumber(id);
    if (!number) return this.render();
    this.content.innerHTML = renderNumberDetailView({ number, locations: this.service.getLocations(), responsibles: this.service.getResponsibles(), clients: this.service.getClients(), groups: this.service.getGroups(), historyEvents: this.service.history.list(number.id), incidents: this.service.state.incidents.filter((incident) => incident.numberId === number.id), campaigns:this.service.state.campaigns, campaignLinks:this.campaignsService.linksFor(number.id) });
    this.content.querySelector('[data-action="back-to-list"]')?.addEventListener("click", () => {
      if (window.location.hash !== "#numbers") window.location.hash = "#numbers";
      else this.render();
    });
    this.content.querySelector('[data-action="edit"]')?.addEventListener('click', () => this.openForm(number.id));
    this.content.querySelector('[data-action="review"]')?.addEventListener('click', () => this.markUnderReview(number.id, true));
    this.content.querySelector('[data-action="register-restriction"]')?.addEventListener('click', () => this.openRestrictionForm(number.id));
    this.content.querySelector('[data-action="remove-restriction"]')?.addEventListener('click', () => this.removeRestriction(number.id));
    this.content.querySelector('[data-action="manage-campaign"]')?.addEventListener('click', () => this.openCampaignForm(number.id));
    this.content.querySelector('[data-action="end-campaign-link"]')?.addEventListener('click', () => this.endCampaignLink(number.id));
    this.content.querySelector('[data-action="archive"]')?.addEventListener('click', () => this.archive(number.id));
    this.content.querySelector('[data-action="restore"]')?.addEventListener('click', async () => { try { this.service.restore(number.id); await this.service.flush(); showToast('Número restaurado para operação.', 'success'); this.showDetail(number.id); } catch(error) { showToast(error.message,"error"); } });
    this.content.querySelectorAll('[data-target]').forEach((button) => button.addEventListener('click', () => { window.location.hash = button.dataset.target; }));
  }

  openForm(id = null, message = "") {
    const number = id ? this.service.getNumber(id) : null;
    this.content.insertAdjacentHTML("beforeend", renderNumberForm({ number, locations: this.service.getLocations(), responsibles: this.service.getResponsibles(), clients: this.service.getClients(), groups: this.service.getGroups(), message }));
    const form = this.content.querySelector("#number-form");
    form.querySelector('[name="phone"]')?.addEventListener("input", (event) => { event.target.value = event.target.value.replace(/\D/g, "").slice(0, 13); });
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button) => button.addEventListener("click", () => this.closeForm()));
    form.addEventListener("submit", (event) => this.submitForm(event));
  }

  closeForm() { this.content.querySelector(".modal-backdrop")?.remove(); }

  async submitForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const values = { ...Object.fromEntries(formData), clientIds: formData.getAll("clientIds"), groupIds: formData.getAll("groupIds") };
    try {
      const editing = Boolean(form.dataset.id);
      if (editing) this.service.update(form.dataset.id, values);
      else this.service.create(values);
      await this.service.flush();
      this.closeForm();
      this.render();
      showToast(editing ? 'Número atualizado com sucesso.' : 'Número cadastrado com sucesso.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
      this.closeForm(); this.openForm(form.dataset.id || null, error.message);
    }
  }

  async archive(id) {
    const number = this.service.getNumber(id);
    if (!number || !window.confirm(`Arquivar ${number.phone}? O número ficará inativo e indisponível.`)) return;
    this.service.archive(id);
    try { await this.service.flush(); } catch(error) { showToast(error.message,"error"); return; }
    this.render();
    showToast('Número arquivado e retirado da operação.', 'warning');
  }

  async markUnderReview(id, returnToDetail = false) {
    if (!window.confirm("Colocar este número em análise? O status será alterado, sem criar uma ocorrência automaticamente.")) return;
    this.service.markUnderReview(id);
    try { await this.service.flush(); } catch(error) { showToast(error.message,"error"); return; }
    showToast("Número colocado em análise.", "success");
    if (returnToDetail) this.showDetail(id); else this.render();
  }

  openCampaignForm(id) {
    const number=this.service.getNumber(id);if(!number)return;
    const activeLink=this.campaignsService.activeLinkFor(id);
    this.content.insertAdjacentHTML("beforeend",renderCampaignLinkForm(number,this.service.state.campaigns,activeLink));
    const close=()=>this.closeForm();
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button)=>button.addEventListener("click",close));
    this.content.querySelector("#campaign-link-form")?.addEventListener("submit",async(event)=>{
      event.preventDefault();
      try { const values=Object.fromEntries(new FormData(event.currentTarget));this.campaignsService.assign(id,values.campaignId,values.role);await this.campaignsService.flush();close();showToast(activeLink?"Vínculo de campanha atualizado.":"Número vinculado à campanha.","success");this.showDetail(id); }
      catch(error){showToast(error.message,"error");}
    });
  }

  async endCampaignLink(id) {
    if(!window.confirm("Encerrar o vínculo ativo desta campanha? O histórico será preservado."))return;
    try { this.campaignsService.unassign(id);await this.campaignsService.flush();showToast("Vínculo de campanha encerrado.","warning");this.showDetail(id); }
    catch(error){showToast(error.message,"error");}
  }

  openRestrictionForm(id) {
    const number = this.service.getNumber(id);
    if (!number) return;
    this.content.insertAdjacentHTML("beforeend", renderRestrictionForm(number));
    const form = this.content.querySelector("#restriction-form");
    const other = form.querySelector("[data-other-restriction]");
    const kind = form.querySelector('[name="kind"]');
    const updateOther = () => { other.hidden = kind.value !== "OTHER"; };
    kind.addEventListener("change", updateOther);
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button) => button.addEventListener("click", () => this.closeForm()));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        this.service.registerRestriction(id, Object.fromEntries(new FormData(form)));
        await this.service.flush();
        this.closeForm();
        showToast("Restrição operacional registrada.", "success");
        this.showDetail(id);
      } catch (error) { showToast(error.message, "error"); }
    });
  }

  async removeRestriction(id) {
    if (!window.confirm("Remover a restrição ativa? O status principal não será alterado.")) return;
    this.service.removeRestriction(id);
    try { await this.service.flush(); } catch(error) { showToast(error.message,"error"); return; }
    showToast("Restrição operacional removida.", "success");
    this.showDetail(id);
  }
}
