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
  const first = phone.slice(4, 9);
  const last = phone.slice(9);
  return `+${country} (${area}) ${first}-${last}`;
}

export function nameFor(items, id, fallback = "Não definido") {
  return items.find((item) => item.id === id)?.name ?? fallback;
}
