// Progressive enhancement genérica pra <select> com muitas opções (Cliente, Squad, Colaborador,
// Localização, Campanha, Número, Usuário...) — acrescenta um campo de busca por texto por cima,
// sem trocar a arquitetura de formulário: o <select> original continua no DOM, com o mesmo
// `name`, `required` e `value`, então FormData(form) e toda a lógica de submit existentes
// continuam funcionando sem qualquer alteração. Marque o select com `data-searchable-select` no
// HTML/template — a ativação em si acontece sozinha via observeSearchableSelects (MutationObserver
// no container estável da página, mesmo padrão de table-scroll-hint.js), então nenhum controller
// precisa chamar nada manualmente pra isso funcionar.
//
// O painel de opções é portado pro <body> (position:fixed), igual a stage-dropdown.js, pra nunca
// ser cortado pelo scroll/overflow de modais — mas é uma peça independente (não reaproveita o
// singleton daquele arquivo), porque aqui a interação é outra: digitar filtra, setas navegam,
// Enter confirma, Esc fecha e desfaz o texto não confirmado, clique fora fecha.
import { matchesSearch } from "../models/search-match.js";

let active = null; // { select, input, listbox, close } — só um combobox aberto por vez

function closeActive() {
  if (!active) return;
  const { listbox, cleanup } = active;
  listbox.remove();
  cleanup();
  active = null;
}

function currentLabel(select) {
  return select.selectedOptions[0]?.textContent?.trim() ?? "";
}

function optionEntries(select) {
  return [...select.options].map((option) => ({ value: option.value, label: option.textContent.trim() }));
}

function computePosition(triggerRect, panelHeight, panelWidth, viewport, gap = 4) {
  const fitsBelow = triggerRect.bottom + gap + panelHeight <= viewport.height;
  const top = fitsBelow ? triggerRect.bottom + gap : Math.max(gap, triggerRect.top - gap - panelHeight);
  const left = Math.min(Math.max(gap, triggerRect.left), Math.max(gap, viewport.width - panelWidth - gap));
  return { top, left };
}

function openListbox(select, input, wrap) {
  closeActive();

  const listbox = document.createElement("ul");
  listbox.className = "searchable-select-listbox";
  listbox.setAttribute("role", "listbox");
  document.body.appendChild(listbox);

  const listboxId = input.getAttribute("aria-controls") || `searchable-select-list-${Math.random().toString(36).slice(2, 9)}`;
  input.setAttribute("aria-controls", listboxId);
  listbox.id = listboxId;

  let activeIndex = -1;
  let visibleEntries = [];

  const position = () => {
    const triggerRect = input.getBoundingClientRect();
    listbox.style.width = `${triggerRect.width}px`;
    const panelHeight = Math.min(listbox.scrollHeight || 240, 280);
    const { top, left } = computePosition(triggerRect, panelHeight, triggerRect.width, { width: window.innerWidth, height: window.innerHeight });
    listbox.style.top = `${top}px`;
    listbox.style.left = `${left}px`;
  };

  const paint = (query) => {
    const all = optionEntries(select);
    visibleEntries = all.filter((entry) => matchesSearch(entry.label, query));
    activeIndex = visibleEntries.length ? 0 : -1;
    listbox.innerHTML = visibleEntries.length
      ? visibleEntries.map((entry, index) => `<li role="option" data-value="${entry.value.replace(/"/g, "&quot;")}" data-index="${index}" aria-selected="${entry.value === select.value}" class="${index === activeIndex ? "is-active" : ""}">${entry.label || "<em>(vazio)</em>"}</li>`).join("")
      : `<li class="searchable-select-empty" role="status">Nenhum resultado encontrado</li>`;
    position();
  };

  const highlight = (index) => {
    activeIndex = index;
    [...listbox.children].forEach((row, i) => row.classList.toggle("is-active", i === activeIndex));
    listbox.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  };

  const commit = (entry) => {
    select.value = entry.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    closeActive();
    // Também atualiza o botão "×" de limpar — selecionar pela lista não passa pelo listener de
    // 'input' do texto (não foi digitado), então precisa ressincronizar explicitamente aqui.
    refreshSearchableSelect(select);
  };

  // mousedown (não click) com preventDefault: garante que a seleção seja confirmada ANTES do
  // input perder foco (blur fecharia a lista antes do click chegar a disparar).
  listbox.addEventListener("mousedown", (event) => {
    const row = event.target.closest("[data-value]");
    if (!row) return;
    event.preventDefault();
    const entry = visibleEntries[Number(row.dataset.index)];
    if (entry) commit(entry);
  });

  const onKeydown = (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); if (visibleEntries.length) highlight(Math.min(activeIndex + 1, visibleEntries.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); if (visibleEntries.length) highlight(Math.max(activeIndex - 1, 0)); }
    else if (event.key === "Enter") { if (activeIndex >= 0 && visibleEntries[activeIndex]) { event.preventDefault(); commit(visibleEntries[activeIndex]); } }
    else if (event.key === "Escape") { event.preventDefault(); input.value = currentLabel(select); closeActive(); }
    else if (event.key === "Tab") { closeActive(); }
  };
  const onDocPointerDown = (event) => { if (!wrap.contains(event.target) && !listbox.contains(event.target)) { input.value = currentLabel(select); closeActive(); } };
  const onScrollOrResize = () => position();

  const onInput = () => paint(input.value);

  input.addEventListener("keydown", onKeydown);
  document.addEventListener("pointerdown", onDocPointerDown, true);
  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize);
  input.addEventListener("input", onInput);

  input.setAttribute("aria-expanded", "true");
  // Abre mostrando a lista INTEIRA (não filtrada pelo texto já preenchido com o rótulo da opção
  // selecionada) — só passa a filtrar quando o usuário de fato digita algo (ver onInput acima).
  // Seleciona o texto atual pra digitar já substituir, como em qualquer combobox.
  input.select();
  paint("");

  active = {
    select, input, listbox,
    cleanup: () => {
      input.removeEventListener("keydown", onKeydown);
      input.removeEventListener("input", onInput);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      input.setAttribute("aria-expanded", "false");
    },
  };
}

