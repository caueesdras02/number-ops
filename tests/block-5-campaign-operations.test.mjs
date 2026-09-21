import assert from "node:assert/strict";
import { NumbersService } from "../src/js/services/numbers-service.js";
import { CampaignsService } from "../src/js/services/campaigns-service.js";
import { DashboardService } from "../src/js/services/dashboard-service.js";
import { renderCampaignDetail, renderCampaigns, renderCampaignForm, renderCampaignLinkAddForm, renderChangeRoleForm } from "../src/js/ui/campaigns-view.js";
import { renderNumberDetailView } from "../src/js/ui/number-detail-view.js";

const state = {
  schemaVersion: 2, meta: { seedApplied: true },
  groups: [{ id: "s1", name: "Squad Nexus", isActive: true }, { id: "s2", name: "Squad Vega", isActive: true }],
  clients: [{ id: "c1", name: "Cliente 1", squadId: "s1", isActive: true }, { id: "c2", name: "Cliente 2", squadId: "s2", isActive: true }],
  responsibles: [{ id: "r1", name: "Pedro Melo", team: "Nexus", isActive: true }],
  campaigns: [],
  numbers: [
    { id: "n1", phone: "5511999999991", identification: "Chip 1", status: "ACTIVE", groupCount: 1, clientIds: [], groupIds: [], locationId: null, responsibleId: null, notes: "", restriction: null, archivedAt: null },
    { id: "n2", phone: "5511999999992", identification: "Chip 2", status: "ACTIVE", groupCount: 1, clientIds: ["c1"], groupIds: ["s1"], locationId: null, responsibleId: null, notes: "", restriction: null, archivedAt: null },
    { id: "n3", phone: "5511999999993", identification: "Chip 3 arquivado", status: "INACTIVE", groupCount: 0, clientIds: [], groupIds: [], locationId: null, responsibleId: null, notes: "", restriction: null, archivedAt: "2026-01-01T00:00:00.000Z" },
  ],
  numberCampaignLinks: [], incidents: [], historyEvents: [], locations: [],
};
let persisted = structuredClone(state);
const repository = { initialize: () => structuredClone(persisted), save: (value) => { persisted = structuredClone(value); } };
const numbers = new NumbersService(repository);
const campaigns = new CampaignsService(numbers);

// 1) responsável é obrigatório na criação
assert.throws(() => campaigns.create({ name: "Sem responsável", clientId: "c1", squadId: "s1" }), /responsável/i);

// 2) criação com responsável funciona e é persistida
const campaignA = campaigns.create({ name: "Appel Home", clientId: "c1", squadId: "s1", responsibleId: "r1", notes: "" });
assert.equal(campaignA.responsibleId, "r1");
assert.equal(campaignA.status, "ACTIVE");
const campaignB = campaigns.create({ name: "Embaixador Móveis", clientId: "c2", squadId: "s2", responsibleId: "r1", notes: "" });

// 3) availableNumbers() exclui números arquivados
const available = campaigns.availableNumbers().map((item) => item.id);
assert.deepEqual(available.sort(), ["n1", "n2"]);

// ---------------------------------------------------------------------------
// MÚLTIPLAS CAMPANHAS SIMULTÂNEAS POR NÚMERO
// ---------------------------------------------------------------------------

// 4) número sem campanha nenhuma
assert.equal(campaigns.activeLinksFor("n1").length, 0);
assert.equal(numbers.utilizationOf("n1"), "AVAILABLE");

// 5) número com 1 campanha => EM USO
campaigns.assign("n1", campaignA.id, "PRIMARY");
assert.equal(campaigns.activeLinksFor("n1").length, 1);
assert.equal(numbers.utilizationOf("n1"), "IN_USE");

// 6) número com 2+ campanhas simultâneas (vínculo com A não é afetado ao vincular com B)
campaigns.assign("n1", campaignB.id, "SUPPORT");
assert.equal(campaigns.activeLinksFor("n1").length, 2, "número deve ter 2 vínculos ativos simultâneos");
assert.ok(campaigns.activeLinkForPair("n1", campaignA.id), "vínculo com A permanece ativo");
assert.ok(campaigns.activeLinkForPair("n1", campaignB.id), "vínculo com B foi criado");
assert.equal(numbers.utilizationOf("n1"), "IN_USE");

