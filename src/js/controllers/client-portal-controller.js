import { renderClientPortal, renderClientPortalError } from "../ui/client-portal-view.js";

/**
 * Portal do cliente. Dois usos:
 * - acesso CLIENT: é a única tela do app (sem menu interno), atualiza sozinha a cada 2 min;
 * - MASTER/ADMIN: rota #client-portal/<clienteId>, pré-visualização do que o cliente vê.
 */
export class ClientPortalController {
  constructor({ service, content, autoRefreshMs = 120000, win = globalThis.window }) {
    this.service = service; this.content = content; this.autoRefreshMs = autoRefreshMs; this.win = win;
    this.clientId = null; this.preview = false; this.timer = null;
  }

  async render(clientId = null, { preview = false } = {}) {
    this.clientId = clientId; this.preview = preview;
    try {
      const view = await this.service.load(clientId);
      this.content.innerHTML = renderClientPortal(view, { preview });
    } catch (error) {
      this.content.innerHTML = renderClientPortalError(error.message);
    }
    this.content.querySelector('[data-action="portal-refresh"]')?.addEventListener("click", () => this.render(this.clientId, { preview: this.preview }));
  }

  /** Só para o acesso CLIENT (a pré-visualização não fica atualizando sozinha em segundo plano). */
  startAutoRefresh() {
    if (this.timer || !this.win?.setInterval) return;
    this.timer = this.win.setInterval(() => { if (globalThis.document?.visibilityState !== "hidden") this.render(this.clientId, { preview: this.preview }); }, this.autoRefreshMs);
  }
}
