import { renderArchivedNumbersView, renderNumberForm, renderNumbersView } from "../ui/numbers-view.js";
import { renderCampaignAddForm, renderNumberDetailView, renderRestrictionForm } from "../ui/number-detail-view.js";
import { renderChangeRoleForm } from "../ui/campaigns-view.js";
import { showToast } from '../ui/toast.js';
import { guardedSubmit } from '../ui/form-submit-guard.js';
import { confirmHardDelete } from '../ui/hard-delete-dialog.js';
import { confirmDialog } from "../ui/confirm-dialog.js";
import { formatPhone } from "../ui/number-presentation.js";
import { renderPageTabs, bindPageTabs, NUMBERS_SECTION_TABS } from "../ui/page-tabs.js";

export class NumbersController {
  constructor({ service, campaignsService, content }) {
    this.service = service;
    this.campaignsService = campaignsService;
    this.content = content;
    this.archivedQuery = "";
    // "main" (Todos os números) e "client" (Números de Clientes) são a mesma UI/ações,
    // só trocando a fonte de dados e o texto do cabeçalho — cada um guarda seu próprio
    // estado de busca/filtro pra não se misturar ao trocar de aba.
    this.lists = {
      main: { query: "", filters: {}, filtersOpen: window.matchMedia('(min-width: 701px)').matches },
      client: { query: "", filters: {}, filtersOpen: window.matchMedia('(min-width: 701px)').matches },
    };
    this.activeMode = "main";
  }

  /** Reaplica a mesma aba que estava sendo exibida — usado após ações (arquivar, salvar,
   * etc.) pra devolver o usuário pro lugar certo, seja ele Números ou Números de Clientes. */
  renderActive() {
    if (this.activeMode === "archived") this.renderArchived();
    else this.render(this.activeMode);
  }

  render(mode = "main") {
    this.activeMode = mode;
    const state = this.lists[mode];
    const isClient = mode === "client";
    const items = isClient ? this.service.getClientNumbers(state.query, state.filters) : this.service.getNumbers(state.query, state.filters);
    const viewOptions = isClient
      ? { heading: "Números de Clientes", subtitle: "Números cuja identificação já indica o cliente (ex.: nome do cliente no texto). Ficam aqui pra não misturar com a operação geral.", searchId: "client-number-search", emptyTitle: "Nenhum número de cliente encontrado" }
      : {};
    this.content.innerHTML = renderPageTabs(NUMBERS_SECTION_TABS, isClient ? "client-numbers" : "numbers") + renderNumbersView(items, this.service.getLocations(), this.service.getResponsibles(), state.query, state.filters, this.service.getClients(), this.service.getGroups(), state.filtersOpen, this.service.state.campaigns, this.service.state.numberCampaignLinks, viewOptions);
    bindPageTabs(this.content, NUMBERS_SECTION_TABS);
    this.bindPageEvents(mode);
  }

  renderClientNumbers() { this.render("client"); }

  renderArchived() {
    this.activeMode = "archived";
    this.content.innerHTML = renderPageTabs(NUMBERS_SECTION_TABS, "archived") + renderArchivedNumbersView(this.service.getArchivedNumbers(this.archivedQuery), this.service.getLocations(), this.service.getResponsibles(), this.archivedQuery, this.service.getClients(), this.service.getGroups());
    bindPageTabs(this.content, NUMBERS_SECTION_TABS);
    this.bindArchivedEvents();
  }

  bindArchivedEvents() {
    this.content.querySelector("#archived-search")?.addEventListener("input", (event) => {
      this.archivedQuery = event.target.value;
      const cursorPosition = event.target.selectionStart;
      this.renderArchived();
      const searchInput = this.content.querySelector("#archived-search");
      searchInput?.focus();
      searchInput?.setSelectionRange(cursorPosition, cursorPosition);
    });
    this.content.querySelectorAll('[data-action="view"]').forEach((button) => button.addEventListener("click", () => this.showDetail(button.dataset.id)));
    this.content.querySelectorAll('[data-action="restore"]').forEach((button) => button.addEventListener("click", async () => { try { this.service.restore(button.dataset.id); await this.service.flush(); this.renderArchived(); showToast('Número restaurado para operação.', 'success'); } catch(error) { showToast(error.message,"error"); } }));
    this.content.querySelectorAll('[data-action="hard-delete"]').forEach((button) => button.addEventListener("click", () => this.hardDelete(button.dataset.id, false, true)));
  }