// 7) trocar o PAPEL na MESMA campanha encerra só aquele vínculo e cria outro (histórico preservado), sem afetar a outra campanha
campaigns.assign("n1", campaignA.id, "BACKUP");
assert.equal(campaigns.activeLinksFor("n1").length, 2, "ainda 2 vínculos ativos (A com novo papel + B)");
assert.equal(campaigns.activeLinkForPair("n1", campaignA.id).role, "BACKUP");
assert.equal(campaigns.activeLinkForPair("n1", campaignB.id).role, "SUPPORT", "vínculo com B não foi afetado pela troca de papel em A");
assert.equal(campaigns.linksFor("n1").filter((l) => l.campaignId === campaignA.id).length, 2, "histórico de A preserva o vínculo PRIMARY encerrado + o BACKUP atual");

// 8) remover uma campanha mantém a outra ativa
campaigns.unassign("n1", campaignB.id);
assert.equal(campaigns.activeLinksFor("n1").length, 1, "remover B deve manter A ativo");
assert.ok(campaigns.activeLinkForPair("n1", campaignA.id));
assert.equal(numbers.utilizationOf("n1"), "IN_USE", "ainda em uso por causa de A");

// 9) remover a ÚLTIMA campanha ativa muda utilização para Disponível (número apto)
campaigns.unassign("n1", campaignA.id);
assert.equal(campaigns.activeLinksFor("n1").length, 0);
assert.equal(numbers.utilizationOf("n1"), "AVAILABLE", "sem nenhum vínculo ativo e apto => Disponível");

// ---------------------------------------------------------------------------
// CLIENTE/SQUAD DERIVADO AUTOMATICAMENTE PELA CAMPANHA
// ---------------------------------------------------------------------------

// 10) vincular n1 (sem cliente/squad) à campanha A deriva cliente c1 e squad s1 automaticamente
campaigns.assign("n1", campaignA.id, "PRIMARY");
assert.ok(numbers.getNumber("n1").clientIds.includes("c1"), "cliente da campanha deve ser associado ao número");
assert.ok(numbers.getNumber("n1").groupIds.includes("s1"), "squad da campanha deve ser associado ao número");

// 11) vincular o MESMO número a uma campanha de OUTRO cliente PRESERVA a associação anterior (não substitui)
campaigns.assign("n1", campaignB.id, "SUPPORT");
assert.deepEqual(numbers.getNumber("n1").clientIds.sort(), ["c1", "c2"], "associações anteriores válidas não são apagadas");
assert.deepEqual(numbers.getNumber("n1").groupIds.sort(), ["s1", "s2"]);

// 12) associar de novo não duplica IDs
campaigns.assign("n1", campaignA.id, "BACKUP"); // troca de papel na mesma campanha, mesmo cliente/squad
assert.equal(numbers.getNumber("n1").clientIds.filter((id) => id === "c1").length, 1, "sem IDs duplicados");
assert.equal(numbers.getNumber("n1").groupIds.filter((id) => id === "s1").length, 1);

campaigns.unassign("n1", campaignA.id);
campaigns.unassign("n1", campaignB.id);

