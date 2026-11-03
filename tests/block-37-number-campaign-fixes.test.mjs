import assert from "node:assert/strict";
import { describeReferences, assertHardDeletable } from "../src/js/models/hard-delete.js";
import { NumbersService } from "../src/js/services/numbers-service.js";
import { CampaignsService } from "../src/js/services/campaigns-service.js";

// ---------------------------------------------------------------------------
// hard-delete.js — vínculo de campanha ENCERRADO não deve bloquear exclusão
// definitiva pra sempre; só vínculo ATIVO bloqueia.
// ---------------------------------------------------------------------------
const endedLinkState = {
  numbers: [{ id: "n1" }],
  numberCampaignLinks: [{ id: "lk1", numberId: "n1", campaignId: "camp1", endedAt: "2025-01-01T00:00:00.000Z" }],
  incidents: [], historyEvents: [],
};
assert.equal(describeReferences(endedLinkState, "numbers", "n1").blockers.length, 0, "vínculo encerrado não deve bloquear");
assert.ok(describeReferences(endedLinkState, "numbers", "n1").effects.some((e) => /encerrado/.test(e.label)), "vínculo encerrado deve aparecer como efeito");
assert.doesNotThrow(() => assertHardDeletable(endedLinkState, "numbers", "n1"));

const activeLinkState = {
  numbers: [{ id: "n1" }],
  numberCampaignLinks: [{ id: "lk1", numberId: "n1", campaignId: "camp1", endedAt: null }],
  incidents: [], historyEvents: [],
};
assert.ok(describeReferences(activeLinkState, "numbers", "n1").blockers.length > 0, "vínculo ativo deve bloquear");
assert.throws(() => assertHardDeletable(activeLinkState, "numbers", "n1"), /Não é possível excluir/);

// ---------------------------------------------------------------------------
// NumbersService — archive() encerra vínculos de campanha ativos (não pode ficar
// "arquivado" e "em uso em campanha" ao mesmo tempo).
// ---------------------------------------------------------------------------
const seedState = () => ({
  schemaVersion: 2, meta: { seedApplied: true },
  numbers: [
    { id: "n1", phone: "5511999999991", identification: "Chip 1", status: "ACTIVE", locationId: null, responsibleId: null, clientIds: [], groupIds: [], groupCount: 0, notes: "", restriction: null, archivedAt: null },
  ],
  clients: [{ id: "c1", name: "Cliente", squadId: "s1", isActive: true }],
  groups: [{ id: "s1", name: "Nexus", isActive: true }],
  responsibles: [{ id: "r1", name: "Pedro", team: "Nexus", squadId: "s1", isActive: true }],
  locations: [], incidents: [], historyEvents: [], campaigns: [], numberCampaignLinks: [],
});
const repository = (() => { let state = seedState(); return { initialize: () => JSON.parse(JSON.stringify(state)), save: (s) => { state = JSON.parse(JSON.stringify(s)); }, flush: () => Promise.resolve() }; })();
const numbers = new NumbersService(repository);
const campaigns = new CampaignsService(numbers);
const campA = campaigns.create({ name: "Campanha A", clientId: "c1", squadId: "s1", responsibleId: "r1" });
const campB = campaigns.create({ name: "Campanha B", clientId: "c1", squadId: "s1", responsibleId: "r1" });
campaigns.assign("n1", campA.id, "PRIMARY");
campaigns.assign("n1", campB.id, "BACKUP");
assert.equal(campaigns.activeLinksFor("n1").length, 2, "número pode estar em 2 campanhas simultaneamente (intencional)");

numbers.archive("n1");
assert.equal(campaigns.activeLinksFor("n1").length, 0, "arquivar deve encerrar todos os vínculos ativos");
assert.equal(numbers.state.numberCampaignLinks.filter((l) => l.numberId === "n1" && l.endedAt).length, 2, "os 2 vínculos devem constar como encerrados, não apagados");

// ---------------------------------------------------------------------------
// NumbersService.getNumbers — filtro por campanha não pode perder número que está
// em 2+ campanhas simultaneamente (bug: usava .find, só via a 1ª campanha encontrada).
// ---------------------------------------------------------------------------
const repository2 = (() => { let state = seedState(); return { initialize: () => JSON.parse(JSON.stringify(state)), save: (s) => { state = JSON.parse(JSON.stringify(s)); }, flush: () => Promise.resolve() }; })();
const numbers2 = new NumbersService(repository2);
const campaigns2 = new CampaignsService(numbers2);
const camp1 = campaigns2.create({ name: "Campanha 1", clientId: "c1", squadId: "s1", responsibleId: "r1" });
const camp2 = campaigns2.create({ name: "Campanha 2", clientId: "c1", squadId: "s1", responsibleId: "r1" });
campaigns2.assign("n1", camp1.id, "PRIMARY");
campaigns2.assign("n1", camp2.id, "BACKUP");
assert.equal(numbers2.getNumbers("", { campaignId: camp1.id }).length, 1, "deve achar o número filtrando pela 1ª campanha vinculada");
assert.equal(numbers2.getNumbers("", { campaignId: camp2.id }).length, 1, "deve achar o número filtrando pela 2ª campanha vinculada também");

console.log("Bloco 37: exclusão definitiva com vínculo encerrado, arquivar encerrando vínculos ativos e filtro multi-campanha validados.");