  bindPageEvents(mode = "main") {
    const state = this.lists[mode];
    const searchId = mode === "client" ? "client-number-search" : "number-search";
    this.content.querySelector(`#${searchId}`)?.addEventListener("input", (event) => {
      state.query = event.target.value;
      const cursorPosition = event.target.selectionStart;
      this.render(mode);
      const searchInput = this.content.querySelector(`#${searchId}`);
      searchInput?.focus();
      searchInput?.setSelectionRange(cursorPosition, cursorPosition);
    });
    this.content.querySelector('[data-action="add"]')?.addEventListener("click", () => this.openForm());
    this.content.querySelectorAll('[data-action="view"]').forEach((button) => button.addEventListener("click", () => this.showDetail(button.dataset.id)));
    this.content.querySelectorAll('[data-action="edit"]').forEach((button) => button.addEventListener("click", () => this.openForm(button.dataset.id)));
    this.content.querySelectorAll('[data-action="review"]').forEach((button) => button.addEventListener("click", () => this.markUnderReview(button.dataset.id)));
    this.content.querySelectorAll('[data-action="end-review"]').forEach((button) => button.addEventListener("click", () => this.endReview(button.dataset.id)));
    this.content.querySelectorAll('[data-action="archive"]').forEach((button) => button.addEventListener("click", () => this.archive(button.dataset.id)));
    this.content.querySelectorAll('[data-action="hard-delete"]').forEach((button) => button.addEventListener("click", () => this.hardDelete(button.dataset.id)));
    this.content.querySelectorAll("[data-filter]").forEach((input) => input.addEventListener("change", () => { state.filters[input.dataset.filter] = input.value; this.render(mode); }));
    this.content.querySelectorAll('[data-action="toggle-filters"]').forEach((button) => button.addEventListener('click', () => { state.filtersOpen = !state.filtersOpen; this.render(mode); }));
    this.content.querySelectorAll('[data-action="clear-filters"]').forEach((button) => button.addEventListener('click', () => { state.query = ''; state.filters = {}; this.render(mode); }));
  }

  showDetail(id) {
    const number = this.service.getNumber(id);
    if (!number) return this.render();
    this.content.innerHTML = renderNumberDetailView({ number, locations: this.service.getLocations(), responsibles: this.service.getResponsibles(), clients: this.service.getClients(), groups: this.service.getGroups(), historyEvents: this.service.history.list(number.id), incidents: this.service.state.incidents.filter((incident) => incident.numberId === number.id), campaigns:this.service.state.campaigns, campaignLinks:this.campaignsService.linksFor(number.id), utilization:this.service.utilizationOf(number) });
    const backHash = this.activeMode === "archived" ? "#numbers/archived" : this.activeMode === "client" ? "#numbers/client-numbers" : "#numbers";
    this.content.querySelector('[data-action="back-to-list"]')?.addEventListener("click", () => {
      if (window.location.hash !== backHash) window.location.hash = backHash;
      else this.renderActive();
    });
    this.content.querySelector('[data-action="edit"]')?.addEventListener('click', () => this.openForm(number.id));
    this.content.querySelector('[data-action="review"]')?.addEventListener('click', () => this.markUnderReview(number.id, true));
    this.content.querySelector('[data-action="end-review"]')?.addEventListener('click', () => this.endReview(number.id, true));
    this.content.querySelector('[data-action="register-restriction"]')?.addEventListener('click', () => this.openRestrictionForm(number.id));
    this.content.querySelector('[data-action="remove-restriction"]')?.addEventListener('click', () => this.removeRestriction(number.id));
    this.content.querySelector('[data-action="manage-campaign"]')?.addEventListener('click', () => this.openCampaignForm(number.id));
    this.content.querySelectorAll('[data-action="end-campaign-link"]').forEach((button) => button.addEventListener('click', () => this.endCampaignLink(number.id, button.dataset.campaignId)));
    this.content.querySelectorAll('[data-action="change-role"]').forEach((button) => button.addEventListener('click', () => this.openChangeRoleForm(number.id, button.dataset.campaignId, button.dataset.role)));
    this.content.querySelector('[data-action="archive"]')?.addEventListener('click', () => this.archive(number.id));
    this.content.querySelector('[data-action="hard-delete"]')?.addEventListener('click', () => this.hardDelete(number.id, true));
    this.content.querySelector('[data-action="restore"]')?.addEventListener('click', async () => { try { this.service.restore(number.id); await this.service.flush(); showToast('Número restaurado para operação.', 'success'); this.showDetail(number.id); } catch(error) { showToast(error.message,"error"); } });
    this.content.querySelectorAll('[data-target]').forEach((button) => button.addEventListener('click', () => { window.location.hash = button.dataset.target; }));
  }

