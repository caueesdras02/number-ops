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
