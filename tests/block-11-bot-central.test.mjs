import assert from "node:assert/strict";
import { BotService } from "../src/js/services/bot-service.js";
import { DashboardService } from "../src/js/services/dashboard-service.js";
import { renderBotCentral, renderBotEventDetail } from "../src/js/ui/bot-view.js";
import { renderIncidents, renderIncidentDetail } from "../src/js/ui/incidents-view.js";

// ---------------------------------------------------------------------------
// Central Number Ops Bot — leitura (BotService), indicador do Dashboard e
// identificação discreta de origem em Ocorrências. Sem rede/dado real.
// ---------------------------------------------------------------------------

const fakeNumbersService = (state) => ({ state });

// 1) available === false sem repository (modo local/offline) — não lança, não inventa dado.
{
  const service = new BotService({ integrationEventsRepository: null, numbersService: fakeNumbersService({ numbers: [], campaigns: [], clients: [], incidents: [] }) });
  assert.equal(service.available, false);
  const result = await service.load();
  assert.equal(result.available, false);
  assert.deepEqual(result.events, []);
  assert.equal(result.metrics.total, 0);
}

// 2) openConnectivityCount deriva SÓ de incidents (classification+origin+status), mesmo sem integration_events
{
  const state = { numbers: [], campaigns: [], clients: [], incidents: [
    { id: "i1", classification: "CONNECTIVITY", origin: "TELEGRAM_BOT", status: "OPEN" },
    { id: "i2", classification: "CONNECTIVITY", origin: "TELEGRAM_BOT", status: "RESOLVED" }, // resolvida não conta
    { id: "i3", classification: "CONNECTIVITY", origin: "MANUAL", status: "OPEN" }, // origem manual não conta
    { id: "i4", classification: "CONFIRMED_RESTRICTION", origin: "TELEGRAM_BOT", status: "OPEN" }, // classificação diferente não conta
  ] };
  const service = new BotService({ integrationEventsRepository: null, numbersService: fakeNumbersService(state) });
  const result = await service.load();
  assert.equal(result.metrics.openConnectivity, 1);
}

// 3) load() real: MATCHED com campanha, PENDING_ASSOCIATION, LINKED_TO_INCIDENT, IGNORED/ERROR
{
  const state = {
    numbers: [{ id: "num1", phone: "5511999999999", identification: "Chip 1" }],
    campaigns: [{ id: "camp1", name: "Campanha X" }],
    clients: [{ id: "client1", name: "Cliente X" }],
    incidents: [{ id: "incident1", classification: "CONNECTIVITY", origin: "TELEGRAM_BOT", status: "OPEN", title: "Alerta" }],
  };
  const rows = [
    { id: "evt1", source: "TELEGRAM", source_event_id: "1", event_type: "CONNECTIVITY_ALERT", phone_normalized: "5511999999999", number_id: "num1", campaign_id: "camp1", client_id: "client1", matched_confidence: 1, processing_status: "LINKED_TO_INCIDENT", linked_incident_id: "incident1", error_message: null, metadata: { campaignMatch: "single_active_link" }, received_at: "2026-01-02T10:00:00.000Z", processed_at: "2026-01-02T10:00:01.000Z" },
    { id: "evt2", source: "TELEGRAM", source_event_id: "2", event_type: "CONNECTIVITY_ALERT", phone_normalized: "5511900000000", number_id: null, campaign_id: null, client_id: null, matched_confidence: 0, processing_status: "PENDING_ASSOCIATION", linked_incident_id: null, error_message: null, metadata: {}, received_at: "2026-01-02T09:00:00.000Z", processed_at: "2026-01-02T09:00:01.000Z" },
    { id: "evt3", source: "TELEGRAM", source_event_id: "3", event_type: "UNKNOWN", phone_normalized: null, number_id: null, campaign_id: null, client_id: null, matched_confidence: null, processing_status: "IGNORED", linked_incident_id: null, error_message: null, metadata: {}, received_at: "2026-01-02T08:00:00.000Z", processed_at: "2026-01-02T08:00:01.000Z" },
  ];
  const service = new BotService({ integrationEventsRepository: { list: async () => rows }, numbersService: fakeNumbersService(state) });
  const result = await service.load();
  assert.equal(result.available, true);
  assert.equal(result.events.length, 3);
  assert.equal(result.events[0].id, "evt1", "ordenado por received_at desc");

  const matched = result.events.find((e) => e.id === "evt1");
  assert.equal(matched.number.phone, "5511999999999", "número resolvido via state.numbers");
  assert.equal(matched.campaign.name, "Campanha X", "campanha resolvida via state.campaigns");
  assert.equal(matched.client.name, "Cliente X");
  assert.equal(matched.incident.title, "Alerta", "ocorrência resolvida via linkedIncidentId");

  const pending = result.events.find((e) => e.id === "evt2");
  assert.equal(pending.number, null, "sem número — nunca inventa associação");
  assert.equal(pending.campaign, null);
  assert.equal(pending.incident, null);

  assert.equal(result.metrics.total, 3);
  assert.equal(result.metrics.matched, 1, "só LINKED_TO_INCIDENT/MATCHED contam como processados");
  assert.equal(result.metrics.pending, 1);
  assert.equal(result.metrics.lastEvent.id, "evt1");
}

