import assert from "node:assert/strict";
import { NumbersService } from "../src/js/services/numbers-service.js";
import { renderNumberDetailView } from "../src/js/ui/number-detail-view.js";

const seedState = () => ({
  schemaVersion: 2, meta: { seedApplied: true },
  numbers: [
    { id: "n1", phone: "5511987654213", identification: "Chip genérico", status: "ACTIVE", locationId: null, responsibleId: null, clientIds: [], groupIds: [], groupCount: 0, notes: "", restriction: null, clientNumberOverride: null, archivedAt: null },
    { id: "n2", phone: "5511816273849", identification: "CHIP ZIG 03", status: "ACTIVE", locationId: null, responsibleId: null, clientIds: [], groupIds: [], groupCount: 0, notes: "", restriction: null, clientNumberOverride: null, archivedAt: null },
  ],
  clients: [{ id: "c1", name: "ZIG", squadId: null, isActive: true }],
  groups: [], responsibles: [], locations: [], incidents: [], historyEvents: [], campaigns: [], numberCampaignLinks: [],
});
const repository = (() => { let state = seedState(); return { initialize: () => JSON.parse(JSON.stringify(state)), save: (s) => { state = JSON.parse(JSON.stringify(s)); }, flush: () => Promise.resolve() }; })();
const numbers = new NumbersService(repository);

// n1 não bate com nenhum cliente por texto, mas override força pra dentro.
assert.equal(numbers.isClientNamed(numbers.getNumber("n1")), false, "sem override, n1 não é número de cliente");
numbers.setClientNumberOverride("n1", true);
assert.equal(numbers.isClientNamed(numbers.getNumber("n1")), true, "override true força número de cliente");
assert.ok(numbers.getClientNumbers().some((n) => n.id === "n1"));
assert.ok(!numbers.getNumbers().some((n) => n.id === "n1"));

// n2 bate com ZIG por texto, mas override força pra fora.
assert.equal(numbers.isClientNamed(numbers.getNumber("n2")), true, "sem override, n2 é número de cliente (bate com ZIG)");
numbers.setClientNumberOverride("n2", false);
assert.equal(numbers.isClientNamed(numbers.getNumber("n2")), false, "override false força fora, mesmo batendo o texto");
assert.ok(numbers.getNumbers().some((n) => n.id === "n2"));
assert.ok(!numbers.getClientNumbers().some((n) => n.id === "n2"));

// Limpar o override (null) volta pra detecção automática.
numbers.setClientNumberOverride("n2", null);
assert.equal(numbers.isClientNamed(numbers.getNumber("n2")), true, "sem override, volta a bater com ZIG automaticamente");

// Histórico registrado.
const events = numbers.history.list("n1").filter((e) => e.type === "CLIENT_NUMBER_OVERRIDE_CHANGED");
assert.equal(events.length, 1);

// View: botão de alternar aparece e reflete o rótulo certo.
const htmlClientNumber = renderNumberDetailView({ number: numbers.getNumber("n1"), locations: [], responsibles: [], clients: [], groups: [], isClientNumber: true });
assert.match(htmlClientNumber, /Tirar de Números de Clientes/);
assert.match(htmlClientNumber, /definido manualmente/);
assert.match(htmlClientNumber, /Usar detecção automática/);

const htmlOperational = renderNumberDetailView({ number: { ...numbers.getNumber("n2"), clientNumberOverride: null }, locations: [], responsibles: [], clients: [], groups: [], isClientNumber: false });
assert.match(htmlOperational, /Marcar como Número de Cliente/);
assert.doesNotMatch(htmlOperational, /definido manualmente/);

console.log("Bloco 41: override manual de Número de Cliente (forçar dentro/fora, limpar, histórico, UI) validado.");
