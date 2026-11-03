// Normalização de busca textual compartilhada por todo o app: minúsculas (pt-BR), sem espaços
// duplicados/nas pontas, sem acento — assim "  São   Paulo" e "sao paulo" casam com o mesmo termo,
// e "café" é encontrado digitando "cafe". Fica em models/ (não em ui/) porque é usado tanto pela
// camada de apresentação (searchable-select.js, listas com busca) quanto por services (filtro de
// campanhas por nome) — um helper puro sem DOM, sem acoplar service a ui.
export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/\s+/g, " ");
}

export function matchesSearch(text, query) {
  const q = normalizeSearchText(query);
  if (!q) return true;
  return normalizeSearchText(text).includes(q);
}