// 4) DashboardService: indicador do Bot só conta CONNECTIVITY/TELEGRAM_BOT/OPEN — não confunde com ocorrências manuais
{
  const state = {
    numbers: [{ id: "n1", status: "ACTIVE", archivedAt: null, responsibleId: null, locationId: null, clientIds: [], groupIds: [] }],
    campaigns: [], groups: [], clients: [], responsibles: [], locations: [], numberCampaignLinks: [], historyEvents: [],
    incidents: [
      { id: "i1", status: "OPEN", classification: "CONNECTIVITY", origin: "TELEGRAM_BOT", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "i2", status: "OPEN", updatedAt: "2026-01-01T00:00:00.000Z" }, // ocorrência manual comum
    ],
  };
  const dashboard = new DashboardService(fakeNumbersService(state)).getData();
  assert.equal(dashboard.attention.botConnectivity.length, 1);
  assert.equal(dashboard.attention.open.length, 2, "\"Ocorrências abertas\" continua contando todas, sem duplicar/esconder nada");
}

// 5) incidents-view: badge "via Telegram" só aparece quando origin === TELEGRAM_BOT
{
  const items = [
    { id: "a", status: "OPEN", title: "Manual", description: "", numberId: "n1", responsibleId: null, updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "b", status: "OPEN", title: "Do bot", description: "", numberId: "n1", responsibleId: null, origin: "TELEGRAM_BOT", updatedAt: "2026-01-01T00:00:00.000Z" },
  ];
  const numbers = [{ id: "n1", phone: "5511999999999", identification: "" }];
  const html = renderIncidents(items, numbers, []);
  assert.doesNotMatch(html, /Manual[\s\S]{0,80}via Telegram/, "ocorrência manual não recebe o selo");
  assert.match(html, /via Telegram/, "ocorrência do bot recebe o selo discreto");
  const detailHtml = renderIncidentDetail(items[1], numbers, []);
  assert.match(detailHtml, /via Telegram/);
}

// 6) renderBotCentral: estado indisponível, PENDING_ASSOCIATION em destaque, filtro de status preservado
{
  assert.match(renderBotCentral({ available: false }), /indisponível/i);

  const events = [
    { id: "e1", eventType: "CONNECTIVITY_ALERT", processingStatus: "PENDING_ASSOCIATION", phoneNormalized: "5511900000000", number: null, campaign: null, incident: null, metadata: {}, receivedAt: "2026-01-01T00:00:00.000Z" },
  ];
  const html = renderBotCentral({ available: true, events, metrics: { total: 1, matched: 0, pending: 1, openConnectivity: 0, lastEvent: events[0] }, filters: {} });
  assert.match(html, /is-pending-row/, "linha de PENDING_ASSOCIATION destacada");
  assert.match(html, /alerta.*sem número associado/i);
  assert.doesNotMatch(html, /online|conectado/i, "nunca afirma status de conexão sem dado real");
}

