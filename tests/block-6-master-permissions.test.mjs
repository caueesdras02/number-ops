import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isMaster, canHardDelete, assertLastMasterSafe, ACCESS_LEVELS } from "../src/js/models/access.js";
import { describeReferences, assertHardDeletable, applyLocalHardDelete } from "../src/js/models/hard-delete.js";
import { getUtilization, UTILIZATION } from "../src/js/models/number.js";
import { NumbersService } from "../src/js/services/numbers-service.js";
import { CampaignsService } from "../src/js/services/campaigns-service.js";
import { DirectoryService } from "../src/js/services/directory-service.js";
import { ProfilesService } from "../src/js/services/profiles-service.js";
import { renderResponsibleDetail } from "../src/js/ui/directory-view.js";
import { renderNumberForm, renderNumbersView } from "../src/js/ui/numbers-view.js";
import { renderCampaignDetail } from "../src/js/ui/campaigns-view.js";
import { renderIncidentForm } from "../src/js/ui/incidents-view.js";

// ---------------------------------------------------------------------------
// access.js
// ---------------------------------------------------------------------------
assert.deepEqual(ACCESS_LEVELS, ["MASTER", "ADMIN", "USER", "VIEWER"]);
assert.ok(isMaster({ access_level: "MASTER" }));
assert.ok(!isMaster({ access_level: "ADMIN" }));
assert.ok(canHardDelete("MASTER"));
assert.ok(!canHardDelete("ADMIN"));

const roster = [
  { id: "m1", access_level: "MASTER", status: "ACTIVE" },
  { id: "m2", access_level: "MASTER", status: "ACTIVE" },
  { id: "u1", access_level: "USER", status: "ACTIVE" },
];
assert.doesNotThrow(() => assertLastMasterSafe(roster, "m1", { nextLevel: "ADMIN" }));
const onlyMaster = [{ id: "m1", access_level: "MASTER", status: "ACTIVE" }, { id: "u1", access_level: "USER", status: "ACTIVE" }];
assert.throws(() => assertLastMasterSafe(onlyMaster, "m1", { nextLevel: "ADMIN" }), /MASTER ativo/);
assert.throws(() => assertLastMasterSafe(onlyMaster, "m1", { removing: true }), /MASTER ativo/);
assert.doesNotThrow(() => assertLastMasterSafe(onlyMaster, "m1", { nextLevel: "MASTER", nextStatus: "ACTIVE" }));

// ---------------------------------------------------------------------------
// number.js — utilização
// ---------------------------------------------------------------------------
const activeNumber = { status: "ACTIVE", archivedAt: null };
const blockedNumber = { status: "BLOCKED", archivedAt: null };
assert.equal(getUtilization(activeNumber, true), UTILIZATION.IN_USE);
assert.equal(getUtilization(activeNumber, false), UTILIZATION.AVAILABLE);
assert.equal(getUtilization(blockedNumber, false), UTILIZATION.UNAVAILABLE);
assert.equal(getUtilization(blockedNumber, true), UTILIZATION.IN_USE);

// ---------------------------------------------------------------------------
// hard-delete.js
// ---------------------------------------------------------------------------
const refState = {
  numbers: [{ id: "n1", clientIds: ["c1"], groupIds: ["s1"], locationId: "l1", responsibleId: "r1" }],
  clients: [{ id: "c1", squadId: "s1" }, { id: "c2", squadId: null }],
  groups: [{ id: "s1" }],
  responsibles: [{ id: "r1", squadId: "s1" }],
  locations: [{ id: "l1" }],
  campaigns: [{ id: "camp1", clientId: "c1", squadId: "s1", responsibleId: "r1" }],
  numberCampaignLinks: [{ id: "lk1", numberId: "n1", campaignId: "camp1", endedAt: null }],
  incidents: [{ id: "i1", numberId: "n1", responsibleId: "r1" }],
  historyEvents: [{ id: "h1", numberId: "n1" }],
};
assert.ok(describeReferences(refState, "numbers", "n1").blockers.length > 0, "número com histórico/vínculo é bloqueado");
assert.throws(() => assertHardDeletable(refState, "numbers", "n1"), /Não é possível excluir/);
assert.ok(describeReferences(refState, "clients", "c1").blockers.length > 0, "cliente em campanha é bloqueado");
assert.equal(describeReferences(refState, "clients", "c2").blockers.length, 0, "cliente sem uso é excluível");
assert.equal(describeReferences(refState, "locations", "l1").blockers.length, 0, "localização nunca bloqueia (set null)");
assert.equal(describeReferences(refState, "responsibles", "r1").blockers.length, 0, "colaborador nunca bloqueia (set null)");
assert.ok(describeReferences(refState, "campaigns", "camp1").blockers.length > 0, "campanha com vínculo é bloqueada");