// 12b) RECONCILIAÇÃO: vínculo pré-existente criado ANTES de deriveClientAndSquad existir
// (ex.: número já vinculado a duas campanhas de clientes diferentes, mas só um cliente foi
// "puxado" — cenário real encontrado em produção). Simula o vínculo bruto direto no estado,
// sem passar por assign(), como estava a base antes desta função existir.
const numberWithoutDerivation = numbers.create({ phone: "5511999999994", groupCount: 0, clientIds: [], groupIds: [] });
numbers.state.numberCampaignLinks.push({ id: "link_legacy_a", numberId: numberWithoutDerivation.id, campaignId: campaignA.id, role: "PRIMARY", startedAt: new Date().toISOString(), endedAt: null });
numbers.state.numberCampaignLinks.push({ id: "link_legacy_b", numberId: numberWithoutDerivation.id, campaignId: campaignB.id, role: "SUPPORT", startedAt: new Date().toISOString(), endedAt: null });
assert.deepEqual(numbers.getNumber(numberWithoutDerivation.id).clientIds, [], "antes da reconciliação, nenhum cliente foi derivado (vínculo criado fora do assign())");
campaigns.reconcileClientSquadFromActiveLinks();
assert.deepEqual(numbers.getNumber(numberWithoutDerivation.id).clientIds.sort(), ["c1", "c2"], "reconciliação deve derivar os clientes das DUAS campanhas vinculadas, não só a primeira");
assert.deepEqual(numbers.getNumber(numberWithoutDerivation.id).groupIds.sort(), ["s1", "s2"]);
campaigns.reconcileClientSquadFromActiveLinks(); // idempotente: rodar de novo não duplica nem falha
assert.equal(numbers.getNumber(numberWithoutDerivation.id).clientIds.filter((id) => id === "c1").length, 1);
campaigns.unassign(numberWithoutDerivation.id, campaignA.id);
campaigns.unassign(numberWithoutDerivation.id, campaignB.id);
numbers.archive(numberWithoutDerivation.id); // número auxiliar deste teste não deve poluir as contagens do dashboard abaixo

// ---------------------------------------------------------------------------
// DASHBOARD: um número em várias campanhas conta apenas UMA vez como "Em uso"
// ---------------------------------------------------------------------------

// 13) n2 entra em DUAS campanhas simultâneas
campaigns.assign("n2", campaignA.id, "PRIMARY");
campaigns.assign("n2", campaignB.id, "BACKUP");
assert.equal(campaigns.activeLinksFor("n2").length, 2);
const dashboard = new DashboardService(numbers).getData();
assert.equal(dashboard.metrics.inUse, 1, "n2 em 2 campanhas continua contando como 1 número em uso, não 2");
assert.equal(dashboard.metrics.total, 2, "n1 arquivado (n3) não conta; n1 e n2 ativos contam uma vez cada");
campaigns.unassign("n2", campaignA.id);
campaigns.unassign("n2", campaignB.id);

// ---------------------------------------------------------------------------
// CAMPANHA → NÚMERO: vincular vários números de uma vez, com função individual por número
// ---------------------------------------------------------------------------

// 14) availableNumbersFor exclui números já vinculados ativamente à MESMA campanha
campaigns.assign("n1", campaignA.id, "PRIMARY");
const availableForA = campaigns.availableNumbersFor(campaignA.id).map((n) => n.id);
assert.ok(!availableForA.includes("n1"), "n1 já está ativo em A, não deve aparecer para vincular de novo");
assert.ok(availableForA.includes("n2"), "n2 não está em A, deve aparecer disponível");
campaigns.unassign("n1", campaignA.id);

// 15) formulário "Vincular números" tem checkbox + seletor de papel POR número
const linkFormHtml = renderCampaignLinkAddForm({ campaign: campaignA, numbers: campaigns.availableNumbersFor(campaignA.id) });
assert.match(linkFormHtml, /name="numberIds"/);
assert.match(linkFormHtml, /name="role_n1"/, "cada número deve ter seu próprio seletor de papel");
assert.match(linkFormHtml, /name="role_n2"/);
assert.match(linkFormHtml, /Principal\/Disparo/);
assert.doesNotMatch(linkFormHtml, /Chip 3/, "número arquivado não deve aparecer para vínculo");

// 16) simula o submit do controller: cada número com seu próprio papel, campanha e cliente/squad derivados corretamente
campaigns.assign("n1", campaignA.id, "PRIMARY");
campaigns.assign("n2", campaignA.id, "BACKUP");
assert.equal(campaigns.activeLinkForPair("n1", campaignA.id).role, "PRIMARY");
assert.equal(campaigns.activeLinkForPair("n2", campaignA.id).role, "BACKUP");
assert.ok(numbers.getNumber("n2").clientIds.includes("c1"));