// 7) renderBotEventDetail: timeline só marca como concluído o que realmente aconteceu
{
  const partialEvent = { id: "e1", eventType: "CONNECTIVITY_ALERT", processingStatus: "MATCHED", phoneNormalized: "5511999999999", numberId: "num1", number: { phone: "5511999999999" }, campaignId: null, campaign: null, incident: null, linkedIncidentId: null, metadata: { campaignMatch: "none" }, receivedAt: "2026-01-01T00:00:00.000Z" };
  const html = renderBotEventDetail(partialEvent);
  const doneCount = (html.match(/is-done/g) || []).length;
  const pendingCount = (html.match(/is-pending/g) || []).length;
  assert.equal(doneCount, 3, "Recebido, Interpretado e Número concluídos");
  assert.equal(pendingCount, 3, "Campanha, Classificação e Ocorrência ainda não concluídos");
  assert.match(html, /sem campanha ativa vinculada/i);
  assert.doesNotMatch(html, /data-action="open-campaign"|data-action="open-incident"/, "sem campanha/ocorrência, não oferece navegação para elas");
  assert.match(html, /data-action="open-number"/, "com número resolvido, oferece navegação para ele");
}

// 8) Empresa/Liveshop/Conta do Cliente do alerta Telegram aparecem mesmo sem número/campanha
//    cadastrados aqui (evento IGNORED_NOT_OWNED ou PENDING_ASSOCIATION) — esse dado já vem no
//    texto do alerta e não pode "sumir" só porque não houve vínculo formal ainda. Coluna Número
//    usa o MESMO texto "Não encontrado" pra IGNORED_NOT_OWNED e PENDING_ASSOCIATION (a distinção
//    real já está na coluna Status — não repete com textos diferentes), e a coluna Campanha
//    mostra o nome do Liveshop puro, sem prefixo "Liveshop:".
{
  const notOwnedEvent = {
    id: "e1", eventType: "CONNECTIVITY_ALERT", processingStatus: "IGNORED_NOT_OWNED", phoneNormalized: "5581914101890",
    number: null, campaign: null, incident: null, linkedIncidentId: null, campaignId: null, numberId: null, externalRecord: null,
    metadata: { empresa: "Zig Online", liveshop: "Mega Feirão de fábrica", contaCliente: "Dhenny novo" },
    receivedAt: "2026-01-01T00:00:00.000Z",
  };
  const tableHtml = renderBotCentral({ available: true, events: [notOwnedEvent], metrics: { total: 1, matched: 0, pending: 0, openConnectivity: 0, lastEvent: notOwnedEvent }, filters: {} });
  assert.match(tableHtml, /Não encontrado — Conta do Cliente: Dhenny novo/, "coluna Número: rótulo único + conta do cliente, sem duplicar a distinção da coluna Status");
  assert.match(tableHtml, />Mega Feirão de fábrica</, "coluna Campanha mostra só o nome do Liveshop, sem o prefixo \"Liveshop:\"");
  assert.doesNotMatch(tableHtml, /Liveshop: /, "nunca mais mostra o prefixo \"Liveshop:\" na tabela");

  const pendingEvent = { ...notOwnedEvent, id: "e2", processingStatus: "PENDING_ASSOCIATION" };
  const pendingHtml = renderBotCentral({ available: true, events: [pendingEvent], metrics: { total: 1, matched: 0, pending: 1, openConnectivity: 0, lastEvent: pendingEvent }, filters: {} });
  assert.match(pendingHtml, /Não encontrado — Conta do Cliente: Dhenny novo/, "mesmo texto pra PENDING_ASSOCIATION — padronizado com IGNORED_NOT_OWNED");

  const detailHtml = renderBotEventDetail(notOwnedEvent, { canModify: true, availableNumbers: [] });
  assert.match(detailHtml, /Zig Online/, "empresa aparece no detalhe do evento");
  assert.match(detailHtml, /Mega Feirão de fábrica/);
  assert.match(detailHtml, /Dhenny novo/);

  const withoutMetadata = { ...notOwnedEvent, id: "e2", metadata: {} };
  assert.doesNotMatch(renderBotEventDetail(withoutMetadata), /bot-alertinfo-list/, "sem dado do alerta, não renderiza o bloco à toa");
}

console.log("Central Number Ops Bot (leitura, dashboard, badge de origem): todos os cenários passaram.");