function enhance(select) {
  if (select.dataset.searchableBound === "true") return;
  select.dataset.searchableBound = "true";

  const wrap = document.createElement("div");
  wrap.className = "searchable-select";

  select.parentNode.insertBefore(wrap, select);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "input searchable-select-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-haspopup", "listbox");
  input.setAttribute("aria-expanded", "false");
  input.placeholder = select.dataset.searchPlaceholder || "Buscar...";
  input.value = currentLabel(select);
  input.disabled = select.disabled;

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "searchable-select-clear";
  clearButton.setAttribute("aria-label", "Limpar seleção");
  clearButton.textContent = "×";
  clearButton.hidden = !select.value || !select.options[0] || select.options[0].value !== "";

  wrap.append(input, clearButton);
  wrap.appendChild(select);
  select.classList.add("searchable-select-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const openIfEnabled = () => { if (!select.disabled) openListbox(select, input, wrap); };
  input.addEventListener("focus", openIfEnabled);
  input.addEventListener("click", openIfEnabled);
  clearButton.addEventListener("click", () => {
    select.value = "";
    input.value = "";
    clearButton.hidden = true;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus();
  });
  input.addEventListener("input", () => { clearButton.hidden = !input.value && !select.value; });

  refreshSearchableSelect(select);
}

/** Ressincroniza o texto visível/estado disabled com o <select> real — chamar depois de mudar
 * select.value ou select.disabled por código (ex.: lógica de cascata cliente→squad). Não faz nada
 * se o select ainda não foi transformado em combobox. */
export function refreshSearchableSelect(select) {
  if (select.dataset.searchableBound !== "true") return;
  const wrap = select.closest(".searchable-select");
  const input = wrap?.querySelector(".searchable-select-input");
  const clearButton = wrap?.querySelector(".searchable-select-clear");
  if (!input) return;
  input.value = currentLabel(select);
  input.disabled = select.disabled;
  if (clearButton) clearButton.hidden = !select.value || !select.options[0] || select.options[0].value !== "";
}

function scan(node) {
  if (node.nodeType !== 1) return;
  if (node.matches?.("[data-searchable-select]")) enhance(node);
  node.querySelectorAll?.("[data-searchable-select]").forEach(enhance);
}

/** Liga a observação num container estável (ex.: #page-content) — cobre qualquer select marcado
 * com data-searchable-select inserido depois, sem precisar de chamada manual por controller. */
export function observeSearchableSelects(root) {
  if (!root) return null;
  scan(root);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(scan);
      // Um <select> desmarcado/reconstruído dentro de um nó que já existia (ex.: re-render de um
      // fieldset específico) ainda é coberto porque scan() varre querySelectorAll no próprio nó.
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return observer;
}
