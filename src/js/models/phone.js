// Espelha (deliberadamente, mesma lógica) supabase/functions/telegram-webhook/phone.js —
// não é importável entre os dois runtimes (Deno vs. navegador estático sem bundler),
// então esta é a cópia do lado do frontend. Qualquer mudança na regra de normalização
// de telefone brasileiro precisa ser replicada nos dois arquivos.
import { normalizePhone } from "./helpers.js";

/**
 * Forma canônica de um telefone brasileiro (sempre COM código do país, 55 +
 * DDD + 8/9 dígitos = 12/13 caracteres) — a mesma convenção de
 * public.numbers.phone. Usada para gravar/consultar public.external_numbers
 * de forma determinística (nunca LIKE/substring). Retorna null quando o
 * valor não tem um formato brasileiro reconhecível (nem 10/11 dígitos sem
 * código do país, nem 12/13 com "55") — nunca inventa/completa dígitos.
 * @param {string} value
 * @returns {string|null}
 */
export function canonicalBrazilianPhone(value) {
  const digits = normalizePhone(value);
  if (!digits) return null;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}

// Os 67 DDDs (códigos de área) realmente atribuídos pela Anatel. Qualquer código fora
// desta lista não existe no Brasil (ex.: 00, 10, 20, 23, 36, 52) — sem essa checagem,
// o cadastro aceitava telefones como "5500000000" como se fossem válidos.
const VALID_BRAZILIAN_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
  21, 22, 24, // RJ
  27, 28, // ES
  31, 32, 33, 34, 35, 37, 38, // MG
  41, 42, 43, 44, 45, 46, // PR
  47, 48, 49, // SC
  51, 53, 54, 55, // RS
  61, // DF
  62, 64, // GO
  63, // TO
  65, 66, // MT
  67, // MS
  68, // AC
  69, // RO
  71, 73, 74, 75, 77, // BA
  79, // SE
  81, 87, // PE
  82, // AL
  83, // PB
  84, // RN
  85, 88, // CE
  86, 89, // PI
  91, 93, 94, // PA
  92, 97, // AM
  95, // RR
  96, // AP
  98, 99, // MA
]);

const allSameDigit = (digits) => /^(\d)\1+$/.test(digits);
const isStrictSequence = (digits) => {
  const nums = [...digits].map(Number);
  const ascending = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  const descending = nums.every((n, i) => i === 0 || n === nums[i - 1] - 1);
  return ascending || descending;
};

/**
 * Valida um telefone brasileiro já normalizado (só dígitos, "55" + DDD + 8/9 dígitos).
 * Retorna a mensagem de erro para exibir ao usuário, ou null se o telefone é válido.
 * Pega casos como DDD inexistente (00, 10...) e números "de mentira" (00000000,
 * 11111111, 12345678) que o formulário aceitava antes sem nenhum aviso.
 */
export function describeBrazilianPhoneError(normalized) {
  if (!normalized) return "Informe o número de telefone.";
  if (!normalized.startsWith("55") || (normalized.length !== 12 && normalized.length !== 13)) return "Informe um telefone brasileiro com 55, DDD e 8 ou 9 dígitos.";
  const ddd = Number(normalized.slice(2, 4));
  if (!VALID_BRAZILIAN_DDDS.has(ddd)) return "DDD inválido — esse código de área não existe no Brasil.";
  const subscriber = normalized.slice(4);
  if (allSameDigit(subscriber)) return "Número inválido — todos os dígitos são iguais.";
  if (isStrictSequence(subscriber)) return "Número inválido — dígitos em sequência.";
  if (subscriber.length === 9 && subscriber[0] !== "9") return "Celular com 9 dígitos deve começar com 9.";
  if (subscriber.length === 8 && !"2345".includes(subscriber[0])) return "Número fixo (8 dígitos) deve começar com 2, 3, 4 ou 5.";
  return null;
}
