// Parser puro (sem dependências de Deno/Node) do alerta de infraestrutura
// publicado pelo bot de terceiros no grupo "Alertas Analytics". Tolerante a
// variação de emoji/espaçamento; nunca faz matching agressivo ou adivinha
// dado ausente — só extrai o que está explicitamente rotulado no texto.
//
// Formato esperado (aproximado, pode variar em espaçamento/emoji):
//   🚨 ALERTA DE INFRAESTRUTURA
//   Status: 🔴 DESCONECTADO
//   Empresa: [empresa]
//   Liveshop: [campanha]
//   Conta do Cliente: [identificação]
//   Número: 55XXXXXXXXXXX

import { normalizePhone } from "./phone.js";

export { normalizePhone };

const LABEL_MAP = {
  status: "status",
  empresa: "empresa",
  liveshop: "liveshop",
  "conta do cliente": "contaCliente",
  numero: "phoneRaw",
  telefone: "phoneRaw",
};

function stripDiacritics(value) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Remove emoji/símbolos no início do valor (ex.: "🔴 DESCONECTADO" -> "DESCONECTADO"),
// preservando o texto em si — nunca reescreve/adivinha o conteúdo.
function cleanValue(value) {
  return value.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

/**
 * @param {string} text
 * @returns {{
 *   matchesAlertShape: boolean,
 *   status: string|null,
 *   empresa: string|null,
 *   liveshop: string|null,
 *   contaCliente: string|null,
 *   phoneRaw: string|null,
 *   phoneNormalized: string|null,
 * }}
 */
export function parseAlertText(text) {
  const raw = String(text ?? "");
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const fields = {};
  for (const line of lines) {
    const match = line.match(/^([^:]{2,40}):\s*(.*)$/);
    if (!match) continue;
    const labelKey = stripDiacritics(match[1].trim().toLowerCase());
    const canonical = LABEL_MAP[labelKey];
    if (!canonical || fields[canonical]) continue;
    fields[canonical] = cleanValue(match[2]);
  }
  const matchesAlertShape = /alerta/i.test(raw) || Boolean(fields.status);
  const phoneRaw = fields.phoneRaw || null;
  const phoneNormalized = phoneRaw ? (normalizePhone(phoneRaw) || null) : null;
  return {
    matchesAlertShape,
    status: fields.status || null,
    empresa: fields.empresa || null,
    liveshop: fields.liveshop || null,
    contaCliente: fields.contaCliente || null,
    phoneRaw,
    phoneNormalized,
  };
}
