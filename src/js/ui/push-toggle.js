// Liga o sino de notificação ("Número caiu"), o ícone informativo (data-push-info) e o gatilho de
// preferência de Squad (data-push-squads-trigger) no topbar ao PushService — espelha
// theme-toggle.js. Preferência pessoal por dispositivo: disponível pra qualquer cargo (inclusive
// VIEWER), sem RBAC. O sino é o ÚNICO botão que ativa/desativa notificações — os outros dois nunca
// ativam/desativam nada (um só explica, o outro só escolhe QUAIS Squads notificar).
import { showToast } from "./toast.js";
import { openPushSquadsMenu, isPushSquadsMenuOpenFor, closeActivePushSquadsMenu } from "./push-squads-popover.js";

function syncElements(button, info, squadsTrigger, state) {
  const subscribed = state === "subscribed";
  const hideEverything = state === "unavailable" || state === "unsupported";
  button.hidden = hideEverything;
  button.classList.toggle("is-blocked", state === "denied");
  if (info) info.hidden = hideEverything;
  // Preferência de Squad só faz sentido com notificação ATIVA neste dispositivo — sem isso não
  // há em qual inscrição gravar a preferência (ver PushService.currentSubscriptionRow).
  if (squadsTrigger) squadsTrigger.hidden = hideEverything || !subscribed;
  button.setAttribute("aria-pressed", String(subscribed));
  button.setAttribute(
    "aria-label",
    subscribed ? "Desativar notificação de número caiu" : state === "denied" ? "Notificações bloqueadas pelo navegador — clique no ⓘ ao lado para saber mais" : "Ativar notificação de número caiu",
  );
  button.title = subscribed
    ? "Notificações ativadas — avisamos quando um número cair"
    : state === "denied"
      ? "Bloqueado nas configurações do navegador"
      : "Ativar notificação de número caiu (funciona melhor após adicionar à tela de início no celular)";
  const icon = button.querySelector("[data-push-icon]");
  if (icon) icon.textContent = subscribed ? "🔔" : "🔕";
}

/** Ativa/desativa a inscrição, mostra feedback por toast (nunca alert()/confirm() nativo) e
 * resincroniza o sino. Único caminho de ativação/desativação — os outros dois botões não chamam isso. */
async function toggle(service, button, info, squadsTrigger) {
  button.disabled = true;
  try {
    const state = await service.status();
    if (state === "subscribed") {
      await service.unsubscribe();
      showToast("Notificações desativadas.", "info");
      closeActivePushSquadsMenu();
    } else if (state === "unsupported") {
      showToast("Este navegador ou dispositivo não é compatível com notificações push.", "error");
    } else {
      // Cobre "unsubscribed" (nunca perguntado) e "denied" (bloqueado) — subscribe() já lança
      // a mensagem certa pra cada caso, sem duplicar essa distinção aqui.
      await service.subscribe();
      showToast("Notificações ativadas — vamos avisar quando um número cair.", "success");
    }
  } catch (error) {
    showToast(error.message || "Não foi possível alterar a notificação agora.", "error");
  } finally {
    syncElements(button, info, squadsTrigger, await service.status());
    button.disabled = false;
  }
}

/** Explica o que a notificação faz — nunca ativa/desativa nada, só informa. Quando bloqueada
 * pelo navegador (denied), orienta isso especificamente em vez da explicação genérica. */
async function explain(service) {
  const state = await service.status();
  if (state === "denied") {
    showToast("As notificações estão bloqueadas nas configurações do navegador para este site. Permita notificações no navegador para poder ativar.", "info");
  } else {
    showToast("As notificações avisam quando um número cair (ficar indisponível), pra você agir rápido.", "info");
  }
}

/** Liga [data-push-toggle] (sino, único controle de ativar/desativar), [data-push-info] (ícone
 * informativo) e [data-push-squads-trigger] (preferência de Squad, opcional) ao PushService
 * informado. `squads` é a lista de Squads ativos pra oferecer no popover de preferência. */
export function bindPushToggle(service, { squads = [] } = {}, root = document) {
  const info = root.querySelector("[data-push-info]");
  const squadsTrigger = root.querySelector("[data-push-squads-trigger]");
  root.querySelectorAll("[data-push-toggle]").forEach((button) => {
    if (button.dataset.pushBound === "true") return;
    button.dataset.pushBound = "true";

    if (!service?.available) { syncElements(button, info, squadsTrigger, "unavailable"); return; }

    service.status().then((state) => syncElements(button, info, squadsTrigger, state));
    button.addEventListener("click", () => toggle(service, button, info, squadsTrigger));
  });
  if (info && info.dataset.pushBound !== "true" && service?.available) {
    info.dataset.pushBound = "true";
    info.addEventListener("click", () => explain(service));
  }
  if (squadsTrigger && squadsTrigger.dataset.pushBound !== "true" && service?.available && service.squadPreferenceAvailable) {
    squadsTrigger.dataset.pushBound = "true";
    squadsTrigger.addEventListener("click", () => {
      if (isPushSquadsMenuOpenFor(squadsTrigger)) { closeActivePushSquadsMenu(); return; }
      openPushSquadsMenu(squadsTrigger, { squads, service });
    });
  }
}