// 17) formulário de edição de campanha mostra "Números vinculados" com os vínculos atuais + ação de remover
const editFormHtml = renderCampaignForm({ item: campaignA, clients: state.clients, squads: state.groups, responsibles: state.responsibles, numbers: numbers.state.numbers, links: campaigns.activeLinksForCampaign(campaignA.id) });
assert.match(editFormHtml, /Números vinculados/);
assert.match(editFormHtml, /data-action="remove-link-inline"/);
assert.match(editFormHtml, /data-action="add-links-inline"/);
const newFormHtml = renderCampaignForm({ item: {}, clients: state.clients, squads: state.groups, responsibles: state.responsibles });
assert.match(newFormHtml, /depois de salvá-la/i, "campanha nova ainda sem id não pode gerenciar vínculos");

campaigns.unassign("n1", campaignA.id);
campaigns.unassign("n2", campaignA.id);

// 18) detalhe do número (via campanhas anteriores) e detalhe da campanha renderizam responsável/funções
const detailHtml = renderCampaignDetail({ item: campaignA, clients: state.clients, squads: state.groups, responsibles: state.responsibles, numbers: numbers.state.numbers, locations: [], links: numbers.state.numberCampaignLinks.filter((link) => link.campaignId === campaignA.id) });
assert.match(detailHtml, /Pedro Melo/);
assert.match(detailHtml, /Encerrar campanha/);
assert.match(detailHtml, /Vincular números/);
assert.match(detailHtml, /Números atuais/);
assert.match(detailHtml, /Contas registradas no SendFlow \(Histórico\)/);

// 19) encerrar campanha encerra vínculos ativos e preserva histórico
campaigns.assign("n1", campaignA.id, "PRIMARY");
campaigns.close(campaignA.id);
assert.equal(campaigns.get(campaignA.id).status, "CLOSED");
assert.equal(campaigns.activeLinksFor("n1").length, 0);
assert.ok(campaigns.linksFor("n1").length > 0, "histórico de vínculos de n1 não deve ser apagado ao encerrar");

const closedListHtml = renderCampaigns({ campaigns: [campaigns.get(campaignA.id)], clients: state.clients, squads: state.groups, responsibles: state.responsibles, filters: { query: "", status: "" } });
assert.match(closedListHtml, /Reativar/);

// 20) reativar usa a MESMA campanha (id preservado), status volta a ACTIVE, endedAt limpo
const sameId = campaignA.id;
const reactivated = campaigns.reactivate(campaignA.id);
assert.equal(reactivated.id, sameId, "reativação não deve criar outra campanha");
assert.equal(reactivated.status, "ACTIVE");
assert.equal(reactivated.endedAt, null);

// 21) reativar novamente é idempotente (não duplica nem falha)
const reactivatedAgain = campaigns.reactivate(campaignA.id);
assert.equal(reactivatedAgain.id, sameId);

// 22) após reativação, novos vínculos são permitidos e o histórico anterior permanece
campaigns.assign("n1", campaignA.id, "PRIMARY");
assert.ok(campaigns.linksFor("n1").length >= 3, "novo vínculo soma ao histórico existente, nada é apagado");
assert.equal(campaigns.activeLinkForPair("n1", campaignA.id).role, "PRIMARY");

// 23) formulário de campanha exige responsável (campo required no HTML)
const formHtml = renderCampaignForm({ item: {}, clients: state.clients, squads: state.groups, responsibles: state.responsibles });
assert.match(formHtml, /name="responsibleId"[^>]*required/);

// 24) reload a partir do repositório confirma persistência íntegra de tudo acima
const reloadedNumbers = new NumbersService(repository);
const reloadedCampaigns = new CampaignsService(reloadedNumbers);
const reloadedCampaign = reloadedCampaigns.get(sameId);
assert.equal(reloadedCampaign.status, "ACTIVE");
assert.equal(reloadedCampaign.responsibleId, "r1");
assert.ok(reloadedCampaigns.linksFor("n1").length >= 3);