  openForm(id = null, message = "") {
    const number = id ? this.service.getNumber(id) : null;
    this.content.insertAdjacentHTML("beforeend", renderNumberForm({ number, locations: this.service.getLocations(), responsibles: this.service.getResponsibles(), clients: this.service.getClients(), groups: this.service.getGroups(), message }));
    const form = this.content.querySelector("#number-form");
    form.querySelector('[name="phone"]')?.addEventListener("input", (event) => { event.target.value = event.target.value.replace(/\D/g, "").slice(0, 13); });
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button) => button.addEventListener("click", () => this.closeForm()));
    form.querySelectorAll("[data-relation-search]").forEach((input) => input.addEventListener("input", () => this.filterRelationOptions(form, input)));
    form.addEventListener("submit", (event) => guardedSubmit(form, event, () => this.submitForm(form)));
  }

  closeForm() { this.content.querySelector(".modal-backdrop")?.remove(); }

  filterRelationOptions(form, input) {
    const group = input.dataset.relationSearch;
    const optionsContainer = form.querySelector(`[data-relation-options="${group}"]`);
    if (!optionsContainer) return;
    const query = input.value.trim().toLocaleLowerCase("pt-BR");
    const options = [...optionsContainer.querySelectorAll(".check-option")];
    let visibleCount = 0;
    options.forEach((option) => {
      const matches = !query || option.textContent.toLocaleLowerCase("pt-BR").includes(query);
      option.hidden = !matches;
      if (matches) visibleCount++;
    });
    const emptyHint = form.querySelector(`[data-relation-empty="${group}"]`);
    if (emptyHint) emptyHint.hidden = visibleCount !== 0 || options.length === 0;
  }

  async submitForm(form) {
    const formData = new FormData(form);
    const values = { ...Object.fromEntries(formData), clientIds: formData.getAll("clientIds"), groupIds: formData.getAll("groupIds") };
    try {
      const editing = Boolean(form.dataset.id);
      editing ? this.service.update(form.dataset.id, values) : this.service.create(values);
      await this.service.flush();
      this.closeForm();
      this.renderActive();
      showToast(editing ? 'Número atualizado com sucesso.' : 'Número cadastrado com sucesso.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
      this.closeForm(); this.openForm(form.dataset.id || null, error.message);
    }
  }

  async archive(id) {
    const number = this.service.getNumber(id);
    if (!number) return;
    const confirmed = await confirmDialog(this.content, {
      icon: "!",
      title: "Arquivar este número?",
      bodyHtml: `<p>Fica marcado como Bloqueado e sai da listagem principal — use quando ele nunca mais vai ser utilizado. Vai para a aba Arquivados, de onde pode ser restaurado depois.</p><p class="confirm-dialog-phone">${formatPhone(number.phone)}</p>`,
      confirmLabel: "Arquivar número",
      tone: "danger",
    });
    if (!confirmed) return;
    this.service.archive(id);
    try { await this.service.flush(); } catch(error) { showToast(error.message,"error"); return; }
    this.renderActive();
    showToast('Número arquivado e movido para Arquivados.', 'warning');
  }

  async hardDelete(id, fromDetail = false, fromArchived = false) {
    const number = this.service.getNumber(id);
    if (!number) return;
    if (!(await confirmHardDelete(this.content, { entity: "numbers", state: this.service.state, id, name: number.phone, typeLabel: "número" }))) return;
    const wasArchived = Boolean(number.archivedAt);
    try {
      await this.service.hardDelete(id);
      await this.service.flush();
      showToast("Número excluído definitivamente.", "warning");
      if (fromDetail) window.location.hash = wasArchived ? "#numbers/archived" : this.activeMode === "client" ? "#numbers/client-numbers" : "#numbers";
      else if (fromArchived) this.renderArchived();
      else this.renderActive();
    } catch (error) { showToast(error.message, "error"); }
  }

  /** Contrapartida de markUnderReview — sem confirmação (ação positiva, reversível). */
  async endReview(id, returnToDetail = false) {
    try {
      this.service.endReview(id);
      await this.service.flush();
    } catch (error) { showToast(error.message, "error"); return; }
    showToast("Número voltou para ativo.", "success");
    if (returnToDetail) this.showDetail(id); else this.renderActive();
  }

  async markUnderReview(id, returnToDetail = false) {
    const number = this.service.getNumber(id);
    const confirmed = await confirmDialog(this.content, {
      icon: "!",
      title: "Colocar este número em análise?",
      bodyHtml: `<p>O status será alterado, sem criar uma ocorrência automaticamente.</p>${number ? `<p class="confirm-dialog-phone">${formatPhone(number.phone)}</p>` : ""}`,
      confirmLabel: "Colocar em análise",
      tone: "danger",
    });
    if (!confirmed) return;
    this.service.markUnderReview(id);
    try { await this.service.flush(); } catch(error) { showToast(error.message,"error"); return; }
    showToast("Número colocado em análise.", "success");
    if (returnToDetail) this.showDetail(id); else this.renderActive();
  }

  openCampaignForm(id) {
    const number=this.service.getNumber(id);if(!number)return;
    const activeCampaignIds=new Set(this.campaignsService.activeLinksFor(id).map((link)=>link.campaignId));
    const availableCampaigns=this.service.state.campaigns.filter((item)=>item.status==="ACTIVE"&&!activeCampaignIds.has(item.id));
    this.content.insertAdjacentHTML("beforeend",renderCampaignAddForm(number,availableCampaigns));
    const close=()=>this.closeForm();
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button)=>button.addEventListener("click",close));
    const linkForm=this.content.querySelector("#campaign-link-form");
    linkForm?.addEventListener("submit",(event)=>guardedSubmit(linkForm,event,async()=>{
      try {
        const activeLinks=this.campaignsService.activeLinksFor(id);
        if (activeLinks.length > 0) {
          const confirmed = await confirmDialog(this.content, {
            icon: "⚠",
            title: "Vincular a uma nova campanha ao mesmo tempo?",
            bodyHtml: `<p>Este número já está ativo em ${activeLinks.length} campanha${activeLinks.length > 1 ? "s" : ""} simultaneamente. Vincular a mais uma pode causar conflito operacional (ex.: uso duplicado do mesmo número).</p>`,
            confirmLabel: "Vincular mesmo assim",
            tone: "danger",
          });
          if (!confirmed) return;
        }
        const values=Object.fromEntries(new FormData(linkForm));this.campaignsService.assign(id,values.campaignId,values.role);await this.campaignsService.flush();close();showToast("Número vinculado à campanha.","success");this.showDetail(id);
      }
      catch(error){showToast(error.message,"error");}
    }));
  }

  async endCampaignLink(id, campaignId) {
    const confirmed = await confirmDialog(this.content, {
      icon: "!",
      title: "Encerrar este vínculo de campanha?",
      bodyHtml: `<p>O histórico será preservado.</p>`,
      confirmLabel: "Encerrar vínculo",
      tone: "danger",
    });
    if (!confirmed) return;
    try { this.campaignsService.unassign(id,campaignId);await this.campaignsService.flush();showToast("Vínculo de campanha encerrado.","warning");this.showDetail(id); }
    catch(error){showToast(error.message,"error");}
  }

  openChangeRoleForm(numberId, campaignId, currentRole) {
    const number=this.service.getNumber(numberId);const campaign=this.service.state.campaigns.find((item)=>item.id===campaignId);
    if(!number||!campaign)return;
    this.content.insertAdjacentHTML("beforeend",renderChangeRoleForm({numberId,campaignId,phone:number.phone,campaignName:campaign.name,currentRole}));
    const close=()=>this.closeForm();
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button)=>button.addEventListener("click",close));
    const form=this.content.querySelector("#change-role-form");
    form?.addEventListener("submit",(event)=>guardedSubmit(form,event,async()=>{
      try{
        const role=new FormData(form).get("role");
        this.campaignsService.assign(numberId,campaignId,role);
        await this.campaignsService.flush();
        close();
        showToast("Função atualizada.","success");
        this.showDetail(numberId);
      }catch(error){showToast(error.message,"error");}
    }));
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
    form.addEventListener("submit", (event) => guardedSubmit(form, event, async () => {
      try {
        this.service.registerRestriction(id, Object.fromEntries(new FormData(form)));
        await this.service.flush();
        this.closeForm();
        showToast("Restrição operacional registrada.", "success");
        this.showDetail(id);
      } catch (error) { showToast(error.message, "error"); }
    }));
  }

  async removeRestriction(id) {
    const confirmed = await confirmDialog(this.content, {
      icon: "!",
      title: "Remover a restrição ativa?",
      bodyHtml: `<p>O status principal não será alterado.</p>`,
      confirmLabel: "Remover restrição",
      tone: "danger",
    });
    if (!confirmed) return;
    this.service.removeRestriction(id);
    try { await this.service.flush(); } catch(error) { showToast(error.message,"error"); return; }
    showToast("Restrição operacional removida.", "success");
    this.showDetail(id);
  }
}
