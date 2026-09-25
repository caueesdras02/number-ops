import assert from "node:assert/strict";
import { BotService } from "../src/js/services/bot-service.js";
import { renderBotEventDetail } from "../src/js/ui/bot-view.js";

// ---------------------------------------------------------------------------
// BLOCO 30 — aviso de "campanha antiga ainda ativa": quando um alerta de
// número que NÃO é nosso vem com uma Empresa que bate com um Cliente já
// cadastrado, e esse Cliente já tem uma Campanha ATIVA com nome DIFERENTE do
// Liveshop do alerta, avisa e oferece encerrar a antiga. Nunca mexe na
// classificação automática de números já nossos.
// ---------------------------------------------------------------------------

function makeEvent(overrides = {}) {
  return {
    id: "evt-1", eventType: "CONNECTIVITY_ALERT", phoneNormalized: "5581914101890",
    numberId: null, campaignId: null, clientId: null, processingStatus: "IGNORED_NOT_OWNED",
    linkedIncidentId: null, metadata: { empresa: "Zig Online", liveshop: "Live Novembro", contaCliente: "Conta1", notOwned: { externalNumberId: "ext-1" } },
    receivedAt: "2026-01-01T00:00:00.000Z", processedAt: null,
    ...overrides,
  };
}

function makeService({ campaigns = [], clients = [] } = {}) {
  const numbersService = { state: { numbers: [], campaigns, clients, incidents: [], externalNumberCampaignLinks: [] } };
  return new BotService({ integrationEventsRepository: {}, numbersService, currentProfile: { id: "profile-1", access_level: "USER" } });
}

// 1) Empresa bate com Cliente ativo + Cliente já tem Campanha ATIVA de nome diferente -> aponta a antiga
{
  const clients = [{ id: "client1", name: "Zig Online", isActive: true }];
  const campaigns = [{ id: "camp-old", name: "Live Outubro", clientId: "client1", status: "ACTIVE" }];
  const service = makeService({ campaigns, clients });
  const found = service.findPossibleOldCampaign(makeEvent());
  assert.deepEqual(found, { campaignId: "camp-old", campaignName: "Live Outubro", clientId: "client1", clientName: "Zig Online" });
}

// 2) mesmo nome (só acento/maiúscula diferente) entre Liveshop e a campanha -> NÃO é "antiga", é a própria
{
  const clients = [{ id: "client1", name: "Zig Online", isActive: true }];
  const campaigns = [{ id: "camp1", name: "live novembro", clientId: "client1", status: "ACTIVE" }]; // mesmo nome do Liveshop, só minúsculo
  const service = makeService({ campaigns, clients });
  assert.equal(service.findPossibleOldCampaign(makeEvent()), null, "campanha com o MESMO nome do Liveshop nunca é apontada como \"antiga\"");
}

// 3) Empresa não bate com NENHUM cliente (nem por acento/maiúscula) -> nada a apontar
{
  const clients = [{ id: "client1", name: "Outra Empresa", isActive: true }];
  const campaigns = [{ id: "camp1", name: "Live Outubro", clientId: "client1", status: "ACTIVE" }];
  const service = makeService({ campaigns, clients });
  assert.equal(service.findPossibleOldCampaign(makeEvent()), null);
}

// 4) Cliente bate mas a única campanha dele já está CLOSED (encerrada de verdade) -> nada a apontar
{
  const clients = [{ id: "client1", name: "Zig Online", isActive: true }];
  const campaigns = [{ id: "camp1", name: "Live Outubro", clientId: "client1", status: "CLOSED" }];
  const service = makeService({ campaigns, clients });
  assert.equal(service.findPossibleOldCampaign(makeEvent()), null, "campanha já encerrada não é \"campanha antiga ATIVA\"");
}

// 5) Cliente INATIVO não conta (mesma regra de nunca considerar cliente arquivado)
{
  const clients = [{ id: "client1", name: "Zig Online", isActive: false }];
  const campaigns = [{ id: "camp1", name: "Live Outubro", clientId: "client1", status: "ACTIVE" }];
  const service = makeService({ campaigns, clients });
  assert.equal(service.findPossibleOldCampaign(makeEvent()), null);
}

// 6) enrich(): só calcula pra IGNORED_NOT_OWNED — nunca pra número já nosso (MATCHED/PENDING_ASSOCIATION)
{
  const clients = [{ id: "client1", name: "Zig Online", isActive: true }];
  const campaigns = [{ id: "camp-old", name: "Live Outubro", clientId: "client1", status: "ACTIVE" }];
  const service = makeService({ campaigns, clients });
  const notOwned = service.enrich(makeEvent());
  assert.ok(notOwned.possibleOldCampaign, "IGNORED_NOT_OWNED calcula o aviso");

  const pending = service.enrich(makeEvent({ processingStatus: "PENDING_ASSOCIATION" }));
  assert.equal(pending.possibleOldCampaign, null, "PENDING_ASSOCIATION nunca calcula — regra é só pra número já confirmado como não-nosso");

  const matched = service.enrich(makeEvent({ processingStatus: "MATCHED", numberId: null }));
  assert.equal(matched.possibleOldCampaign, null, "MATCHED (número já nosso) nunca calcula — não mexe na classificação automática de números já nossos");
}

// 7) renderBotEventDetail: banner some sem possibleOldCampaign; aparece com aviso + botão só quando canModify
{
  const withOld = { ...makeEvent(), existingExternalLinks: [], possibleOldCampaign: { campaignId: "camp-old", campaignName: "Live Outubro", clientName: "Zig Online" } };
  const htmlEditable = renderBotEventDetail(withOld, { canModify: true, availableCampaigns: [] });
  assert.match(htmlEditable, /Campanha antiga ainda ativa/);
  assert.match(htmlEditable, /Live Outubro/);
  assert.match(htmlEditable, /Zig Online/);
  assert.match(htmlEditable, /data-action="bot-close-old-campaign" data-campaign-id="camp-old"/);

  const htmlReadOnly = renderBotEventDetail(withOld, { canModify: false, availableCampaigns: [] });
  assert.match(htmlReadOnly, /Campanha antiga ainda ativa/, "texto continua visível pra quem só lê");
  assert.doesNotMatch(htmlReadOnly, /data-action="bot-close-old-campaign"/, "VIEWER nunca vê o botão de encerrar");

  const withoutOld = { ...makeEvent(), existingExternalLinks: [], possibleOldCampaign: null };
  assert.doesNotMatch(renderBotEventDetail(withoutOld, { canModify: true, availableCampaigns: [] }), /Campanha antiga ainda ativa/);
}

console.log("Bloco 30 (aviso de campanha antiga ainda ativa): todos os cenários passaram.");
