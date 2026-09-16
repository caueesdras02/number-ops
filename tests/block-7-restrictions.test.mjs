import assert from "node:assert/strict";
import { NumbersService } from "../src/js/services/numbers-service.js";
import { CampaignsService } from "../src/js/services/campaigns-service.js";
import { DashboardService } from "../src/js/services/dashboard-service.js";
import { hasBlockingRestriction, getUtilization } from "../src/js/models/number.js";
import { renderRestrictionForm, renderNumberDetailView } from "../src/js/ui/number-detail-view.js";

// ---------------------------------------------------------------------------
// BLOCO 0 — restrições operacionais e "Sem área" (NO_AREA)
// ---------------------------------------------------------------------------

const state = {
  schemaVersion: 2, meta: { seedApplied: true },
  groups: [{ id: "s1", name: "Squad Nexus", isActive: true }],
  clients: [{ id: "c1", name: "Cliente 1", squadId: "s1", isActive: true }],
  responsibles: [{ id: "r1", name: "Pedro Melo", team: "Nexus", isActive: true }],
  campaigns: [],
  numbers: [
    { id: "rn1", phone: "5511988880001", identification: "Normal", status: "ACTIVE", groupCount: 1, clientIds: [], groupIds: [], locationId: null, responsibleId: null, notes: "", restriction: null, archivedAt: null },
    { id: "rn2", phone: "5511988880002", identification: "Sem área", status: "ACTIVE", groupCount: 1, clientIds: [], groupIds: [], locationId: null, responsibleId: null, notes: "", restriction: null, archivedAt: null },
    { id: "rn3", phone: "5511988880003", identification: "Restrição antiga (não bloqueante)", status: "ACTIVE", groupCount: 1, clientIds: [], groupIds: [], locationId: null, responsibleId: null, notes: "", restriction: { kind: "GROUP_CREATION", description: "Não consegue criar squads", recordedAt: "2026-01-01T00:00:00.000Z" }, archivedAt: null },
  ],
  numberCampaignLinks: [], incidents: [], historyEvents: [], locations: [],
};
let persisted = structuredClone(state);
const repository = { initialize: () => structuredClone(persisted), save: (value) => { persisted = structuredClone(value); } };
const numbers = new NumbersService(repository);
const campaigns = new CampaignsService(numbers);
const campaign = campaigns.create({ name: "Campanha Restrição", clientId: "c1", squadId: "s1", responsibleId: "r1", notes: "" });

// 1) número normal e sem campanha => Disponível
assert.equal(numbers.utilizationOf("rn1"), "AVAILABLE");
assert.ok(campaigns.availableNumbers().some((item) => item.id === "rn1"));

// 2) restrição antiga (GROUP_CREATION) NÃO bloqueia — continua funcionando conforme semântica atual
assert.equal(hasBlockingRestriction(numbers.getNumber("rn3")), false);
assert.equal(numbers.utilizationOf("rn3"), "AVAILABLE", "GROUP_CREATION é uma limitação registrada, mas não retira o número de operação");
assert.ok(campaigns.availableNumbers().some((item) => item.id === "rn3"));

// 3) registra NO_AREA em rn2 => número não pode aparecer como Disponível
numbers.registerRestriction("rn2", { kind: "NO_AREA" });
assert.equal(hasBlockingRestriction(numbers.getNumber("rn2")), true);
assert.equal(numbers.utilizationOf("rn2"), "UNAVAILABLE", "NO_AREA deve tornar o número indisponível mesmo com status ACTIVE");
assert.equal(getUtilization(numbers.getNumber("rn2"), false), "UNAVAILABLE");

// 4) NO_AREA => não sugerido para campanha (availableNumbers / availableNumbersFor)
assert.ok(!campaigns.availableNumbers().some((item) => item.id === "rn2"), "número com NO_AREA não deve entrar na lista de disponíveis para vincular");
assert.ok(!campaigns.availableNumbersFor(campaign.id).some((item) => item.id === "rn2"));

// 5) número continua visível, pesquisável e identificado (não some do sistema)
assert.ok(numbers.getNumber("rn2"), "número permanece existindo/consultável");
assert.equal(numbers.getNumbers("988880002").length, 1, "continua encontrável por busca de telefone");
assert.equal(numbers.getNumber("rn2").restriction.kind, "NO_AREA");
assert.equal(numbers.getNumber("rn2").status, "ACTIVE", "status operacional principal não é alterado pela restrição");

