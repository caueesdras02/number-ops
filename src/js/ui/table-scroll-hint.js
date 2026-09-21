// Melhoria só de UX mobile pras tabelas com scroll horizontal (.table-scroll, já usado em
// Campanhas, Bot, Usuários e Log de Atividades) — nunca muda a tabela, os dados ou o
// comportamento em desktop (tudo escondido por CSS acima do breakpoint mobile, ver
// components.css). Acrescenta uma dica discreta ("Deslize para ver mais →") acima da tabela e um
// fade nas bordas esquerda/direita que reflete se ainda há conteúdo pra revelar naquele lado.
//
// Observa #page-content via MutationObserver em vez de ser chamado por cada controller: todo
// controller já substitui o innerHTML inteiro a cada render() (ver campaigns/bot/profiles/audit
// controllers), então reagir a inserções cobre automaticamente qualquer tabela nova, atual ou
// futura, sem precisar lembrar de conectar isso em cada tela.

function updateFadeVisibility(scrollEl, fadeStart, fadeEnd) {
  const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
  fadeStart.classList.toggle("is-visible", scrollEl.scrollLeft > 1);
  fadeEnd.classList.toggle("is-visible", scrollEl.scrollLeft < maxScroll - 1);
}

function enhance(scrollEl) {
  if (scrollEl.dataset.scrollHintBound === "true") return;
  // Sem conteúdo escondido (coube inteira), não precisa de dica nem fade.
  if (scrollEl.scrollWidth <= scrollEl.clientWidth + 1) return;
  scrollEl.dataset.scrollHintBound = "true";

  const wrap = document.createElement("div");
  wrap.className = "table-scroll-wrap";
  scrollEl.parentNode.insertBefore(wrap, scrollEl);
  wrap.appendChild(scrollEl);

  // A dica fica FORA do wrap posicionado (que só envolve a própria .table-scroll) pra nunca
  // disputar espaço visual com o fade das bordas nem cobrir a tabela.
  const hint = document.createElement("p");
  hint.className = "table-scroll-hint";
  hint.setAttribute("aria-hidden", "true");
  hint.textContent = "Deslize para ver mais →";
  wrap.parentNode.insertBefore(hint, wrap);

  const fadeStart = document.createElement("div");
  fadeStart.className = "table-scroll-fade table-scroll-fade-start";
  fadeStart.setAttribute("aria-hidden", "true");
  const fadeEnd = document.createElement("div");
  fadeEnd.className = "table-scroll-fade table-scroll-fade-end";
  fadeEnd.setAttribute("aria-hidden", "true");
  wrap.append(fadeStart, fadeEnd);

  updateFadeVisibility(scrollEl, fadeStart, fadeEnd);

  let hintDismissed = false;
  scrollEl.addEventListener(
    "scroll",
    () => {
      updateFadeVisibility(scrollEl, fadeStart, fadeEnd);
      if (!hintDismissed && scrollEl.scrollLeft > 4) {
        hintDismissed = true;
        hint.classList.add("is-dismissed");
      }
    },
    { passive: true },
  );
}

function scan(node) {
  if (node.nodeType !== 1) return;
  if (node.matches?.(".table-scroll")) enhance(node);
  node.querySelectorAll?.(".table-scroll").forEach(enhance);
}

/** Liga a observação num container estável (ex.: #page-content) — não precisa ser chamado de
 * novo a cada render(), continua funcionando pra qualquer tabela inserida depois. */
export function observeTableScrollHints(root) {
  if (!root) return null;
  scan(root);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) mutation.addedNodes.forEach(scan);
  });
  observer.observe(root, { childList: true, subtree: true });
  return observer;
}