// 25) proteção contra submit concorrente (bug de duplo clique/duplo Enter na criação de campanha)
const { guardedSubmit } = await import("../src/js/ui/form-submit-guard.js");
let submitCount = 0;
const fakeButton = { disabled: false, textContent: "Salvar", isConnected: true };
const fakeForm = { dataset: {}, querySelector: (selector) => selector === ".button-primary" ? fakeButton : null };
const fakeEvent = { preventDefault: () => {} };
let resolveFirstSubmit;
guardedSubmit(fakeForm, fakeEvent, () => { submitCount++; return new Promise((resolve) => { resolveFirstSubmit = resolve; }); });
assert.equal(fakeForm.dataset.submitting, "true", "flag lógica de submit deve ser marcada imediatamente, não só o botão desabilitado");
assert.equal(fakeButton.disabled, true);
assert.equal(fakeButton.textContent, "Salvando…");
await Promise.resolve(); await Promise.resolve(); // deixa o handler do 1º submit começar (mas não terminar)
assert.equal(submitCount, 1, "primeiro submit deve ter iniciado");
guardedSubmit(fakeForm, fakeEvent, () => { submitCount++; }); // clique duplo / Enter repetido enquanto o 1º ainda processa
assert.equal(submitCount, 1, "segundo submit concorrente deve ser ignorado enquanto o primeiro está em andamento");
resolveFirstSubmit();
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(fakeForm.dataset.submitting, undefined, "estado deve ser restaurado após sucesso");
assert.equal(fakeButton.disabled, false);
assert.equal(fakeButton.textContent, "Salvar");
guardedSubmit(fakeForm, fakeEvent, () => { submitCount++; });
await Promise.resolve(); await Promise.resolve();
assert.equal(submitCount, 2, "após concluir, um novo submit legítimo deve ser permitido");

// ---------------------------------------------------------------------------
// RELATÓRIO DE VÍNCULO FALTANDO: número tem cliente associado, mas nenhum vínculo
// ativo com nenhuma campanha ativa desse cliente (ex.: gap herdado do sistema antigo,
// que só permitia 1 vínculo ativo por número — sem a checagem, ninguém percebe).
// ---------------------------------------------------------------------------

// Estado isolado só pra este bloco — evita depender do histórico acumulado das seções anteriores.
const gapState = {
  schemaVersion: 2, meta: { seedApplied: true },
  groups: [{ id: "gs1", name: "Squad Gap", isActive: true }],
  clients: [{ id: "gc1", name: "Cliente com vínculo", squadId: "gs1", isActive: true }, { id: "gc2", name: "Cliente sem vínculo", squadId: "gs1", isActive: true }],
  responsibles: [{ id: "gr1", name: "Resp", isActive: true }],
  campaigns: [], numbers: [
    { id: "gn1", phone: "5511988880001", identification: "Chip Gap 1", status: "ACTIVE", groupCount: 0, clientIds: ["gc1"], groupIds: [], locationId: null, responsibleId: null, notes: "", restriction: null, archivedAt: null },
    { id: "gn2", phone: "5511988880002", identification: "Chip Gap 2", status: "ACTIVE", groupCount: 0, clientIds: [], groupIds: [], locationId: null, responsibleId: null, notes: "", restriction: null, archivedAt: null },
  ],
  numberCampaignLinks: [], incidents: [], historyEvents: [], locations: [],
};
let gapPersisted = structuredClone(gapState);
const gapNumbers = new NumbersService({ initialize: () => structuredClone(gapPersisted), save: (v) => { gapPersisted = structuredClone(v); } });
const gapCampaigns = new CampaignsService(gapNumbers);
const campaignForGc1 = gapCampaigns.create({ name: "Campanha do Cliente com vínculo", clientId: "gc1", squadId: "gs1", responsibleId: "gr1" });

// 26) gn1 tem o cliente gc1 associado (manualmente, sem vínculo de campanha real) => aparece no relatório
let gaps = gapCampaigns.findClientCampaignGaps();
assert.ok(gaps.some((g) => g.numberId === "gn1" && g.clientId === "gc1" && g.campaignId === campaignForGc1.id), "número com cliente associado mas sem vínculo ativo deve aparecer no relatório");

// 27) o relatório some assim que o número é vinculado de verdade à campanha do cliente
gapCampaigns.assign("gn1", campaignForGc1.id, "BACKUP");
gaps = gapCampaigns.findClientCampaignGaps();
assert.ok(!gaps.some((g) => g.numberId === "gn1" && g.campaignId === campaignForGc1.id), "vinculado de verdade, o gap deve desaparecer");

// 28) número sem esse cliente associado não gera falso positivo
assert.ok(!gaps.some((g) => g.numberId === "gn2"), "gn2 nunca teve o cliente gc1 associado, não deve aparecer");

