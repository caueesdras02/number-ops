import assert from "node:assert/strict";
import { BotService } from "../src/js/services/bot-service.js";
import { renderBotEventDetail } from "../src/js/ui/bot-view.js";
import { renderCampaignDetail } from "../src/js/ui/campaigns-view.js";

// ---------------------------------------------------------------------------
// BLOCO 25 — vincular Cliente/Campanha em números que NÃO são nossos (alertas
// Telegram classificados como "não pertence à operação"). Nunca cria Campanha,
// nunca cria registro em `numbers`; Cliente/Squad vêm sempre da Campanha
// escolhida. Repositórios FALSOS em memória — nenhuma rede/dado real.
// ---------------------------------------------------------------------------

function makeExternalCampaignLinksRepository(seed = []) {
  const rows = [...seed];
  let n = 0;
  return {
    rows,
    async list() { return rows.map((row) => ({ ...row })); },
    async upsert(record) {
      const activeConflict = rows.find((row) => row.external_number_id === record.external_number_id && row.campaign_id === record.campaign_id && !row.ended_at);
      if (activeConflict) { const error = new Error("duplicate key value violates unique constraint"); error.code = "23505"; throw error; }
      const row = { ended_at: null, ended_by: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", linked_at: "2026-01-01T00:00:00.000Z", ...record, id: record.id ?? `ext-link-${++n}` };
      rows.push(row);
      return { ...row };
    },
    async update(id, changes) {
      const row = rows.find((item) => item.id === id);
      if (!row) throw new Error("external_number_campaign_links row not found");
      Object.assign(row, changes);
      return { ...row };
    },
  };
}

function makeEvent(overrides = {}) {
  return {
    id: "evt-1", source: "TELEGRAM", eventType: "CONNECTIVITY_ALERT", phoneNormalized: "5581914101890",
    numberId: null, campaignId: null, clientId: null, processingStatus: "IGNORED_NOT_OWNED",
    linkedIncidentId: null, metadata: { empresa: "Zig Online", liveshop: "Mega Feirão de fábrica", contaCliente: "Dhenny novo", notOwned: { externalNumberId: "ext-1", reason: "NUMBER_NOT_OWNED" } },
    receivedAt: "2026-01-01T00:00:00.000Z", processedAt: null,
    ...overrides,
  };
}

function makeService({ profile = { id: "profile-1", access_level: "USER" }, campaigns = [], clients = [], externalNumberCampaignLinks = [] } = {}) {
  const externalNumberCampaignLinksRepository = makeExternalCampaignLinksRepository(externalNumberCampaignLinks);
  const numbersService = { state: { numbers: [], campaigns, clients, incidents: [], externalNumberCampaignLinks: [...externalNumberCampaignLinks].map((row) => ({ id: row.id, externalNumberId: row.external_number_id, campaignId: row.campaign_id, phoneNormalized: row.phone_normalized, companyLabel: row.company_label, clientAccountLabel: row.client_account_label, linkedAt: row.linked_at, endedAt: row.ended_at ?? null })) } };
  const service = new BotService({ integrationEventsRepository: {}, externalNumberCampaignLinksRepository, numbersService, currentProfile: profile });
  return { service, externalNumberCampaignLinksRepository, numbersService };
}

// 1) vincula um número externo a uma campanha existente — nunca cria Campanha nem Número
{
  const campaigns = [{ id: "camp1", name: "Mega Feirão de fábrica", clientId: "client1", status: "ACTIVE" }];
  const { service, externalNumberCampaignLinksRepository, numbersService } = makeService({ campaigns });
  const event = makeEvent();
  const campaignsBefore = numbersService.state.campaigns.length;
  const numbersBefore = numbersService.state.numbers.length;
  await service.linkToCampaign(event.id, "camp1", event);
  assert.equal(numbersService.state.campaigns.length, campaignsBefore, "nenhuma campanha criada");
  assert.equal(numbersService.state.numbers.length, numbersBefore, "nenhum número criado");
  assert.equal(externalNumberCampaignLinksRepository.rows.length, 1);
  const row = externalNumberCampaignLinksRepository.rows[0];
  assert.equal(row.external_number_id, "ext-1");
  assert.equal(row.campaign_id, "camp1");
  assert.equal(row.phone_normalized, "5581914101890");
  assert.equal(row.company_label, "Zig Online");
  assert.equal(row.client_account_label, "Dhenny novo");
  assert.equal(row.linked_by, "profile-1");
  assert.equal(numbersService.state.externalNumberCampaignLinks.length, 1, "refletido imediatamente no state, sem esperar reload");
}

// 2) só a partir de IGNORED_NOT_OWNED — nunca de PENDING_ASSOCIATION direto
{
  const { service } = makeService({ campaigns: [{ id: "camp1", name: "X", clientId: "c1", status: "ACTIVE" }] });
  const event = makeEvent({ processingStatus: "PENDING_ASSOCIATION" });
  await assert.rejects(() => service.linkToCampaign(event.id, "camp1", event), /não está classificado como não pertencente/);
}

// 3) exige campanha existente — nunca aceita um id que não existe
{
  const { service } = makeService({ campaigns: [{ id: "camp1", name: "X", clientId: "c1", status: "ACTIVE" }] });
  const event = makeEvent();
  await assert.rejects(() => service.linkToCampaign(event.id, "camp-inexistente", event), /Selecione uma campanha/);
}

// 4) idempotência em corrida: 23505 (mesmo par número-externo/campanha já vinculado) reaproveita, nunca duplica
{
  const campaigns = [{ id: "camp1", name: "X", clientId: "c1", status: "ACTIVE" }];
  const { service, externalNumberCampaignLinksRepository, numbersService } = makeService({ campaigns });
  const eventA = makeEvent({ id: "ea" });
  const eventB = makeEvent({ id: "eb" });
  await service.linkToCampaign(eventA.id, "camp1", eventA);
  await service.linkToCampaign(eventB.id, "camp1", eventB);
  assert.equal(externalNumberCampaignLinksRepository.rows.length, 1, "nunca duplica o mesmo vínculo ativo");
  assert.equal(numbersService.state.externalNumberCampaignLinks.length, 1);
}

// 5) VIEWER sem escrita
{
  const { service } = makeService({ profile: { access_level: "VIEWER" }, campaigns: [{ id: "camp1", name: "X", clientId: "c1", status: "ACTIVE" }] });
  const event = makeEvent();
  await assert.rejects(() => service.linkToCampaign(event.id, "camp1", event), /permissão/);
}

// 6) enrich() resolve existingExternalLinks com nome de campanha/cliente, só vínculos ATIVOS
{
  const campaigns = [{ id: "camp1", name: "Mega Feirão de fábrica", clientId: "client1", status: "ACTIVE" }];
  const clients = [{ id: "client1", name: "Zig Online" }];
  const existing = [{ id: "link1", external_number_id: "ext-1", campaign_id: "camp1", phone_normalized: "5581914101890", company_label: "Zig Online", client_account_label: "Dhenny novo", linked_at: "2026-01-01T00:00:00.000Z", ended_at: null }];
  const { service } = makeService({ campaigns, clients, externalNumberCampaignLinks: existing });
  const enriched = service.enrich(makeEvent());
  assert.equal(enriched.existingExternalLinks.length, 1);
  assert.equal(enriched.existingExternalLinks[0].campaignName, "Mega Feirão de fábrica");
  assert.equal(enriched.existingExternalLinks[0].clientName, "Zig Online");

  const endedElsewhere = [{ ...existing[0], ended_at: "2026-02-01T00:00:00.000Z" }];
  const { service: serviceEnded } = makeService({ campaigns, clients, externalNumberCampaignLinks: endedElsewhere });
  assert.equal(serviceEnded.enrich(makeEvent()).existingExternalLinks.length, 0, "vínculo encerrado não conta como 'já vinculado'");
}

// 7) renderBotEventDetail: nota de já-vinculado sempre aparece quando IGNORED_NOT_OWNED + canModify;
//    form de vincular/criar campanha só aparece quando AINDA NÃO está vinculado a nenhuma —
//    já vinculado mostra só uma confirmação não clicável (nem "Vincular" nem "Criar nova" fazem
//    sentido mais nesse caso).
{
  const notYetLinkedEvent = { ...makeEvent(), existingExternalLinks: [] };
  const notYetLinkedHtml = renderBotEventDetail(notYetLinkedEvent, { canModify: true, availableCampaigns: [{ id: "camp2", name: "Outra campanha", clientName: "Cliente Y" }] });
  assert.match(notYetLinkedHtml, /data-bot-link-campaign-form/);
  assert.match(notYetLinkedHtml, /data-action="bot-create-campaign"/);
  assert.match(notYetLinkedHtml, /Outra campanha/);
  assert.doesNotMatch(notYetLinkedHtml, /Já vinculada/);

  const alreadyLinkedEvent = { ...makeEvent(), existingExternalLinks: [{ campaignId: "camp1", campaignName: "Mega Feirão de fábrica", clientName: "Zig Online" }] };
  const html = renderBotEventDetail(alreadyLinkedEvent, { canModify: true, availableCampaigns: [{ id: "camp2", name: "Outra campanha", clientName: "Cliente Y" }] });
  assert.match(html, /Já vinculado à campanha/);
  assert.match(html, /Mega Feirão de fábrica/);
  assert.doesNotMatch(html, /data-bot-link-campaign-form/, "já vinculado — não oferece vincular de novo");
  assert.doesNotMatch(html, /data-action="bot-create-campaign"/, "já vinculado — não oferece criar campanha");
  assert.match(html, /<button type="button" class="button button-quiet" disabled>✓ Campanha já vinculada<\/button>/, "confirmação visual, não clicável");

  const readOnlyHtml = renderBotEventDetail(notYetLinkedEvent, { canModify: false, availableCampaigns: [] });
  assert.doesNotMatch(readOnlyHtml, /data-bot-link-campaign-form/, "VIEWER não vê o form de vincular");

  const pendingEvent = { ...notYetLinkedEvent, processingStatus: "PENDING_ASSOCIATION" };
  assert.doesNotMatch(renderBotEventDetail(pendingEvent, { canModify: true, availableCampaigns: [] }), /data-bot-link-campaign-form/, "só oferece vincular campanha depois de classificado como externo");
}

// 8) renderCampaignDetail: número externo aparece na MESMA tabela dos nossos, com o badge "Não é nosso", em atuais e em histórico
{
  const item = { id: "camp1", name: "Mega Feirão de fábrica", clientId: "client1", status: "ACTIVE", stage: "CAPTACAO", startedAt: "2026-01-01T00:00:00.000Z" };
  const currentExternal = { id: "link1", campaignId: "camp1", phoneNormalized: "5581914101890", companyLabel: "Zig Online", clientAccountLabel: "Dhenny novo", linkedAt: "2026-01-02T00:00:00.000Z", endedAt: null };
  const historyExternal = { id: "link2", campaignId: "camp1", phoneNormalized: "5533885491790", companyLabel: "Nacarati", clientAccountLabel: "Nacarati2", linkedAt: "2026-01-03T00:00:00.000Z", endedAt: "2026-01-10T00:00:00.000Z" };
  const html = renderCampaignDetail({ item, clients: [{ id: "client1", name: "Cliente" }], squads: [], numbers: [], links: [], externalLinks: [currentExternal, historyExternal] });
  assert.match(html, /badge-external/);
  assert.match(html, /Não é nosso/);
  assert.match(html, /Zig Online/);
  assert.match(html, /Conta do Cliente: Dhenny novo/);
  assert.match(html, /Nacarati/);
  assert.match(html, /data-action="end-external-link" data-id="link1"/, "vínculo ativo oferece Encerrar");
  assert.doesNotMatch(html, /data-action="end-external-link" data-id="link2"/, "vínculo já encerrado não oferece Encerrar de novo");
  assert.match(html, /1 atual\b/, "contador inclui o número externo ativo, singular correto (\"1 atual\", não \"atualis\")");

  const secondCurrentExternal = { id: "link3", campaignId: "camp1", phoneNormalized: "5511900000000", companyLabel: "Outra Empresa", clientAccountLabel: "Conta2", linkedAt: "2026-01-04T00:00:00.000Z", endedAt: null };
  const htmlPlural = renderCampaignDetail({ item, clients: [{ id: "client1", name: "Cliente" }], squads: [], numbers: [], links: [], externalLinks: [currentExternal, secondCurrentExternal, historyExternal] });
  assert.match(htmlPlural, /2 atuais\b/, "plural correto com 2+ números atuais (\"atuais\", nunca \"atualis\")");
  assert.doesNotMatch(htmlPlural, /atualis/, "nunca gera a palavra errada \"atualis\"");
}

console.log("Bloco 25 (vincular Cliente/Campanha em números que não são nossos): todos os cenários passaram.");
