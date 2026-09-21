// Liga o sino de notificação ("Número caiu") e o ícone informativo ao lado (data-push-info) no
// topbar ao PushService — espelha theme-toggle.js. Preferência pessoal por dispositivo:
// disponível pra qualquer cargo (inclusive VIEWER), sem RBAC. O sino é o ÚNICO botão que ativa/
// desativa notificações — o ícone informativo nunca ativa/desativa nada, só explica via toast.
import { showToast } from "./toast.js";

function syncElements(button, info, state) {
  const subscribed = state === "subscribed";
  const hideEverything = state === "unavailable" || state === "unsupported";
  button.hidden = hideEverything;
  button.classList.toggle("is-blocked", state === "denied");
  if (info) info.hidden = hideEverything;
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
 * resincroniza o sino. Único caminho de ativação/desativação — o ícone informativo não chama isso. */
async function toggle(service, button, info) {
  button.disabled = true;
  try {
    const state = await service.status();
    if (state === "subscribed") {
      await service.unsubscribe();
      showToast("Notificações desativadas.", "info");
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
    syncElements(button, info, await service.status());
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

/** Liga [data-push-toggle] (sino, único controle de ativar/desativar) e [data-push-info] (ícone
 * informativo, opcional) ao PushService informado. */
export function bindPushToggle(service, root = document) {
  const info = root.querySelector("[data-push-info]");
  root.querySelectorAll("[data-push-toggle]").forEach((button) => {
    if (button.dataset.pushBound === "true") return;
    button.dataset.pushBound = "true";

    if (!service?.available) { syncElements(button, info, "unavailable"); return; }

    service.status().then((state) => syncElements(button, info, state));
    button.addEventListener("click", () => toggle(service, button, info));
  });
  if (info && info.dataset.pushBound !== "true" && service?.available) {
    info.dataset.pushBound = "true";
    info.addEventListener("click", () => explain(service));
  }
}
