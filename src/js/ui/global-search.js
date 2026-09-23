// Busca global — abre com Ctrl+K/Cmd+K ou pelo ícone de busca no topbar. Pesquisa Número (telefone
// e identificação), Cliente, Squad, Colaborador, Localização e Campanha ao mesmo tempo, usando os
// dados já carregados em memória (nenhuma consulta nova ao Supabase), e navega direto pro registro
// ao escolher um resultado. Portado pro <body> (mesmo motivo do stage-dropdown/searchable-select:
// nunca pode ser cortado nem destruído por um re-render de #page-content enquanto está aberto).
import { matchesSearch } from "../models/search-match.js";
import { escapeHtml, formatPhone } from "./number-presentation.js";

// Plural explícito por tipo (não dá pra só acrescentar "s" em português: "Colaborador" ->
// "Colaboradores", "Localização" -> "Localizações" — nunca "Colaboradors"/"Localizaçãos").
const ENTITY_CONFIG = [
  {
    type: "numbers", labelSingular: "Número", labelPlural: "Números", icon: "#",
    getItems: (s) => s.numbers.filter((n) => !n.archivedAt),
    getText: (n) => `${n.phone} ${n.identification || ""}`,
    title: (n) => formatPhone(n.phone),
    subtitle: (n) => n.identification || "",
    href: (n) => `#numbers/${n.id}`,
  },
  {
    type: "campaigns", labelSingular: "Campanha", labelPlural: "Campanhas", icon: "◆",
    getItems: (s) => s.campaigns,
    getText: (c) => c.name,
    title: (c) => c.name,
    subtitle: (c) => (c.status === "ACTIVE" ? "Ativa" : "Encerrada"),
    href: (c) => `#campaigns/${c.id}`,
  },
  {
    type: "clients", labelSingular: "Cliente", labelPlural: "Clientes", icon: "◉",
    getItems: (s) => s.clients.filter((c) => c.isActive),
    getText: (c) => c.name,
    title: (c) => c.name,
    subtitle: () => "",
    href: (c) => `#clients/${c.id}`,
  },
  {
    type: "groups", labelSingular: "Squad", labelPlural: "Squads", icon: "◇",
    getItems: (s) => s.groups.filter((g) => g.isActive),
    getText: (g) => g.name,
    title: (g) => g.name,
    subtitle: () => "",
    href: (g) => `#groups/${g.id}`,
  },
  {
    type: "responsibles", labelSingular: "Colaborador", labelPlural: "Colaboradores", icon: "♙",
    getItems: (s) => s.responsibles.filter((r) => r.isActive),
    getText: (r) => r.name,
    title: (r) => r.name,
    subtitle: () => "",
    href: (r) => `#responsibles/${r.id}`,
  },
  {
    type: "locations", labelSingular: "Localização", labelPlural: "Localizações", icon: "⌖",
    getItems: (s) => s.locations.filter((l) => l.isActive),
    getText: (l) => l.name,
    title: (l) => l.name,
    subtitle: () => "",
    href: (l) => `#numbers/locations/${l.id}`,
  },
];

const MAX_PER_TYPE = 5;
const MAX_TOTAL = 30;

/** Exportado só pra teste (node --test, sem DOM) — a UI (abrir/fechar/teclado) precisa de
 * navegador de verdade e já foi verificada manualmente; a lógica de busca em si não. */
export function search(state, query) {
  if (!query.trim()) return [];
  const results = [];
  for (const config of ENTITY_CONFIG) {
    let countForType = 0;
    for (const item of config.getItems(state)) {
      if (countForType >= MAX_PER_TYPE) break;
      if (!matchesSearch(config.getText(item), query)) continue;
      results.push({ config, item });
      countForType++;
      if (results.length >= MAX_TOTAL) return results;
    }
  }
  return results;
}

let active = null;

function closeActive() {
  if (!active) return;
  const { backdrop, cleanup } = active;
  backdrop.remove();
  cleanup();
  active = null;
}

