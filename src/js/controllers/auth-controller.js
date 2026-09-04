import { renderForgotPassword, renderLogin, renderRegistration, renderResetPassword } from "../ui/auth-view.js";
import { guardedSubmit } from "../ui/form-submit-guard.js";

export class AuthController {
  constructor({ service, root }) { this.service = service; this.root = root; this.mode = "login"; this.message = ""; this.forgotSent = false; }

  async render() {
    this.root.classList.add("is-auth-screen");
    const squads = this.mode === "register" ? await this.service.listActiveSquads() : [];
    this.root.innerHTML =
      this.mode === "register" ? renderRegistration(squads, this.message) :
      this.mode === "forgot" ? renderForgotPassword(this.message, this.forgotSent) :
      this.mode === "reset" ? renderResetPassword(this.message) :
      renderLogin(this.message);
    this.root.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => { this.mode = button.dataset.authMode; this.message = ""; this.forgotSent = false; this.render(); }));
    this.root.querySelector('[data-auth-form="login"]')?.addEventListener("submit", (event) => this.login(event));
    this.root.querySelector('[data-auth-form="register"]')?.addEventListener("submit", (event) => this.register(event));
    this.root.querySelector('[data-auth-form="forgot"]')?.addEventListener("submit", (event) => this.forgotPassword(event));
    this.root.querySelector('[data-auth-form="reset"]')?.addEventListener("submit", (event) => this.updatePassword(event));
    this.bindPasswordToggles();
  }

  bindPasswordToggles() {
    this.root.querySelectorAll("[data-toggle-password]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = button.closest(".password-field")?.querySelector("input");
        if (!input) return;
        const visible = input.type === "text";
        input.type = visible ? "password" : "text";
        button.classList.toggle("is-visible", !visible);
        button.setAttribute("aria-pressed", String(!visible));
        button.setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
      });
    });
  }

  async login(event) {
    const form = event.currentTarget;
    guardedSubmit(form, event, async () => {
      try { await this.service.signIn(...["email", "password"].map((name) => form.elements[name].value)); window.location.reload(); }
      catch (error) { this.message = error.message || "Não foi possível entrar."; await this.render(); }
    });
  }

  async register(event) {
    const form = event.currentTarget;
    guardedSubmit(form, event, async () => {
      try {
        await this.service.register(Object.fromEntries(new FormData(form)));
        this.mode = "login";
        this.message = "Cadastro realizado. Confirme o e-mail, se solicitado, e faça login.";
        await this.render();
      } catch (error) { this.message = error.message || "Não foi possível criar a conta."; await this.render(); }
    });
  }

  async forgotPassword(event) {
    const form = event.currentTarget;
    guardedSubmit(form, event, async () => {
      const email = form.elements.email.value;
      try { await this.service.requestPasswordReset(email); }
      catch { /* não revela se o e-mail existe ou não */ }
      this.forgotSent = true;
      this.message = "";
      await this.render();
    });
  }

  async updatePassword(event) {
    const form = event.currentTarget;
    guardedSubmit(form, event, async () => {
      const password = form.elements.password.value;
      const passwordConfirm = form.elements.passwordConfirm.value;
      if (password !== passwordConfirm) { this.message = "As senhas não coincidem."; await this.render(); return; }
      try {
        await this.service.updatePassword(password);
        window.location.hash = "";
        window.location.reload();
      } catch (error) { this.message = error.message || "Não foi possível atualizar a senha."; await this.render(); }
    });
  }

  bindLogout(button) {
    button.hidden = false;
    button.addEventListener("click", async () => { await this.service.signOut(); window.location.hash = ""; window.location.reload(); });
  }
}
