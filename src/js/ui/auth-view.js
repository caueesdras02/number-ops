import { escapeHtml } from "./number-presentation.js";

const BRAND = "./src/assets/number-ops.png";
const brandImg = (cls = "") => `<img class="${cls}" src="${BRAND}" alt="Live Shop Turbo">`;
const themeToggle = () => `<button type="button" class="theme-toggle auth-theme-toggle" data-theme-toggle aria-pressed="false" aria-label="Alternar tema"><span data-theme-icon aria-hidden="true">☀</span></button>`;
export const authMobileBrand = () => `<div class="auth-mobile-brand">${brandImg()}</div>`;

const authShell = (content) => `<main class="auth-page">${themeToggle()}<section class="auth-layout"><aside class="auth-brand-panel">${brandImg()}<div><p class="eyebrow">Operação conectada</p><h2>Números sob controle.<br>Equipe em sintonia.</h2><p>Uma visão segura e compartilhada da operação da Live Shop Turbo, protegida por autenticação.</p></div><ul><li><span>✓</span> Dados centralizados</li><li><span>✓</span> Acesso por perfil</li><li><span>✓</span> Histórico preservado</li></ul><small>Number Ops · Live Shop Turbo</small></aside><section class="auth-card">${content}</section></section></main>`;

function passwordField(label, name, { autocomplete = "current-password", minlength = "", placeholder = "Sua senha" } = {}) {
  return `<label>${label}<div class="password-field"><input class="input" name="${name}" type="password" autocomplete="${autocomplete}" placeholder="${placeholder}" ${minlength ? `minlength="${minlength}"` : ""} required><button type="button" class="password-toggle" data-toggle-password aria-label="Mostrar senha" aria-pressed="false"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><line class="password-toggle-slash" x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div></label>`;
}

export function renderLogin(message = "") {
  return authShell(`${authMobileBrand()}<p class="eyebrow">Acesso seguro</p><h1>Bem-vindo ao Number Ops</h1><p class="auth-intro">Centralize e acompanhe a operação dos números em um só lugar.</p>${message ? `<div class="auth-message" role="alert">${escapeHtml(message)}</div>` : ""}<form data-auth-form="login"><label>E-mail<input class="input" name="email" type="email" autocomplete="email" placeholder="voce@empresa.com" required></label>${passwordField("Senha", "password")}<button class="auth-forgot-link" type="button" data-auth-mode="forgot">Esqueci minha senha</button><button class="button button-primary auth-submit" type="submit">Entrar com segurança <span>→</span></button><button class="button button-quiet" type="button" data-auth-mode="register">Criar uma conta</button></form><p class="auth-footnote">Sua sessão permanece protegida pelo Supabase Auth.</p>`);
}

export function renderRegistration(message = "") {
  return authShell(`${authMobileBrand()}<p class="eyebrow">Novo acesso</p><h1>Criar conta</h1><p class="auth-intro">Seu cadastro só é concluído se este e-mail tiver sido autorizado por um administrador. Nível de acesso e Squad já vêm definidos por essa autorização.</p>${message ? `<div class="auth-message" role="alert">${escapeHtml(message)}</div>` : ""}<form data-auth-form="register"><div class="auth-form-grid"><label>Nome<input class="input" name="name" autocomplete="name" placeholder="Nome completo" required></label><label>E-mail<input class="input" name="email" type="email" autocomplete="email" placeholder="voce@empresa.com" required><small class="form-hint" data-email-auth-hint hidden></small></label>${passwordField("Senha", "password", { autocomplete: "new-password", minlength: "8", placeholder: "Mínimo de 8 caracteres" })}<label class="auth-form-wide">Cargo<select class="input" name="jobTitle" required><option value="">Selecione</option><option value="ANALYST">Analista</option><option value="ACCOUNT_MANAGER">Gerente de Contas</option></select></label></div><button class="button button-primary auth-submit" type="submit">Cadastrar com segurança <span>→</span></button><button class="button button-quiet" type="button" data-auth-mode="login">Voltar ao login</button></form>`);
}

export function renderForgotPassword(message = "", sent = false) {
  return authShell(`${authMobileBrand()}<p class="eyebrow">Recuperar acesso</p><h1>Esqueci minha senha</h1><p class="auth-intro">${sent ? "Se o e-mail estiver cadastrado, enviamos um link para redefinir sua senha." : "Informe seu e-mail para receber um link de redefinição de senha."}</p>${message ? `<div class="auth-message" role="alert">${escapeHtml(message)}</div>` : ""}${sent ? `<button class="button button-quiet" type="button" data-auth-mode="login">Voltar ao login</button>` : `<form data-auth-form="forgot"><label>E-mail<input class="input" name="email" type="email" autocomplete="email" placeholder="voce@empresa.com" required></label><button class="button button-primary auth-submit" type="submit">Enviar link de redefinição <span>→</span></button><button class="button button-quiet" type="button" data-auth-mode="login">Voltar ao login</button></form>`}`);
}

export function renderEmailConfirmed(message = "") {
  return authShell(`${authMobileBrand()}<p class="eyebrow">Conta confirmada</p><h1>E-mail confirmado com sucesso!</h1><p class="auth-intro">Sua conta já está ativa. Você já pode voltar ao Number Ops e fazer login.</p>${message ? `<div class="auth-message" role="alert">${escapeHtml(message)}</div>` : ""}<button class="button button-primary auth-submit" type="button" data-auth-mode="login">Voltar para o login <span>→</span></button>`);
}

export function renderEmailConfirmError(message = "") {
  return authShell(`${authMobileBrand()}<p class="eyebrow">Link inválido</p><h1>Não foi possível confirmar</h1><p class="auth-intro">${message ? escapeHtml(message) : "O link de confirmação é inválido ou já expirou."}</p><button class="button button-primary auth-submit" type="button" data-auth-mode="login">Voltar para o login <span>→</span></button><button class="button button-quiet" type="button" data-auth-mode="forgot">Recuperar acesso</button>`);
}

export function renderResetPassword(message = "") {
  return authShell(`${authMobileBrand()}<p class="eyebrow">Recuperar acesso</p><h1>Defina uma nova senha</h1><p class="auth-intro">Escolha uma nova senha para continuar.</p>${message ? `<div class="auth-message" role="alert">${escapeHtml(message)}</div>` : ""}<form data-auth-form="reset">${passwordField("Nova senha", "password", { autocomplete: "new-password", minlength: "8", placeholder: "Mínimo de 8 caracteres" })}${passwordField("Confirmar nova senha", "passwordConfirm", { autocomplete: "new-password", minlength: "8", placeholder: "Repita a nova senha" })}<button class="button button-primary auth-submit" type="submit">Salvar nova senha <span>→</span></button></form>`);
}