const localState = JSON.parse(JSON.stringify(refState));
applyLocalHardDelete(localState, "locations", "l1");
assert.equal(localState.locations.length, 0);
assert.equal(localState.numbers[0].locationId, null, "número perde a localização");
applyLocalHardDelete(localState, "responsibles", "r1");
assert.equal(localState.numbers[0].responsibleId, null);
assert.equal(localState.incidents[0].responsibleId, null);
applyLocalHardDelete(localState, "groups", "s1");
assert.equal(localState.numbers[0].groupIds.length, 0);
assert.equal(localState.clients.find((c) => c.id === "c1").squadId, null);

// ---------------------------------------------------------------------------
// Services — hardDelete port
// ---------------------------------------------------------------------------
const seedState = () => ({
  schemaVersion: 2, meta: { seedApplied: true },
  numbers: [
    { id: "n1", phone: "5511999999991", identification: "Chip 1", status: "ACTIVE", locationId: "loc1", responsibleId: null, clientIds: ["c1"], groupIds: ["s1"], groupCount: 0, notes: "", restriction: null, archivedAt: null },
    { id: "n2", phone: "5511999999992", identification: "Chip 2", status: "BLOCKED", locationId: null, responsibleId: null, clientIds: [], groupIds: [], groupCount: 0, notes: "", restriction: null, archivedAt: null },
  ],
  clients: [{ id: "c1", name: "Cliente", squadId: "s1", isActive: true }, { id: "c2", name: "Sem squad", squadId: null, isActive: true }],
  groups: [{ id: "s1", name: "Nexus", isActive: true }],
  responsibles: [{ id: "r1", name: "Pedro", team: "Nexus", squadId: "s1", isActive: true }],
  locations: [{ id: "loc1", name: "Celular 01", isActive: true }, { id: "loc2", name: "Estoque", isActive: true }],
  incidents: [], historyEvents: [], campaigns: [], numberCampaignLinks: [],
});
let persisted = seedState();
const removed = [];
const repository = { initialize: () => JSON.parse(JSON.stringify(persisted)), save: (s) => { persisted = JSON.parse(JSON.stringify(s)); }, flush: () => Promise.resolve() };
const port = { locations: { remove: async (id) => removed.push(["locations", id]) }, clients: { remove: async (id) => removed.push(["clients", id]) }, groups: { remove: async (id) => removed.push(["squads", id]) }, campaigns: { remove: async (id) => removed.push(["campaigns", id]) }, numbers: { remove: async (id) => removed.push(["numbers", id]) }, responsibles: { remove: async (id) => removed.push(["responsibles", id]) } };
const numbers = new NumbersService(repository, { hardDeletePort: port });

assert.equal(numbers.utilizationOf("n1"), "AVAILABLE");
assert.equal(numbers.utilizationOf("n2"), "UNAVAILABLE");

// número com ocorrência/vínculo é bloqueado; histórico por si só é apenas um EFEITO (removido junto), não bloqueia
numbers.state.historyEvents.push({ id: "h9", numberId: "n1", type: "X", description: "x", occurredAt: new Date().toISOString() });
numbers.state.incidents.push({ id: "i9", numberId: "n1", type: "OTHER", title: "x", status: "OPEN" });
await assert.rejects(() => numbers.hardDelete("n1"), /Não é possível excluir/);
numbers.state.incidents = numbers.state.incidents.filter((i) => i.id !== "i9");
await assert.doesNotReject(() => numbers.hardDelete("n1"), "histórico isolado não deve bloquear a exclusão definitiva do número");
assert.ok(!numbers.state.numbers.some((n) => n.id === "n1"), "número removido");
assert.ok(!numbers.state.historyEvents.some((h) => h.numberId === "n1"), "histórico removido como efeito");

// localização sem uso: exclui via port + estado
const directory = new DirectoryService(numbers);
await directory.hardDelete("locations", "loc2");
assert.deepEqual(removed.at(-1), ["locations", "loc2"]);
assert.ok(!numbers.state.locations.some((l) => l.id === "loc2"));

// bulkAssignSquad
const changed = directory.bulkAssignSquad(["c2"], "s1");
assert.equal(changed, 1);
assert.equal(numbers.state.clients.find((c) => c.id === "c2").squadId, "s1");

// responsibles ganham squadId via update
directory.update("responsibles", "r1", { name: "Pedro", team: "Nexus", squadId: "s1" });
assert.equal(numbers.state.responsibles[0].squadId, "s1");

// port null (modo local): só mexe no estado
const localNumbers = new NumbersService({ initialize: () => seedState(), save: () => {}, flush: () => Promise.resolve() });
const localDir = new DirectoryService(localNumbers);
await localDir.hardDelete("locations", "loc2");
assert.ok(!localNumbers.state.locations.some((l) => l.id === "loc2"));

// campanhas
const campaigns = new CampaignsService(numbers);
const campaign = campaigns.create({ name: "C1", clientId: "c1", squadId: "s1", responsibleId: "r1" });
await assert.doesNotReject(() => campaigns.hardDelete(campaign.id));
assert.ok(!numbers.state.campaigns.some((c) => c.id === campaign.id));

