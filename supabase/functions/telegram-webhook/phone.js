// Única fonte de verdade para normalização/telefone dentro desta Edge
// Function. Nenhuma outra regra de telefone deve existir em outro arquivo
// deste diretório — parser e handler importam daqui.
//
// public.numbers.phone é sempre armazenado com código do país (55 + DDD +
// 8 ou 9 dígitos = 12 ou 13 caracteres — mesma regra de
// src/js/services/numbers-service.js validatePhone, que não é importável
// aqui por rodar em outro runtime/deploy). O texto de um alerta do Telegram
// pode vir SEM o "55" (ex.: "81920039925"), então a resolução do número
// precisa considerar as duas formas — sem inventar/adivinhar dígitos.

/** Remove tudo que não é dígito. Não decide nada sobre formato, só limpa. */
export function normalizePhone(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Gera as formas EXATAS e determinísticas em que o mesmo telefone brasileiro
 * pode estar armazenado em public.numbers, a partir do que veio no alerta.
 * Nunca gera candidatos por aproximação (sem LIKE/substring) — cada
 * candidato é uma string completa que ou bate exatamente com numbers.phone
 * ou não bate.
 *
 * - "81920039925"        (11 dígitos, sem 55)      -> ["81920039925", "5581920039925"]
 * - "5581920039925"      (13 dígitos, com 55)       -> ["5581920039925", "81920039925"]
 * - "+55 (81) 92003-9925" (formatado, com 55)        -> mesmo resultado da linha acima
 * - "(81) 92003-9925"     (formatado, sem 55)        -> mesmo resultado da primeira linha
 *
 * @param {string} rawValue
 * @returns {string[]} candidatos únicos, na ordem em que devem ser tentados
 */
export function brazilianPhoneCandidates(rawValue) {
  const digits = normalizePhone(rawValue);
  if (!digits) return [];
  const candidates = new Set([digits]);
  const hasCountryCode = digits.startsWith("55") && (digits.length === 12 || digits.length === 13);
  const isLocalOnly = digits.length === 10 || digits.length === 11;
  if (hasCountryCode) candidates.add(digits.slice(2));
  if (isLocalOnly) candidates.add(`55${digits}`);
  return [...candidates];
}