// 6) filtro de utilização "Indisponível" passa a incluir o número com NO_AREA
const unavailableFiltered = numbers.getNumbers("", { utilization: "UNAVAILABLE" }).map((item) => item.id);
assert.ok(unavailableFiltered.includes("rn2"));
assert.ok(!numbers.getNumbers("", { utilization: "AVAILABLE" }).map((item) => item.id).includes("rn2"));

// 7) tentativa de vínculo indevido (novo vínculo em número com NO_AREA) é bloqueada
assert.throws(() => campaigns.assign("rn2", campaign.id, "PRIMARY"), /restrição operacional ativa|Sem área/i);
assert.equal(campaigns.activeLinksFor("rn2").length, 0, "nenhum vínculo deve ter sido criado");

// 8) dashboard não conta número com NO_AREA como disponível
const dashboard = new DashboardService(numbers).getData();
assert.equal(dashboard.metrics.available, 2, "só rn1 e rn3 são contados como disponíveis (rn2 tem NO_AREA)");
assert.equal(dashboard.metrics.total, 3);

// 9) remoção da restrição => disponibilidade recalculada, sem apagar histórico
numbers.removeRestriction("rn2");
assert.equal(numbers.getNumber("rn2").restriction, null);
assert.equal(numbers.utilizationOf("rn2"), "AVAILABLE", "sem restrição ativa, volta a ser disponível");
assert.ok(campaigns.availableNumbers().some((item) => item.id === "rn2"), "volta a ser sugerido para campanha após remoção");

// 10) histórico da restrição é preservado (registro de criação E remoção continuam no histórico do número)
const history = numbers.history.list("rn2").map((item) => item.type);
assert.ok(history.includes("NUMBER_RESTRICTION_RECORDED"), "histórico preserva o registro da restrição NO_AREA");
assert.ok(history.includes("NUMBER_RESTRICTION_REMOVED"), "histórico preserva a remoção da restrição");

// 11) agora que a restrição foi removida, o vínculo que antes era bloqueado passa a funcionar
const link = campaigns.assign("rn2", campaign.id, "PRIMARY");
assert.ok(link);
assert.equal(campaigns.activeLinksFor("rn2").length, 1);

// 12) troca de papel em vínculo já existente não é tratada como "novo vínculo" — não deve ser bloqueada
// mesmo que uma restrição bloqueante seja registrada depois de o vínculo já existir (não força desvinculação retroativa).
numbers.registerRestriction("rn2", { kind: "NO_AREA" });
const roleChange = campaigns.assign("rn2", campaign.id, "BACKUP");
assert.equal(roleChange.role, "BACKUP", "troca de papel em vínculo já existente continua permitida");
assert.equal(campaigns.activeLinksFor("rn2").length, 1, "não duplica vínculo");
numbers.removeRestriction("rn2");

// 13) UI: formulário de restrição oferece a opção NO_AREA (Sem área), distinta de GROUP_CREATION
const formHtml = renderRestrictionForm(numbers.getNumber("rn1"));
assert.match(formHtml, /value="NO_AREA"/);
assert.match(formHtml, /value="GROUP_CREATION"/, "GROUP_CREATION continua existindo como opção separada, não foi reaproveitada/renomeada");

// 14) detalhe do número: com restrição bloqueante ativa e sem vínculos, não oferece "+ Adicionar campanha"
// e indica claramente a restrição em vez de dizer "Disponível".
numbers.registerRestriction("rn2", { kind: "NO_AREA" });
const blockedDetailHtml = renderNumberDetailView({ number: numbers.getNumber("rn2"), locations: [], responsibles: [], clients: [], groups: [], campaigns: [], campaignLinks: [], utilization: numbers.utilizationOf("rn2") });
assert.doesNotMatch(blockedDetailHtml, /data-action="manage-campaign"/, "não deve oferecer vínculo de nova campanha enquanto restrição bloqueante estiver ativa");
assert.match(blockedDetailHtml, /restrição operacional ativa/i);
assert.doesNotMatch(blockedDetailHtml, />Disponível — nenhum vínculo/, "não deve dizer Disponível quando há restrição bloqueante");
numbers.removeRestriction("rn2");

console.log("Bloco 0 (restrições / Sem área): todos os cenários passaram.");
