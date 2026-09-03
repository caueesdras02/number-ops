import assert from "node:assert/strict";
import { NumbersService } from "../src/js/services/numbers-service.js";
import { CampaignsService } from "../src/js/services/campaigns-service.js";
import { renderDirectoryDetail } from "../src/js/ui/directory-view.js";
import { renderNumbersView, renderNumberForm } from "../src/js/ui/numbers-view.js";
import { renderNumberDetailView } from "../src/js/ui/number-detail-view.js";
import { renderCampaignDetail } from "../src/js/ui/campaigns-view.js";

const state = {
  schemaVersion: 2, meta: { seedApplied: true },
  groups: [{ id: "s1", name: "Squad 1", isActive: true }],
  clients: [{ id: "c1", name: "Cliente 1", squadId: "s1", isActive: true }],
  campaigns: [
    { id: "ca", name: "Atual", clientId: "c1", squadId: "s1", status: "ACTIVE", startedAt: "2026-01-01T00:00:00.000Z" },
    { id: "ch", name: "Anterior", clientId: "c1", squadId: "s1", status: "CLOSED", startedAt: "2025-01-01T00:00:00.000Z", endedAt: "2025-02-01T00:00:00.000Z" },
  ],
  numbers: [{ id: "n1", phone: "5511999999999", identification: "Chip 1", status: "ACTIVE", groupCount: 12, clientIds: ["c1"], groupIds: ["s1"], locationId: null, responsibleId: null, notes: "", restriction: null, archivedAt: null }],
  numberCampaignLinks: [{ id: "l1", numberId: "n1", campaignId: "ca", role: "PRIMARY", startedAt: "2026-01-01T00:00:00.000Z", endedAt: null }],
  responsibles: [], locations: [], incidents: [], historyEvents: [],
};
let persisted = structuredClone(state);
const repository = { initialize: () => structuredClone(persisted), save: (value) => { persisted = structuredClone(value); } };
const numbers = new NumbersService(repository);
const campaigns = new CampaignsService(numbers);

const clientHtml = renderDirectoryDetail("clients", state.clients[0], state.numbers, [], [], state.campaigns, state.groups, state.numberCampaignLinks);
assert.match(clientHtml, /Campanhas atuais/);
assert.match(clientHtml, /Campanhas anteriores/);
assert.match(clientHtml, /Finalizar campanha/);
assert.match(clientHtml, /Atual/);
assert.match(clientHtml, /Anterior/);
assert.match(renderCampaignDetail({ item: state.campaigns[1], clients: state.clients, squads: state.groups, numbers: state.numbers, links: [] }), /Campanha anterior|Anterior/i);

assert.match(renderNumbersView(state.numbers, [], [], "", "ALL", {}, state.clients, state.groups), /Quantidade de grupos/);
assert.match(renderNumberForm({ number: state.numbers[0], locations: [], responsibles: [], clients: state.clients, groups: state.groups }), /name="groupCount"/);
assert.match(renderNumberDetailView({ number: state.numbers[0], locations: [], responsibles: [], clients: state.clients, groups: state.groups, historyEvents: [], incidents: [] }), /Quantidade de grupos/);

numbers.update("n1", { ...numbers.getNumber("n1"), groupCount: "18" });
assert.equal(numbers.getNumber("n1").groupCount, 18);
const groupEvent = numbers.state.historyEvents.find((event) => event.type === "GROUP_COUNT_CHANGED");
assert.equal(groupEvent.metadata.previousValue, 12);
assert.equal(groupEvent.metadata.newValue, 18);
assert.throws(() => numbers.update("n1", { ...numbers.getNumber("n1"), groupCount: "-1" }), /inteiro maior ou igual a zero/);

campaigns.close("ca");
assert.equal(campaigns.get("ca").status, "CLOSED");
assert.ok(campaigns.get("ca").endedAt);
assert.ok(campaigns.linksFor("n1")[0].endedAt);
assert.ok(numbers.state.historyEvents.some((event) => event.type === "CAMPAIGN_LEFT"));

const reloaded = new NumbersService(repository);
assert.equal(reloaded.getNumber("n1").groupCount, 18);
assert.equal(reloaded.state.campaigns.find((campaign) => campaign.id === "ca").status, "CLOSED");
assert.ok(reloaded.state.numberCampaignLinks[0].endedAt);
assert.ok(reloaded.state.historyEvents.some((event) => event.type === "GROUP_COUNT_CHANGED"));
assert.ok(reloaded.state.historyEvents.some((event) => event.type === "CAMPAIGN_LEFT"));

console.log("Bloco 2: campanhas do Cliente e groupCount visível/persistente validados.");
