export const statusLabels = Object.freeze({
  ACTIVE: "Ativo",
  WARMING: "Em aquecimento",
  UNDER_REVIEW: "Em análise",
  BLOCKED: "Bloqueado",
  INACTIVE: "Inativo",
});

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[character]);
}

export function formatPhone(phone) {
  const country = phone.slice(0, 2);
  const area = phone.slice(2, 4);
  const first = phone.length === 12 ? phone.slice(4, 8) : phone.slice(4, 9);
  const last = phone.length === 12 ? phone.slice(8) : phone.slice(9);
  return `+${country} (${area}) ${first}-${last}`;
}

export function nameFor(items, id, fallback = "Não definido") {
  return items.find((item) => item.id === id)?.name ?? fallback;
}

// Três formatos de data já usados espalhados pelo app (cada view reimplementava o seu) —
// centralizados aqui, mesmo comportamento de antes em cada tela, só sem a duplicação.
/** Data e hora, formato numérico completo (com segundos) — ex.: "23/09/2026 14:30:00". */
export function formatDateTime(value, fallback = "—") {
  return value ? new Date(value).toLocaleString("pt-BR") : fallback;
}
/** Data e hora, formato curto (sem segundos) — ex.: "23/09/2026 14:30". */
export function formatDateTimeShort(value, fallback = "—") {
  return value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : fallback;
}
/** Só a data — ex.: "23/09/2026". */
export function formatDate(value, fallback = "—") {
  return value ? new Date(value).toLocaleDateString("pt-BR") : fallback;
}

// Mantém eventos anteriores consistentes com a nomenclatura exibida hoje.
export function displayTerminology(value = "") {
  return String(value)
    .replaceAll("Grupos", "Squads")
    .replaceAll("grupos", "squads")
    .replaceAll("Grupo", "Squad")
    .replaceAll("grupo", "squad");
}
