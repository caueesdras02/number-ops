// Contador de alertas pendentes ("Sem número associado") da Central Number Ops Bot, visível no
// item do menu lateral — dá pra ver quantos estão esperando sem precisar entrar na aba. No
// celular o menu fica escondido, então o botão de abrir o menu ganha um ponto de aviso também.

export function formatBadgeCount(count) {
  const value = Number(count) || 0;
  return value > 99 ? "99+" : String(value);
}

export function renderBotNavBadge(count) {
  const value = Number(count) || 0;
  if (value <= 0) return "";
  const label = `${value} ${value === 1 ? "alerta pendente" : "alertas pendentes"} sem número associado`;
  return `<span class="nav-badge" data-bot-nav-badge role="status" aria-label="${label}" title="${label}">${formatBadgeCount(value)}</span>`;
}

/** Atualiza (ou remove) o contador no link do menu e o ponto no botão do menu mobile. */
export function updateBotNavBadge(count, root = document) {
  const link = root.querySelector('.navigation-link[data-view="bot"]');
  if (link) {
    link.querySelector("[data-bot-nav-badge]")?.remove();
    const html = renderBotNavBadge(count);
    if (html) link.insertAdjacentHTML("beforeend", html);
  }
  root.querySelector("[data-mobile-nav-toggle]")?.classList.toggle("has-pending-alerts", (Number(count) || 0) > 0);
}

/**
 * Mantém o contador atualizado: busca agora, a cada `intervalMs` e quando a aba volta a ficar
 * visível. Falha de rede nunca quebra o app — só mantém o último valor mostrado.
 * Devolve `refresh` pra quem quiser forçar (ex.: a própria Central depois de uma ação).
 */
export function startBotNavBadge(fetchCount, { intervalMs = 60000, root = document, win = globalThis.window } = {}) {
  let running = false;
  const refresh = async () => {
    if (running) return;
    running = true;
    try { updateBotNavBadge(await fetchCount(), root); } catch { /* mantém o último valor */ } finally { running = false; }
  };
  refresh();
  if (win?.setInterval) win.setInterval(refresh, intervalMs);
  root.addEventListener?.("visibilitychange", () => { if (root.visibilityState !== "hidden") refresh(); });
  return refresh;
}
