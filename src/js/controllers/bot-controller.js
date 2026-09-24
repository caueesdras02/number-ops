import { renderBotCentral, renderBotEventDetail, phoneLabel } from "../ui/bot-view.js";
import { escapeHtml } from "../ui/number-presentation.js";
import { showToast } from "../ui/toast.js";
import { guardedSubmit } from "../ui/form-submit-guard.js";
import { confirmDialog } from "../ui/confirm-dialog.js";
import { matchesSearch } from "../models/search-match.js";

export class BotController {
  constructor({ service, content }) { this.service = service; this.content = content; this.filters = {}; this.data = null; }

  async render() {
    try { this.data = await this.service.load(); this.paint(); }
    catch (error) { this.content.innerHTML = `<div class="backup-feedback" role="alert">${escapeHtml(error.message)}</div>`; }
  }

  paint() {
    this.content.innerHTML = renderBotCentral({ ...this.data, filters: this.filters });
    this.content.querySelector('[data-bot-filter="status"]')?.addEventListener("change", (event) => { this.filters.status = event.target.value; this.paint(); });
    this.content.querySelector('[data-bot-metric="pending"]')?.addEventListener("click", () => { this.filters.status = "PENDING_ASSOCIATION"; this.paint(); });
    this.content.querySelector('[data-bot-metric="connectivity"]')?.addEventListener("click", () => { window.location.hash = "#incidents"; });
    this.content.querySelectorAll('[data-action="bot-detail"]').forEach((button) => button.addEventListener("click", () => this.detail(button.dataset.id)));
    this.bindNavigationLinks(this.content);
  }

  bindNavigationLinks(scope) {
    scope.querySelectorAll('[data-action="open-number"]').forEach((button) => button.addEventListener("click", () => { window.location.hash = `#numbers/${button.dataset.id}`; }));
    scope.querySelectorAll('[data-action="open-campaign"]').forEach((button) => button.addEventListener("click", () => { window.location.hash = `#campaigns/${button.dataset.id}`; }));
    scope.querySelectorAll('[data-action="open-incident"]').forEach((button) => button.addEventListener("click", () => { window.location.hash = `#incidents/${button.dataset.id}`; }));
  }

