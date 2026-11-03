// "Número de cliente": identificação do número contém o nome de um Cliente cadastrado
// (ex.: identificação "CHIP ZIG 03" bate com o cliente "ZIG"). Usado pra separar esses
// números — que já "dizem" o cliente no próprio texto — da listagem principal, numa aba
// própria (Números de Clientes), sem bagunçar a lista operacional comum.
// "Tim" é excluído de propósito: na identificação quase sempre indica a OPERADORA (TIM),
// não o cliente — mesmo que exista um Cliente cadastrado com esse nome.
const EXCLUDED_CLIENT_MATCH_NAMES = new Set(["tim"]);

export function matchesClientName(identification, clients) {
  const text = String(identification ?? "").toLocaleLowerCase("pt-BR").trim();
  if (!text) return false;
  return (clients ?? []).some((client) => {
    const name = String(client?.name ?? "").trim();
    if (!name) return false;
    const normalized = name.toLocaleLowerCase("pt-BR");
    if (EXCLUDED_CLIENT_MATCH_NAMES.has(normalized)) return false;
    return text.includes(normalized);
  });
}