// 29) painel de diagnóstico só aparece quando há gaps, e some quando não há
const campaignsListHtml = renderCampaigns({ campaigns: campaigns.list({}), clients: state.clients, squads: state.groups, responsibles: state.responsibles, filters: { query: "", status: "" }, gaps: [] });
assert.doesNotMatch(campaignsListHtml, /vínculo.*faltando/i, "sem gaps, o painel não deve aparecer");
const withGapHtml = renderCampaigns({ campaigns: campaigns.list({}), clients: state.clients, squads: state.groups, responsibles: state.responsibles, filters: { query: "", status: "" }, gaps: [{ numberId: "n3", phone: "5511999999993", identification: "Chip 3", clientId: "c2", clientName: "Cliente 2", campaignId: "x", campaignName: "Campanha X" }] });
assert.match(withGapHtml, /vínculo.*faltando/i);
assert.match(withGapHtml, /data-admin-only/);
assert.match(withGapHtml, /Chip 3/);
assert.match(withGapHtml, /Campanha X/);

// ---------------------------------------------------------------------------
// ALTERAR FUNÇÃO: trocar o papel de um vínculo ativo num clique só (sem precisar
// encerrar manualmente e vincular de novo) — continua preservando histórico.
// ---------------------------------------------------------------------------

// 30) form pré-seleciona a função atual do vínculo
const changeRoleFormHtml = renderChangeRoleForm({ numberId: "gn1", campaignId: campaignForGc1.id, phone: "5511988880001", campaignName: campaignForGc1.name, currentRole: "BACKUP" });
assert.match(changeRoleFormHtml, /Alterar função/);
assert.match(changeRoleFormHtml, /<option value="BACKUP" selected>/);
assert.match(changeRoleFormHtml, new RegExp(campaignForGc1.name));

// 31) botão "Alterar função" aparece no vínculo ATUAL, tanto no detalhe da campanha quanto no do número
const detailWithChangeRole = renderCampaignDetail({ item: campaignForGc1, clients: gapState.clients, squads: gapState.groups, responsibles: gapState.responsibles, numbers: gapNumbers.state.numbers, locations: [], links: gapCampaigns.state.numberCampaignLinks.filter((l) => l.campaignId === campaignForGc1.id) });
assert.match(detailWithChangeRole, /data-action="change-role" data-number-id="gn1" data-role="BACKUP"/);

const numberDetailWithChangeRole = renderNumberDetailView({ number: gapNumbers.getNumber("gn1"), locations: [], responsibles: gapState.responsibles, clients: gapState.clients, groups: gapState.groups, campaigns: gapCampaigns.state.campaigns, campaignLinks: gapCampaigns.linksFor("gn1"), utilization: gapNumbers.utilizationOf("gn1") });
assert.match(numberDetailWithChangeRole, new RegExp(`data-action="change-role" data-campaign-id="${campaignForGc1.id}" data-role="BACKUP"`));

// 32) o que o submit do modal faz de fato: assign() com a nova função encerra o vínculo atual (vai pro
// histórico) e cria outro — não perde nada, não duplica campanha.
const linksBefore = gapCampaigns.linksFor("gn1").length;
gapCampaigns.assign("gn1", campaignForGc1.id, "PRIMARY");
assert.equal(gapCampaigns.activeLinkForPair("gn1", campaignForGc1.id).role, "PRIMARY", "função atualizada no vínculo ativo");
assert.equal(gapCampaigns.linksFor("gn1").length, linksBefore + 1, "função alterada soma ao histórico, não substitui o registro anterior");
assert.ok(gapCampaigns.linksFor("gn1").some((l) => l.role === "BACKUP" && l.endedAt), "vínculo anterior (BACKUP) permanece no histórico");
assert.equal(gapCampaigns.state.campaigns.filter((c) => c.id === campaignForGc1.id).length, 1, "não duplica a campanha");

console.log("Bloco 5: multi-campanha por número, campanha↔números com papel individual, cliente/squad derivado, alterar função num clique, dashboard sem contagem duplicada, relatório de vínculo faltando, responsável, encerrar/reativar, histórico e proteção contra duplo submit validados.");