// ---------------------------------------------------------------------------
// ProfilesService.hardDelete
// ---------------------------------------------------------------------------
const profileList = [
  { id: "m1", name: "Cauê", email: "c@x.com", access_level: "MASTER", status: "ACTIVE" },
  { id: "m2", name: "Outro", email: "o@x.com", access_level: "MASTER", status: "ACTIVE" },
  { id: "u1", name: "User", email: "u@x.com", access_level: "USER", status: "ACTIVE" },
];
const deleted = [];
const profilesSvc = new ProfilesService(
  { list: async () => profileList.map((p) => ({ ...p })), update: async () => {}, remove: async (id) => deleted.push(id) },
  { list: async () => [] },
);
await assert.rejects(() => profilesSvc.hardDelete("u1", { id: "u1", access_level: "USER" }), /Somente MASTER/);
await assert.rejects(() => profilesSvc.hardDelete("m1", { id: "m1", access_level: "MASTER" }), /próprio/);
await profilesSvc.hardDelete("u1", { id: "m1", access_level: "MASTER" });
assert.deepEqual(deleted, ["u1"]);

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
const respDetail = renderResponsibleDetail(
  { id: "r1", name: "Pedro", squadId: "s1", isActive: true },
  [{ id: "s1", name: "Nexus" }],
  [{ id: "c1", name: "Cliente A", squadId: "s1", isActive: true }, { id: "c2", name: "Cliente B", squadId: "outro", isActive: true }],
  [{ id: "camp1", name: "Campanha A", clientId: "c1", squadId: "s1", status: "ACTIVE" }],
  [{ id: "n1", phone: "5511999999991", identification: "Chip", status: "ACTIVE", responsibleId: "r1", locationId: null }],
  [],
);
assert.match(respDetail, /Nexus/);
assert.match(respDetail, /Cliente A/);
assert.doesNotMatch(respDetail, /Cliente B/, "só clientes do mesmo squad");
assert.match(respDetail, /Campanha A/);

const formHtml = renderNumberForm({ number: { id: "n1", phone: "5511999999991", clientIds: ["c1"], groupIds: [] }, locations: [], responsibles: [], clients: [{ id: "c1", name: "Cliente" }], groups: [] });
assert.match(formHtml, /Gerencie as campanhas vinculadas/);
assert.doesNotMatch(formHtml, /name="campaignId"/, "vínculo de campanha não faz mais parte do formulário — é multi-campanha, gerenciado no detalhe");

const listHtml = renderNumbersView([{ id: "n1", phone: "5511999999991", identification: "x", status: "ACTIVE", clientIds: [], groupIds: [], groupCount: 0, archivedAt: null }], [], [], "", "ALL", {}, [], [], true, [], [{ numberId: "n1", campaignId: "camp1", endedAt: null }]);
assert.match(listHtml, /Utilização/);
assert.match(listHtml, /data-filter="utilization"/);
assert.match(listHtml, /Em uso/);
assert.match(listHtml, /data-master-only/);

const campDetail = renderCampaignDetail({ item: { id: "camp1", name: "C", clientId: "c1", squadId: "s1", status: "ACTIVE", startedAt: "2026-01-01" }, clients: [], squads: [], responsibles: [], numbers: [{ id: "n1", phone: "5511999999991", status: "ACTIVE", locationId: null }], locations: [], links: [{ id: "lk1", numberId: "n1", role: "PRIMARY", startedAt: "2026-01-01", endedAt: null }, { id: "lk2", numberId: "n1", role: "BACKUP", startedAt: "2025-12-01", endedAt: "2025-12-31" }], allLinks: [{ numberId: "n1", endedAt: null }] });
assert.match(campDetail, /Números atuais/);
assert.match(campDetail, /Histórico de números/);

const incForm = renderIncidentForm(null, [{ id: "n1", phone: "5511999999991" }], []);
assert.match(incForm, /name="type"/);

// ---------------------------------------------------------------------------
// Migrations 008 / 009
// ---------------------------------------------------------------------------
const m008 = await readFile(new URL("../supabase/008_master_access_level.sql", import.meta.url), "utf8");
assert.match(m008, /add value if not exists 'MASTER'/i);
assert.doesNotMatch(m008, /\bbegin;/i, "008 não deve abrir transação");

const m009 = await readFile(new URL("../supabase/009_master_permissions_and_cleanup.sql", import.meta.url), "utf8");
assert.match(m009, /create or replace function public\.current_is_master/i);
assert.match(m009, /create or replace function public\.enforce_profile_rules/i);
assert.match(m009, /add column if not exists squad_id/i);
assert.match(m009, /caueworkspace@gmail\.com/);
assert.match(m009, /acaccacac@gmail\.com/);
assert.match(m009, /delete from auth\.users/i);
for (const action of ["NUMBER_DELETED", "CLIENT_DELETED", "SQUAD_DELETED", "CAMPAIGN_DELETED", "LOCATION_DELETED", "RESPONSIBLE_DELETED"]) assert.match(m009, new RegExp(`'${action}'`));
assert.doesNotMatch(m009, /truncate|drop table/i);
assert.match(m009, /current_is_master\(\)/);

console.log("Bloco 6: MASTER, exclusão definitiva, utilização, colaborador→squad e migrations 008/009 validados.");
