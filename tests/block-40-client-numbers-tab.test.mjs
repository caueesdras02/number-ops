import assert from "node:assert/strict";
import { matchesClientName } from "../src/js/models/client-naming.js";
import { NumbersService } from "../src/js/services/numbers-service.js";
import { renderNumbersView } from "../src/js/ui/numbers-view.js";

// ---------------------------------------------------------------------------
// matchesClientName — identificação contém o nome de um Cliente cadastrado;
// "Tim" nunca conta (é operadora, não cliente), mesmo que exista um Cliente com
// esse nome.
// ---------------------------------------------------------------------------
const clients = [{ id: "c1", name: "ZIG" }, { id: "c2", name: "Embaixador Móveis" }, { id: "c3", name: "Tim" }];
assert.ok(matchesClientName("CHIP ZIG 03", clients), "identificação contém o nome do cliente ZIG");
assert.ok(matchesClientName("chip zig 03", clients), "comparação não diferencia maiúsculas/minúsculas");
assert.ok(matchesClientName("Embaixador Móveis - linha 2", clients), "identificação contém o nome do cliente Embaixador Móveis");
assert.ok(!matchesClientName("Chip Tim pré-pago", clients), "Tim nunca conta, mesmo cadastrado como cliente");
assert.ok(!matchesClientName("Chip genérico 01", clients), "identificação sem nome de cliente não bate com nada");
assert.ok(!matchesClientName("", clients), "identificação vazia não bate com nada");
assert.ok(!matchesClientName("qualquer coisa", []), "sem clientes cadastrados, nunca bate");

// ---------------------------------------------------------------------------
// NumbersService — números nomeados por cliente saem da listagem principal e só
// aparecem em getClientNumbers(); arquivado tem prioridade sobre nomeado.
// ---------------------------------------------------------------------------
const seedState = () => ({
  schemaVersion: 2, meta: { seedApplied: true },
  numbers: [
    { id: "n1", phone: "5511987654213", identification: "CHIP ZIG 03", status: "ACTIVE", locationId: null, responsibleId: null, clientIds: [], groupIds: [], groupCount: 0, notes: "", restriction: null, archivedAt: null },
    { id: "n2", phone: "5511816273849", identification: "Chip genérico", status: "ACTIVE", locationId: null, responsibleId: null, clientIds: [], groupIds: [], groupCount: 0, notes: "", restriction: null, archivedAt: null },
    { id: "n3", phone: "5511923456781", identification: "Chip Tim pré-pago", status: "ACTIVE", locationId: null, responsibleId: null, clientIds: [], groupIds: [], groupCount: 0, notes: "", restriction: null, archivedAt: null },
  ],
  clients: [{ id: "c1", name: "ZIG", squadId: null, isActive: true }, { id: "c3", name: "Tim", squadId: null, isActive: true }],
  groups: [], responsibles: [], locations: [], incidents: [], historyEvents: [], campaigns: [], numberCampaignLinks: [],
});
const repository = (() => { let state = seedState(); return { initialize: () => JSON.parse(JSON.stringify(state)), save: (s) => { state = JSON.parse(JSON.stringify(s)); }, flush: () => Promise.resolve() }; })();
const numbers = new NumbersService(repository);

assert.ok(!numbers.getNumbers().some((n) => n.id === "n1"), "n1 (CHIP ZIG 03) não aparece na listagem principal");
assert.ok(numbers.getNumbers().some((n) => n.id === "n2"), "n2 (sem nome de cliente) continua na listagem principal");
assert.ok(numbers.getNumbers().some((n) => n.id === "n3"), "n3 (Chip Tim) continua na listagem principal — Tim não conta como cliente");
assert.ok(numbers.getClientNumbers().some((n) => n.id === "n1"), "n1 aparece na aba Números de Clientes");
assert.ok(!numbers.getClientNumbers().some((n) => n.id === "n2"), "n2 não aparece na aba Números de Clientes");
assert.ok(!numbers.getClientNumbers().some((n) => n.id === "n3"), "n3 (Tim) não aparece na aba Números de Clientes");

// Arquivar tem prioridade: some das duas listas "em operação" e só aparece em Arquivados.
numbers.archive("n1");
assert.ok(!numbers.getNumbers().some((n) => n.id === "n1"));
assert.ok(!numbers.getClientNumbers().some((n) => n.id === "n1"), "arquivado não aparece mais em Números de Clientes");
assert.ok(numbers.getArchivedNumbers().some((n) => n.id === "n1"), "arquivado aparece em Arquivados");

// Reclassificação automática: tirar o nome do cliente da identificação devolve o número
// pra listagem principal no próximo cálculo (nada fica "preso" na aba errada).
numbers.restore("n1");
numbers.update("n1", { ...numbers.getNumber("n1"), identification: "Chip renomeado" });
assert.ok(numbers.getNumbers().some((n) => n.id === "n1"), "sem nome de cliente na identificação, volta pra listagem principal");
assert.ok(!numbers.getClientNumbers().some((n) => n.id === "n1"));

// ---------------------------------------------------------------------------
// renderNumbersView aceita cabeçalho/subtítulo customizados (usado na aba Números
// de Clientes) sem quebrar a renderização padrão quando omitido.
// ---------------------------------------------------------------------------
const defaultHtml = renderNumbersView([], [], [], "", {}, [], [], true, [], []);
assert.match(defaultHtml, /<h2>Números<\/h2>/);
const customHtml = renderNumbersView([], [], [], "", {}, [], [], true, [], [], { heading: "Números de Clientes", searchId: "client-number-search" });
assert.match(customHtml, /<h2>Números de Clientes<\/h2>/);
assert.match(customHtml, /id="client-number-search"/);

console.log("Bloco 40: aba Números de Clientes (detecção por nome de cliente, exceção Tim, prioridade de arquivado) validada.");