export function openGlobalSearch(getState) {
  closeActive();

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop global-search-backdrop";
  backdrop.innerHTML = `<section class="modal-card global-search-card" role="dialog" aria-modal="true" aria-label="Busca global">
    <div class="global-search-input-row">
      <span aria-hidden="true">⌕</span>
      <input type="text" class="global-search-input" placeholder="Buscar número, cliente, campanha, squad..." autocomplete="off" spellcheck="false">
      <kbd>Esc</kbd>
    </div>
    <div class="global-search-results" role="listbox"></div>
  </section>`;
  document.body.appendChild(backdrop);

  const input = backdrop.querySelector(".global-search-input");
  const resultsEl = backdrop.querySelector(".global-search-results");
  let flatResults = [];
  let activeIndex = -1;

  const highlight = (index) => {
    activeIndex = index;
    [...resultsEl.querySelectorAll("[data-row]")].forEach((row, i) => row.classList.toggle("is-active", i === activeIndex));
    resultsEl.querySelectorAll("[data-row]")[activeIndex]?.scrollIntoView({ block: "nearest" });
  };

  const commit = (entry) => {
    window.location.hash = entry.config.href(entry.item);
    closeActive();
  };

  const paint = () => {
    const state = getState();
    const query = input.value;
    flatResults = query.trim() ? search(state, query) : [];
    activeIndex = flatResults.length ? 0 : -1;

    if (!query.trim()) {
      resultsEl.innerHTML = `<p class="global-search-hint-text">Digite pra buscar em Números, Campanhas, Clientes, Squads, Colaboradores e Localizações.</p>`;
      return;
    }
    if (!flatResults.length) {
      resultsEl.innerHTML = `<p class="global-search-empty">Nenhum resultado pra "${escapeHtml(query)}".</p>`;
      return;
    }
    const grouped = new Map();
    flatResults.forEach((entry, index) => {
      const key = entry.config.type;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ ...entry, index });
    });
    resultsEl.innerHTML = [...grouped.values()].map((rows) => `
      <div class="global-search-group">
        <p class="global-search-group-label">${rows.length > 1 ? rows[0].config.labelPlural : rows[0].config.labelSingular}</p>
        ${rows.map((entry) => `<button type="button" class="global-search-row" data-row data-index="${entry.index}" role="option">
          <span class="global-search-row-icon" aria-hidden="true">${entry.config.icon}</span>
          <span class="global-search-row-text"><strong>${escapeHtml(entry.config.title(entry.item))}</strong>${entry.config.subtitle(entry.item) ? `<small>${escapeHtml(entry.config.subtitle(entry.item))}</small>` : ""}</span>
        </button>`).join("")}
      </div>
    `).join("");
    highlight(0);
  };

  const onInput = () => paint();
  const onKeydown = (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); if (flatResults.length) highlight(Math.min(activeIndex + 1, flatResults.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); if (flatResults.length) highlight(Math.max(activeIndex - 1, 0)); }
    else if (event.key === "Enter") { if (activeIndex >= 0 && flatResults[activeIndex]) { event.preventDefault(); commit(flatResults[activeIndex]); } }
    else if (event.key === "Escape") { event.preventDefault(); closeActive(); }
  };
  const onResultsClick = (event) => {
    const row = event.target.closest("[data-row]");
    if (!row) return;
    const entry = flatResults[Number(row.dataset.index)];
    if (entry) commit(entry);
  };
  const onBackdropClick = (event) => { if (event.target === backdrop) closeActive(); };

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeydown);
  resultsEl.addEventListener("click", onResultsClick);
  backdrop.addEventListener("click", onBackdropClick);

  paint();
  input.focus();

  active = {
    backdrop,
    cleanup: () => {
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeydown);
      resultsEl.removeEventListener("click", onResultsClick);
      backdrop.removeEventListener("click", onBackdropClick);
    },
  };
}

/** Liga o gatilho (ícone no topbar) e o atalho Ctrl+K/Cmd+K. `getState` é chamado só no momento de
 * abrir/digitar — sempre lê o state ATUAL (nunca um snapshot antigo). */
export function bindGlobalSearch({ trigger, getState }) {
  trigger?.addEventListener("click", () => openGlobalSearch(getState));
  document.addEventListener("keydown", (event) => {
    const isShortcut = (event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey);
    if (!isShortcut) return;
    event.preventDefault();
    openGlobalSearch(getState);
  });
}
