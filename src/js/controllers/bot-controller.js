import { renderBotCentral, renderBotEventDetail } from "../ui/bot-view.js";
import { escapeHtml } from "../ui/number-presentation.js";

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
    this.content.insertAdjacentHTML("beforeend", renderBotEventDetail(event));
    const modal = this.content.querySelector("[data-bot-modal]");
    const close = () => modal?.remove();
    modal?.querySelector('[data-action="close-bot-detail"]')?.addEventListener("click", close);
    modal?.addEventListener("click", (clickEvent) => { if (clickEvent.target === modal) close(); });
    this.bindNavigationLinks(modal);
  }
}
