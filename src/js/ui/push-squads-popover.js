// Popover "Notificar só de Squads" — mesmo padrão de portal-pro-body/posicionamento do
// stage-dropdown.js (reaproveita computeMenuPosition), mas fica aberto enquanto marca/desmarca
// (não fecha a cada clique, diferente do menu de Etapa que é single-select). Preferência é do
// DISPOSITIVO atual (ver PushService.getSquadPreference/setSquadPreference) — sem nenhum Squad
// marcado, continua notificando de tudo (padrão de hoje, nunca muda sozinho).
import { computeMenuPosition } from "./stage-dropdown.js";
import { escapeHtml } from "./number-presentation.js";
import { showToast } from "./toast.js";

let active = null;

function closeActive() {
  if (!active) return;
  const { menu, trigger, cleanup } = active;
  menu.remove();
  trigger.setAttribute("aria-expanded", "false");
  cleanup();
  active = null;
}

export function isPushSquadsMenuOpenFor(trigger) {
  return active?.trigger === trigger;
}

function position(menu, trigger) {
  const triggerRect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const { top, left } = computeMenuPosition(triggerRect, { width: menuRect.width, height: menuRect.height }, { width: window.innerWidth, height: window.innerHeight });
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

/**
 * @param {HTMLElement} trigger
 * @param {{ squads: Array<{id:string,name:string}>, service: import("../services/push-service.js").PushService }} options
 */
export async function openPushSquadsMenu(trigger, { squads, service }) {
  closeActive();

  const menu = document.createElement("div");
  menu.className = "stage-menu push-squads-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Notificar só destes squads");
  menu.innerHTML = `<p class="push-squads-menu-hint">Carregando…</p>`;
  document.body.appendChild(menu);
  position(menu, trigger);
  trigger.setAttribute("aria-expanded", "true");

  let selected = new Set();
  try { selected = new Set(await service.getSquadPreference()); }
  catch { /* mantém vazio (notifica de tudo) se a leitura falhar */ }

  // Título fixo explica o PROPÓSITO; a linha de status (dinâmica) sempre reflete o estado ATUAL
  // — nunca precisa da ressalva "(vazio = todos os Squads)" espalhada no texto instrucional, o
  // próprio status já diz isso quando é o caso.
  const paint = () => {
    const selectedNames = squads.filter((squad) => selected.has(squad.id)).map((squad) => escapeHtml(squad.name));
    const statusLine = selectedNames.length
      ? `Recebendo só de: <strong>${selectedNames.join(", ")}</strong>`
      : `Recebendo de <strong>todos os Squads</strong>`;
    menu.innerHTML = `<p class="push-squads-menu-hint">Filtrar notificações por Squad</p><p class="push-squads-menu-status">${statusLine}</p>`
      + (squads.length
        ? squads.map((squad) => `<label class="push-squads-menu-option"><input type="checkbox" value="${squad.id}" ${selected.has(squad.id) ? "checked" : ""}><span>${escapeHtml(squad.name)}</span></label>`).join("")
        : `<p class="push-squads-menu-empty">Nenhum Squad ativo cadastrado.</p>`)
      + `<button type="button" class="button button-quiet push-squads-menu-clear" ${selected.size ? "" : "disabled"}>Notificar de todos os Squads</button>`;
    position(menu, trigger);
  };
  paint();

  const onChange = async (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    if (checkbox.checked) selected.add(checkbox.value); else selected.delete(checkbox.value);
    try { await service.setSquadPreference([...selected]); } catch (error) { showToast(error.message, "error"); }
    paint();
  };
  const onClick = async (event) => {
    if (!event.target.closest(".push-squads-menu-clear")) return;
    selected = new Set();
    try { await service.setSquadPreference([]); showToast("Voltou a notificar de todos os Squads.", "info"); } catch (error) { showToast(error.message, "error"); }
    paint();
  };
  const onDocPointerDown = (event) => { if (!menu.contains(event.target) && event.target !== trigger) closeActive(); };
  const onKeydown = (event) => { if (event.key === "Escape") { closeActive(); trigger.focus(); } };
  const onScrollOrResize = () => closeActive();

  menu.addEventListener("change", onChange);
  menu.addEventListener("click", onClick);
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeydown, true);
  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize);

  active = {
    menu, trigger,
    cleanup: () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    },
  };
}

export function closeActivePushSquadsMenu() { closeActive(); }
