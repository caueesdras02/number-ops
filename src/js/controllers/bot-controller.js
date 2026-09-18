import { renderBotCentral, renderBotEventDetail } from "../ui/bot-view.js";
import { escapeHtml } from "../ui/number-presentation.js";
import { showToast } from "../ui/toast.js";
import { guardedSubmit } from "../ui/form-submit-guard.js";

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
    this.content.insertAdjacentHTML("beforeend", renderBotEventDetail(event, { canModify: this.data.canModify, availableNumbers }));
    const modal = this.content.querySelector("[data-bot-modal]");
    const close = () => modal?.remove();
    modal?.querySelector('[data-action="close-bot-detail"]')?.addEventListener("click", close);
    modal?.addEventListener("click", (clickEvent) => { if (clickEvent.target === modal) close(); });
    this.bindNavigationLinks(modal);
    this.bindDetailActions(modal, event);
  }

  bindDetailActions(modal, event) {
    if (!modal) return;

    modal.querySelector('[data-action="bot-mark-not-owned"]')?.addEventListener("click", async () => {
      if (!window.confirm(`Marcar ${event.phoneNormalized || "este telefone"} como não pertencente à operação? O evento continuará no histórico, mas deixará de contar como pendente. Alertas futuros deste mesmo telefone serão ignorados automaticamente.`)) return;
      try {
        await this.service.markNotOwned(event.id, event);
        showToast("Telefone classificado como não pertencente à operação.", "success");
        modal.remove();
        await this.render();
      } catch (error) { showToast(error.message, "error"); }
    });

    modal.querySelector('[data-action="bot-revert-not-owned"]')?.addEventListener("click", async (clickEvent) => {
      const externalId = clickEvent.currentTarget.dataset.externalId;
      if (!window.confirm("Reverter a classificação de externo? Novos alertas deste telefone voltarão a ficar pendentes de associação.")) return;
      try {
        await this.service.revertNotOwned(externalId);
        showToast("Classificação de externo revertida.", "success");
        modal.remove();
        await this.render();
      } catch (error) { showToast(error.message, "error"); }
    });

    const form = modal.querySelector("[data-bot-associate-form]");
    form?.querySelector("[data-link-search]")?.addEventListener("input", (inputEvent) => {
      const query = inputEvent.target.value.trim().toLocaleLowerCase("pt-BR");
      const rows = [...form.querySelectorAll("[data-relation-option]")];
      let visible = 0;
      rows.forEach((row) => { const matches = !query || row.textContent.toLocaleLowerCase("pt-BR").includes(query); row.hidden = !matches; if (matches) visible++; });
      const empty = form.querySelector("[data-link-empty]");
      if (empty) empty.hidden = visible !== 0 || rows.length === 0;
    });
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
  }
}
