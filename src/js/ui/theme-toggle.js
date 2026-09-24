// Tema claro/escuro. Preferência apenas visual (localStorage) — não é dado operacional.
const STORAGE_KEY = "numberOpsTheme";
const THEMES = ["light", "dark"];

export function readStoredTheme() {
  try { const value = localStorage.getItem(STORAGE_KEY); return THEMES.includes(value) ? value : null; } catch { return null; }
}

export function currentTheme() {
  return document.documentElement.dataset.theme
    || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

// Mesmas cores de --color-canvas em tokens.css (claro/escuro) — o PWA instalado e a barra do
// navegador mobile usam este valor, não o CSS, então precisam ser sincronizados manualmente.
const THEME_COLORS = { light: "#f4f7f5", dark: "#0b1512" };

export function applyTheme(theme) {
  const next = THEMES.includes(theme) ? theme : "light";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* armazenamento indisponível */ }
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => syncButton(button, next));
  document.getElementById("meta-theme-color")?.setAttribute("content", THEME_COLORS[next]);
  return next;
}

function syncButton(button, theme) {
  const dark = theme === "dark";
  button.setAttribute("aria-pressed", String(dark));
  button.setAttribute("aria-label", dark ? "Ativar modo claro" : "Ativar modo escuro");
  button.title = dark ? "Modo claro" : "Modo escuro";
  const icon = button.querySelector("[data-theme-icon]");
  if (icon) icon.textContent = dark ? "☾" : "☀";
}

/** Aplica a preferência salva (o script anti-flash no <head> já fez isso; aqui garante consistência). */
export function initTheme() {
  applyTheme(readStoredTheme() ?? currentTheme());
}

/** Liga qualquer [data-theme-toggle] presente no DOM. */
export function bindThemeToggles(root = document) {
  root.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    if (button.dataset.themeBound === "true") return;
    button.dataset.themeBound = "true";
    syncButton(button, currentTheme());
    button.addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark"));
  });
}
