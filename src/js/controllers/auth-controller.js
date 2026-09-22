import { renderEmailConfirmError, renderEmailConfirmed, renderForgotPassword, renderLogin, renderRegistration, renderResetPassword } from "../ui/auth-view.js";
import { guardedSubmit } from "../ui/form-submit-guard.js";
import { bindThemeToggles } from "../ui/theme-toggle.js";

const NOT_AUTHORIZED_MESSAGE = "E-mail não autorizado\n\nEste e-mail não está registrado como colaborador do Number Ops. Solicite acesso ao administrador responsável.";

export class AuthController {
  constructor({ service, root }) { this.service = service; this.root = root; this.mode = "login"; this.message = ""; this.forgotSent = false; }

  async render() {
    this.root.classList.add("is-auth-screen");
    this.root.innerHTML =
      this.mode === "register" ? renderRegistration(this.message) :
      this.mode === "forgot" ? renderForgotPassword(this.message, this.forgotSent) :
      this.mode === "reset" ? renderResetPassword(this.message) :
      this.mode === "confirmed" ? renderEmailConfirmed(this.message) :
      this.mode === "confirm-error" ? renderEmailConfirmError(this.message) :
      renderLogin(this.message);
    this.root.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => { this.mode = button.dataset.authMode; this.message = ""; this.forgotSent = false; this.render(); }));
    this.root.querySelector('[data-auth-form="login"]')?.addEventListener("submit", (event) => this.login(event));
    this.root.querySelector('[data-auth-form="register"]')?.addEventListener("submit", (event) => this.register(event));
    this.root.querySelector('[data-auth-form="forgot"]')?.addEventListener("submit", (event) => this.forgotPassword(event));
    this.root.querySelector('[data-auth-form="reset"]')?.addEventListener("submit", (event) => this.updatePassword(event));
    this.bindPasswordToggles();
    if (this.mode === "register") this.bindEmailAuthorizationCheck();
    bindThemeToggles(this.root);
  }

  /**
   * Checagem antecipada de UX (feedback assim que a pessoa sai do campo de
   * e-mail): não é a proteção real — só evita preencher o resto do
   * formulário para descobrir depois que o e-mail não foi autorizado. Quem
   * bloqueia de verdade é o handle_new_user() no banco (019), inclusive
   * contra chamadas diretas ao Supabase que pulem esta tela inteira.
   */
  bindEmailAuthorizationCheck() {
    const form = this.root.querySelector('[data-auth-form="register"]');
    const emailInput = form?.elements.email;
    const hint = form?.querySelector("[data-email-auth-hint]");
    if (!emailInput || !hint) return;
    emailInput.addEventListener("blur", async () => {
      const email = emailInput.value.trim();
      if (!email || !email.includes("@")) { hint.hidden = true; return; }
      let authorized = true;
      try { authorized = await this.service.isEmailAuthorized(email); } catch { return; }
      hint.hidden = authorized;
      hint.textContent = authorized ? "" : "Este e-mail ainda não foi autorizado. Solicite acesso ao administrador responsável.";
    });
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
      const values = Object.fromEntries(new FormData(form));
      try {
        if ((await this.service.isEmailAuthorized(values.email)) === false) {
          this.message = NOT_AUTHORIZED_MESSAGE;
          await this.render();
          return;
        }
      } catch { /* RPC indisponível: não bloqueia no cliente — o backend (handle_new_user) decide */ }
      try {
        await this.service.register(values);
        this.mode = "login";
        this.message = "Cadastro realizado. Confirme o e-mail, se solicitado, e faça login.";
        await this.render();
      } catch (error) { this.message = /não autorizado/i.test(error.message || "") ? NOT_AUTHORIZED_MESSAGE : (error.message || "Não foi possível criar a conta."); await this.render(); }
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
