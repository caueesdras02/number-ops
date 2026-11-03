import assert from "node:assert/strict";
import { describeBrazilianPhoneError } from "../src/js/models/phone.js";
import { NumbersService } from "../src/js/services/numbers-service.js";

// ---------------------------------------------------------------------------
// describeBrazilianPhoneError — DDD inexistente, dígitos repetidos/sequenciais,
// regra do 9º dígito do celular e 1º dígito do fixo.
// ---------------------------------------------------------------------------
assert.equal(describeBrazilianPhoneError(""), "Informe o número de telefone.");
assert.match(describeBrazilianPhoneError("551199999"), /55, DDD e 8 ou 9 dígitos/, "tamanho errado");

assert.match(describeBrazilianPhoneError("5500912345678"), /DDD inválido/, "DDD 00 não existe");
assert.match(describeBrazilianPhoneError("5510912345678"), /DDD inválido/, "DDD 10 não existe");
assert.match(describeBrazilianPhoneError("5523912345678"), /DDD inválido/, "DDD 23 nunca foi atribuído");
assert.equal(describeBrazilianPhoneError("5511912345678"), null, "DDD 11 (SP) é válido");
assert.equal(describeBrazilianPhoneError("5581987654213"), null, "DDD 81 (PE) é válido");

assert.match(describeBrazilianPhoneError("551100000000"), /todos os dígitos são iguais/, "caso relatado: fixo 00000000");
assert.match(describeBrazilianPhoneError("5511999999999"), /todos os dígitos são iguais/, "celular 999999999 também é inválido");

assert.match(describeBrazilianPhoneError("551112345678"), /sequência/, "fixo em sequência ascendente (12345678)");
assert.match(describeBrazilianPhoneError("5511987654321"), /sequência/, "celular em sequência descendente (987654321)");

assert.match(describeBrazilianPhoneError("5511812345678"), /Celular com 9 dígitos deve começar com 9/, "9 dígitos sem começar com 9 não é celular válido");
assert.equal(describeBrazilianPhoneError("5511987654213"), null, "celular real (9 dígitos, começa com 9, sem padrão óbvio)");

assert.match(describeBrazilianPhoneError("551116273849"), /deve começar com 2, 3, 4 ou 5/, "fixo de 8 dígitos começando com 1 é inválido");
assert.equal(describeBrazilianPhoneError("551133334444"), null, "fixo real (8 dígitos, começa com 3)");

// ---------------------------------------------------------------------------
// NumbersService.create/update — a validação passa a rejeitar esses casos no
// cadastro real, não só na função isolada.
// ---------------------------------------------------------------------------
const repository = (() => { let state = { schemaVersion: 2, meta: { seedApplied: true }, numbers: [], clients: [], groups: [], responsibles: [], locations: [], incidents: [], historyEvents: [], campaigns: [], numberCampaignLinks: [] }; return { initialize: () => JSON.parse(JSON.stringify(state)), save: (s) => { state = JSON.parse(JSON.stringify(s)); }, flush: () => Promise.resolve() }; })();
const numbers = new NumbersService(repository);
assert.throws(() => numbers.create({ phone: "5500000000000" }), /DDD inválido/, "não deixa cadastrar DDD 00 (caso relatado)");
assert.throws(() => numbers.create({ phone: "5511999999999" }), /todos os dígitos são iguais/);
assert.doesNotThrow(() => numbers.create({ phone: "5511987654213", groupCount: 0 }));

// Número legado com telefone num padrão hoje inválido (gravado antes desta checagem
// existir): editar outros campos não pode travar por causa do telefone não ter mudado.
const legacyRepository = (() => { let state = { schemaVersion: 2, meta: { seedApplied: true }, numbers: [{ id: "legacy1", phone: "5511999999999", identification: "Legado", status: "ACTIVE", locationId: null, responsibleId: null, clientIds: [], groupIds: [], groupCount: 0, notes: "", restriction: null, archivedAt: null }], clients: [], groups: [], responsibles: [], locations: [], incidents: [], historyEvents: [], campaigns: [], numberCampaignLinks: [] }; return { initialize: () => JSON.parse(JSON.stringify(state)), save: (s) => { state = JSON.parse(JSON.stringify(s)); }, flush: () => Promise.resolve() }; })();
const legacyNumbers = new NumbersService(legacyRepository);
assert.doesNotThrow(() => legacyNumbers.update("legacy1", { ...legacyNumbers.getNumber("legacy1"), notes: "atualizado" }), "editar outro campo de um número legado não deve travar por telefone já gravado");
assert.throws(() => legacyNumbers.update("legacy1", { ...legacyNumbers.getNumber("legacy1"), phone: "5500000000000" }), /DDD inválido/, "mas trocar o telefone legado por outro inválido continua bloqueado");

console.log("Bloco 38: validação de telefone brasileiro (DDD real, sem padrões óbvios de número falso) validada.");
