import { renderLogin, renderRegistration } from "../ui/auth-view.js";

export class AuthController {
  constructor({ service, root }) { this.service = service; this.root = root; this.mode = "login"; this.message = ""; }

  async render() {
    this.root.classList.add("is-auth-screen");
    const squads = this.mode === "register" ? await this.service.listActiveSquads() : [];
    this.root.innerHTML = this.mode === "register" ? renderRegistration(squads, this.message) : renderLogin(this.message);
    this.root.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => { this.mode = button.dataset.authMode; this.message = ""; this.render(); }));
    this.root.querySelector('[data-auth-form="login"]')?.addEventListener("submit", (event) => this.login(event));
    this.root.querySelector('[data-auth-form="register"]')?.addEventListener("submit", (event) => this.register(event));
  }

  async login(event) {
    event.preventDefault();
    try { await this.service.signIn(...["email", "password"].map((name) => event.currentTarget.elements[name].value)); window.location.reload(); }
    catch (error) { this.message = error.message || "Não foi possível entrar."; await this.render(); }
  }

  async register(event) {
    event.preventDefault();
    try {
      await this.service.register(Object.fromEntries(new FormData(event.currentTarget)));
      this.mode = "login";
      this.message = "Cadastro realizado. Confirme o e-mail, se solicitado, e faça login.";
      await this.render();
    } catch (error) { this.message = error.message || "Não foi possível criar a conta."; await this.render(); }
  }

  bindLogout(button) {
    button.hidden = false;
    button.addEventListener("click", async () => { await this.service.signOut(); window.location.hash = ""; window.location.reload(); });
  }
}
