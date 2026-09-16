import assert from "node:assert/strict";
import { normalizePhone, brazilianPhoneCandidates } from "../supabase/functions/telegram-webhook/phone.js";

// ---------------------------------------------------------------------------
// BLOCO 1 (fix) — normalização/candidatos de telefone brasileiro, centralizado
// em supabase/functions/telegram-webhook/phone.js. Único lugar com essa regra.
// ---------------------------------------------------------------------------

// normalizePhone só limpa, nunca decide formato
assert.equal(normalizePhone("+55 (81) 92003-9925"), "5581920039925");
assert.equal(normalizePhone("(81) 92003-9925"), "81920039925");
assert.equal(normalizePhone(""), "");
assert.equal(normalizePhone(undefined), "");

// brazilianPhoneCandidates: os 5 formatos do bug relatado devem gerar candidatos
// que incluem SEMPRE "5581920039925" (forma armazenada em public.numbers).
const casosEquivalentes = [
  "81920039925",
  "5581920039925",
  "+5581920039925",
  "+55 (81) 92003-9925",
  "(81) 92003-9925",
];
for (const entrada of casosEquivalentes) {
  const candidatos = brazilianPhoneCandidates(entrada);
  assert.ok(candidatos.includes("5581920039925"), `"${entrada}" deveria gerar o candidato "5581920039925" (obteve ${JSON.stringify(candidatos)})`);
}

// sem código do país (11 dígitos) => candidatos = [como veio, com 55 na frente]
assert.deepEqual(brazilianPhoneCandidates("81920039925"), ["81920039925", "5581920039925"]);

// com código do país (13 dígitos) => candidatos = [como veio, sem o 55]
assert.deepEqual(brazilianPhoneCandidates("5581920039925"), ["5581920039925", "81920039925"]);

// telefone fixo sem 9º dígito (10 dígitos locais / 12 com 55) segue a mesma regra
assert.deepEqual(brazilianPhoneCandidates("1133334444"), ["1133334444", "551133334444"]);
assert.deepEqual(brazilianPhoneCandidates("551133334444"), ["551133334444", "1133334444"]);

// entrada vazia/irreconhecível não gera candidato nenhum (nunca adivinha)
assert.deepEqual(brazilianPhoneCandidates(""), []);
assert.deepEqual(brazilianPhoneCandidates(null), []);
// tamanho fora do esperado para BR (nem 10/11 sem código, nem 12/13 com código):
// não expande — só o valor limpo original é retornado, sem inventar forma alternativa.
assert.deepEqual(brazilianPhoneCandidates("123"), ["123"]);

console.log("Bloco 1 (fix telefone BR): todos os cenários passaram.");