  detail(id) {
    const event = this.data?.events?.find((item) => item.id === id);
    if (!event) return;
    const availableNumbers = this.service.numbers.state.numbers
      .filter((number) => !number.archivedAt)
      .sort((a, b) => a.phone.localeCompare(b.phone));
    // Só campanhas ATIVAS, com o nome do Cliente já resolvido, excluindo as que este número
    // externo já está vinculado (evita oferecer "vincular de novo" à mesma campanha).
    const alreadyLinkedIds = new Set((event.existingExternalLinks ?? []).map((link) => link.campaignId));
    const availableCampaigns = this.service.numbers.state.campaigns
      .filter((campaign) => campaign.status === "ACTIVE" && !alreadyLinkedIds.has(campaign.id))
      .map((campaign) => ({ ...campaign, clientName: this.service.numbers.state.clients.find((client) => client.id === campaign.clientId)?.name ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.content.insertAdjacentHTML("beforeend", renderBotEventDetail(event, { canModify: this.data.canModify, availableNumbers, availableCampaigns }));
    const modal = this.content.querySelector("[data-bot-modal]");
    const close = () => modal?.remove();
    modal?.querySelector('[data-action="close-bot-detail"]')?.addEventListener("click", close);
    modal?.addEventListener("click", (clickEvent) => { if (clickEvent.target === modal) close(); });
    this.bindNavigationLinks(modal);
    this.bindDetailActions(modal, event);
  }

  bindDetailActions(modal, event) {
    if (!modal) return;

    const markNotOwnedTrigger = modal.querySelector('[data-action="bot-mark-not-owned"]');
    markNotOwnedTrigger?.addEventListener("click", async () => {
      if (markNotOwnedTrigger.disabled) return; // impede reabrir o diálogo enquanto a confirmação anterior ainda está em curso
      const confirmed = await confirmDialog(this.content, {
        icon: "!",
        title: "Número fora da operação?",
        bodyHtml: `<p>Você está prestes a marcar:</p><p class="confirm-dialog-phone">${phoneLabel(event.phoneNormalized)}</p><p>como um número que não pertence à operação.</p>`,
        noteHtml: `<p>O evento continuará disponível no histórico, mas deixará de aparecer como pendente.</p><p>Novos alertas deste mesmo número serão ignorados automaticamente.</p>`,
        confirmLabel: "Confirmar como externo",
        tone: "danger",
      });
      if (!confirmed) return;
      // Mesma lógica de sempre, só que agora acionada pelo modal customizado em vez do
      // window.confirm() nativo — nada do que acontece depois da confirmação mudou.
      markNotOwnedTrigger.disabled = true;
      try {
        await this.service.markNotOwned(event.id, event);
        showToast("Telefone classificado como não pertencente à operação.", "success");
        modal.remove();
        await this.render();
      } catch (error) {
        showToast(error.message, "error");
        markNotOwnedTrigger.disabled = false;
      }
    });

    modal.querySelector('[data-action="bot-revert-not-owned"]')?.addEventListener("click", async (clickEvent) => {
      const externalId = clickEvent.currentTarget.dataset.externalId;
      const confirmed = await confirmDialog(this.content, {
        icon: "!",
        title: "Reverter a classificação de externo?",
        bodyHtml: `<p>Novos alertas deste telefone voltarão a ficar pendentes de associação.</p>`,
        confirmLabel: "Reverter classificação",
        tone: "danger",
      });
      if (!confirmed) return;
      try {
        await this.service.revertNotOwned(externalId);
        showToast("Classificação de externo revertida.", "success");
        modal.remove();
        await this.render();
      } catch (error) { showToast(error.message, "error"); }
    });

    // Filtro de busca reaproveitado por QUALQUER form de picker no modal (associar número e
    // vincular campanha) — cada um com seu próprio [data-link-search]/[data-relation-option].
    modal.querySelectorAll("[data-link-search]").forEach((searchInput) => {
      const form = searchInput.closest("form");
      const applyFilter = () => {
        const rows = [...form.querySelectorAll("[data-relation-option]")];
        let visible = 0;
        rows.forEach((row) => { const matches = matchesSearch(row.textContent, searchInput.value); row.hidden = !matches; if (matches) visible++; });
        const empty = form.querySelector("[data-link-empty]");
        if (empty) empty.hidden = visible !== 0 || rows.length === 0;
      };
      searchInput.addEventListener("input", applyFilter);
      if (searchInput.value) applyFilter(); // busca pré-preenchida (ex.: Liveshop do alerta) já filtra ao abrir
    });

    const form = modal.querySelector("[data-bot-associate-form]");
    form?.addEventListener("submit", (submitEvent) => guardedSubmit(form, submitEvent, async () => {
      const numberId = new FormData(form).get("numberId");
      if (!numberId) { showToast("Selecione um número.", "error"); return; }
      try {
        await this.service.associateNumber(event.id, numberId, event);
        showToast("Número associado — pipeline reprocessado.", "success");
        modal.remove();
        await this.render();
      } catch (error) { showToast(error.message, "error"); }
    }));

    const linkCampaignForm = modal.querySelector("[data-bot-link-campaign-form]");
    linkCampaignForm?.addEventListener("submit", (submitEvent) => guardedSubmit(linkCampaignForm, submitEvent, async () => {
      const campaignId = new FormData(linkCampaignForm).get("campaignId");
      if (!campaignId) { showToast("Selecione uma campanha.", "error"); return; }
      try {
        await this.service.linkToCampaign(event.id, campaignId, event);
        showToast("Número vinculado à campanha.", "success");
        modal.remove();
        await this.render();
      } catch (error) { showToast(error.message, "error"); }
    }));
  }
}
