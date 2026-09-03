import assert from "node:assert/strict";
import { NumbersService } from "../src/js/services/numbers-service.js";
import { CampaignsService } from "../src/js/services/campaigns-service.js";
import { renderCampaignDetail, renderCampaigns, renderCampaignForm, renderCampaignLinkAddForm } from "../src/js/ui/campaigns-view.js";

const state = {
  schemaVersion: 2, meta: { seedApplied: true },
  groups: [{ id: "s1", name: "Squad Nexus", isActive: true }],
  clients: [{ id: "c1", name: "Cliente 1", squadId: "s1", isActive: true }],
  responsibles: [{ id: "r1", name: "Pedro Melo", team: "Nexus", isActive: true }],
  campaigns: [],
  numbers: [
    { id: "n1", phone: "5511999999991", identification: "Chip 1", status: "ACTIVE", groupCount: 1, clientIds: ["c1"], groupIds: ["s1"], locationId: null, responsibleId: null, notes: "", restriction: null, archivedAt: null },
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
const campaign = campaigns.create({ name: "Appel Home", clientId: "c1", squadId: "s1", responsibleId: "r1", notes: "" });
assert.equal(campaign.responsibleId, "r1");
assert.equal(campaign.status, "ACTIVE");

// 3) availableNumbers() exclui números arquivados
const available = campaigns.availableNumbers().map((item) => item.id);
assert.deepEqual(available.sort(), ["n1", "n2"]);

// 4) vincular vários números de uma vez (mesmo fluxo usado pelo formulário "Vincular números")
campaigns.assign("n1", campaign.id, "PRIMARY");
campaigns.assign("n2", campaign.id, "BACKUP");
assert.equal(campaigns.activeLinkFor("n1").role, "PRIMARY");
assert.equal(campaigns.activeLinkFor("n2").role, "BACKUP");
assert.equal(campaigns.linksFor(campaign.id === "n1" ? "n1" : "n1").length, 1);

// 5) alterar a função de um número preserva o vínculo anterior no histórico (não apaga)
campaigns.assign("n1", campaign.id, "SUPPORT");
const n1Links = campaigns.linksFor("n1");
assert.equal(n1Links.length, 2, "deve manter o vínculo antigo encerrado + o novo vínculo");
assert.ok(n1Links.some((link) => link.role === "PRIMARY" && link.endedAt));
assert.ok(n1Links.some((link) => link.role === "SUPPORT" && !link.endedAt));

// 6) detalhe do número (via campanhas anteriores) e detalhe da campanha renderizam responsável/funções
const detailHtml = renderCampaignDetail({ item: campaign, clients: state.clients, squads: state.groups, responsibles: state.responsibles, numbers: numbers.state.numbers, locations: [], links: numbers.state.numberCampaignLinks.filter((link) => link.campaignId === campaign.id) });
assert.match(detailHtml, /Pedro Melo/);
assert.match(detailHtml, /Encerrar campanha/);
assert.match(detailHtml, /Vincular números/);

// 7) encerrar campanha encerra vínculos ativos e preserva histórico
campaigns.close(campaign.id);
assert.equal(campaigns.get(campaign.id).status, "CLOSED");
assert.ok(campaigns.activeLinkFor("n1") === null);
assert.ok(campaigns.activeLinkFor("n2") === null);
assert.equal(campaigns.linksFor("n1").length, 2, "histórico de vínculos de n1 não deve ser apagado ao encerrar");

const closedListHtml = renderCampaigns({ campaigns: [campaigns.get(campaign.id)], clients: state.clients, squads: state.groups, responsibles: state.responsibles, filters: { query: "", status: "" } });
assert.match(closedListHtml, /Reativar/);

// 8) reativar usa a MESMA campanha (id preservado), status volta a ACTIVE, endedAt limpo
const sameId = campaign.id;
const reactivated = campaigns.reactivate(campaign.id);
assert.equal(reactivated.id, sameId, "reativação não deve criar outra campanha");
assert.equal(reactivated.status, "ACTIVE");
assert.equal(reactivated.endedAt, null);
assert.equal(campaigns.state.campaigns.length, 1, "nenhuma campanha duplicada deve existir após reativar");

// 9) reativar novamente é idempotente (não duplica nem falha)
const reactivatedAgain = campaigns.reactivate(campaign.id);
assert.equal(reactivatedAgain.id, sameId);

// 10) após reativação, novos vínculos são permitidos e o histórico anterior permanece
campaigns.assign("n1", campaign.id, "PRIMARY");
assert.equal(campaigns.linksFor("n1").length, 3, "novo vínculo some ao histórico existente, nada é apagado");
assert.equal(campaigns.activeLinkFor("n1").role, "PRIMARY");

// 11) formulário de campanha exige responsável (campo required no HTML) e formulário de vínculo lista só números disponíveis
const formHtml = renderCampaignForm({ item: {}, clients: state.clients, squads: state.groups, responsibles: state.responsibles });
assert.match(formHtml, /name="responsibleId"[^>]*required/);
const linkFormHtml = renderCampaignLinkAddForm({ campaign: campaigns.get(campaign.id), numbers: campaigns.availableNumbers() });
assert.match(linkFormHtml, /Chip 1|Chip 2/);
assert.doesNotMatch(linkFormHtml, /Chip 3/, "número arquivado não deve aparecer para vínculo");

// 12) reload a partir do repositório confirma persistência íntegra de tudo acima
const reloadedNumbers = new NumbersService(repository);
const reloadedCampaigns = new CampaignsService(reloadedNumbers);
const reloadedCampaign = reloadedCampaigns.get(sameId);
assert.equal(reloadedCampaign.status, "ACTIVE");
assert.equal(reloadedCampaign.responsibleId, "r1");
assert.equal(reloadedCampaigns.linksFor("n1").length, 3);
assert.equal(reloadedCampaigns.state.campaigns.length, 1);

// 13) proteção contra submit concorrente (bug de duplo clique/duplo Enter na criação de campanha)
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

console.log("Bloco 5: campanha↔números, responsável, encerrar/reativar, histórico e proteção contra duplo submit validados.");
