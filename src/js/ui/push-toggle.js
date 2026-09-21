// Liga o botão de notificação ("Número caiu") no topbar ao PushService —
// espelha theme-toggle.js. Preferência pessoal por dispositivo: disponível
// pra qualquer cargo (inclusive VIEWER), sem RBAC.
function syncButton(button, state) {
  const subscribed = state === "subscribed";
  button.hidden = state === "unavailable";
  button.setAttribute("aria-pressed", String(subscribed));
  button.setAttribute("aria-label", subscribed ? "Desativar notificação de número caiu" : "Ativar notificação de número caiu");
  button.title = subscribed
    ? "Notificações ativadas — avisamos quando um número cair"
    : "Ativar notificação de número caiu (funciona melhor após adicionar à tela de início no celular)";
  const icon = button.querySelector("[data-push-icon]");
  if (icon) icon.textContent = subscribed ? "🔔" : "🔕";
}

/** Liga qualquer [data-push-toggle] presente no DOM ao PushService informado. */
export function bindPushToggle(service, root = document) {
  root.querySelectorAll("[data-push-toggle]").forEach((button) => {
    if (button.dataset.pushBound === "true") return;
    button.dataset.pushBound = "true";

    if (!service?.available) { syncButton(button, "unavailable"); return; }

    service.status().then((state) => syncButton(button, state));

    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const state = await service.status();
        if (state === "subscribed") await service.unsubscribe();
        else await service.subscribe();
        syncButton(button, await service.status());
      } catch (error) {
        window.alert?.(error.message || "Não foi possível alterar a notificação agora.");
      } finally {
        button.disabled = false;
      }
    });
  });
}
