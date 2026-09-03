import assert from "node:assert/strict";
import { BackupService } from "../src/js/services/backup-service.js";
import { AppRepository } from "../src/js/repositories/app-repository.js";

const baseState = {
  schemaVersion: 2,
  meta: { seedApplied: true },
  groups: [{ id: "s1", name: "Squad 1" }],
  clients: [{ id: "c1", name: "Cliente 1", squadId: "s1" }],
  campaigns: [
    { id: "cp1", name: "Campanha ativa", clientId: "c1", squadId: "s1", status: "ACTIVE" },
    { id: "cp2", name: "Campanha encerrada", clientId: "c1", squadId: "s1", status: "CLOSED" },
  ],
  numbers: [{
    id: "n1", phone: "5511000000000", status: "ACTIVE", groupCount: 8,
    clientIds: ["c1"], groupIds: ["s1"], responsibleId: "r1", locationId: "loc1",
    restriction: { reason: "Teste", startedAt: "2026-01-01" },
  }],
  numberCampaignLinks: [
    { id: "l1", numberId: "n1", campaignId: "cp2", role: "PRIMARY", startedAt: "2026-01-01", endedAt: "2026-02-01" },
    { id: "l2", numberId: "n1", campaignId: "cp1", role: "SUPPORT", startedAt: "2026-02-01", endedAt: null },
  ],
  responsibles: [{ id: "r1", name: "Pessoa" }],
  locations: [{ id: "loc1", name: "Celular 1" }],
  incidents: [{ id: "i1", numberId: "n1", responsibleId: "r1", resolvedById: null }],
  historyEvents: [{ id: "h1", numberId: "n1", type: "CAMPAIGN_CHANGE", description: "Troca", occurredAt: "2026-02-01" }],
  customPersistedStructure: { enabled: true },
};

let persisted = null;
const repository = {
  save: (state) => { persisted = structuredClone(state); },
  saveRecoveryBackup: () => true,
  readRecoveryBackup: () => null,
};
const numbersService = {
  state: structuredClone(baseState),
  repository,
  replaceState(state) { this.state = state; repository.save(state); },
};
const backup = new BackupService(numbersService);

const exported = backup.createExport();
const envelope = JSON.parse(exported.json);
assert.equal(envelope.kind, "number-ops-backup");
assert.equal(envelope.formatVersion, 2);
assert.equal(envelope.schemaVersion, 2);
assert.deepEqual(envelope.state.customPersistedStructure, { enabled: true });
assert.deepEqual(envelope.state.numberCampaignLinks, baseState.numberCampaignLinks);
assert.equal(envelope.state.numbers[0].groupCount, 8);
assert.equal(envelope.state.clients[0].squadId, "s1");

const analyzed = backup.inspect(exported.json);
assert.equal(analyzed.summary.campaigns, 2);
assert.equal(analyzed.summary.numberCampaignLinks, 2);
numbersService.state = { numbers: [] };
backup.restore(analyzed);
assert.deepEqual(persisted, analyzed.state);
assert.deepEqual(persisted.customPersistedStructure, { enabled: true });

const reloaded = new AppRepository({ read: () => structuredClone(persisted), save: () => {} }).initialize();
assert.equal(reloaded.schemaVersion, 2);
assert.equal(reloaded.numbers[0].groupCount, 8);
assert.equal(reloaded.clients[0].squadId, "s1");
assert.deepEqual(reloaded.numberCampaignLinks, baseState.numberCampaignLinks);

const legacyState = {
  schemaVersion: 1,
  meta: { seedApplied: true },
  numbers: [{ id: "old-n", phone: "5511999999999", status: "ACTIVE" }],
  clients: [{ id: "old-c", name: "Antigo" }],
  groups: [], responsibles: [], locations: [], incidents: [], historyEvents: [],
};
for (const legacy of [
  legacyState,
  { kind: "number-ops-backup", formatVersion: 1, exportedAt: "2025-01-01T00:00:00.000Z", state: legacyState },
  { format: "number-ops", backupVersion: 2, data: legacyState },
]) {
  const result = backup.inspect(JSON.stringify(legacy));
  assert.equal(result.state.numbers[0].groupCount, 0);
  assert.equal(result.state.clients[0].squadId, null);
  assert.deepEqual(result.state.campaigns, []);
  assert.deepEqual(result.state.numberCampaignLinks, []);
}

const unchanged = structuredClone(numbersService.state);
assert.throws(() => backup.inspect("{inválido"), /JSON válido/);
assert.deepEqual(numbersService.state, unchanged);
assert.throws(() => backup.inspect({ ...baseState, clients: [{ id: "c1", name: "Cliente", squadId: "missing" }] }), /Squad inexistente/);
assert.throws(() => backup.inspect({ ...baseState, campaigns: [{ ...baseState.campaigns[0], clientId: "missing" }], numberCampaignLinks: [] }), /Cliente inexistente/);
assert.throws(() => backup.inspect({ ...baseState, numberCampaignLinks: [{ id: "bad", numberId: "missing", campaignId: "cp1", role: "BACKUP", endedAt: null }] }), /Número inexistente/);
assert.throws(() => backup.inspect({ ...baseState, numbers: [{ ...baseState.numbers[0], groupCount: -1 }] }), /groupCount inválido/);
assert.throws(() => backup.inspect({ ...baseState, numbers: [baseState.numbers[0], baseState.numbers[0]] }), /IDs ausentes ou duplicados/);
assert.throws(() => backup.inspect({ ...baseState, campaigns: "não é lista" }), /deve ser uma lista/);
assert.throws(() => backup.inspect({ kind: "outro", state: baseState }), /não é um backup/);
assert.throws(() => backup.inspect({ kind: "number-ops-backup", formatVersion: 99, state: baseState }), /não é compatível/);
assert.deepEqual(numbersService.state, unchanged);

console.log("Bloco 2B: exportação, ciclo de restauração/reload, legado e referências validados.");
