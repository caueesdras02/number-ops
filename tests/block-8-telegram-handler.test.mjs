import assert from "node:assert/strict";
import { handleTelegramWebhook } from "../supabase/functions/telegram-webhook/handler.js";

// ---------------------------------------------------------------------------
// BLOCO 1 — regras de processamento do webhook (handler), com Supabase FALSO
// em memória. Nenhuma rede/dado real é usado ou alterado.
// ---------------------------------------------------------------------------

const ENV = { webhookSecret: "test-secret-123", allowedChatId: "-1009999" };
const CHAT = { id: -1009999 };

function makeDeps({ numbers = {}, links = {}, campaigns = {}, externalNumbers = {} } = {}) {
  const inserted = [];
  const incidents = [];
  const historyEvents = [];
  let nextIntegrationId = 1;
  let nextIncidentId = 1;
  return {
    inserted, incidents, historyEvents,
    async findNumberIdsByPhones(phones) {
      const ids = new Set();
      phones.forEach((phone) => (numbers[phone] ?? []).forEach((id) => ids.add(id)));
      return [...ids];
    },
    async findExternalNumberMatch(phones) {
      for (const phone of phones) if (externalNumbers[phone]) return { id: externalNumbers[phone] };
      return null;
    },
    async findActiveCampaignIdsForNumber(numberId) { return links[numberId] ?? []; },
    async getCampaignsByIds(ids) { return ids.map((id) => campaigns[id]).filter(Boolean); },
    async insertIntegrationEvent(row) {
      const duplicate = inserted.some((item) => item.source === row.source && item.source_event_id === row.source_event_id);
      if (duplicate) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      const id = `int-evt-${nextIntegrationId++}`;
      inserted.push({ ...row, id, linked_incident_id: null });
      return { data: { id }, error: null };
    },
    async findIntegrationEventBySourceId(source, sourceEventId) {
      return inserted.find((item) => item.source === source && item.source_event_id === sourceEventId) ?? null;
    },
    async insertIncident(row) {
      const dupByEvent = incidents.some((item) => item.integration_event_id != null && item.integration_event_id === row.integration_event_id);
      const dupOpenPerNumber = row.classification === "CONNECTIVITY" && row.origin === "TELEGRAM_BOT" && row.status === "OPEN"
        && incidents.some((item) => item.number_id === row.number_id && item.classification === "CONNECTIVITY" && item.origin === "TELEGRAM_BOT" && item.status === "OPEN");
      if (dupByEvent || dupOpenPerNumber) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      const id = `incident-${nextIncidentId++}`;
      const record = { id, ...row };
      incidents.push(record);
      return { data: { id, title: record.title }, error: null };
    },
    async insertHistoryEvent(row) {
      historyEvents.push(row);
      return { error: null };
    },
    async linkIncidentToIntegrationEvent(integrationEventId, incidentId) {
      const target = inserted.find((item) => item.id === integrationEventId);
      if (target) { target.linked_incident_id = incidentId; target.processing_status = "LINKED_TO_INCIDENT"; }
      return { error: null };
    },
    async findIncidentByIntegrationEventId(integrationEventId) {
      return incidents.find((item) => item.integration_event_id === integrationEventId) ?? null;
    },
    async findOpenConnectivityIncident(numberId) {
      return incidents.find((item) => item.number_id === numberId && item.classification === "CONNECTIVITY" && item.origin === "TELEGRAM_BOT" && item.status === "OPEN") ?? null;
    },
  };
}

function updateWith({ updateId = 1, text, chat = CHAT } = {}) {
  return JSON.stringify({ update_id: updateId, message: { chat, text } });
}

function headersOf(map) { return (name) => map[name.toLowerCase()] ?? null; }
const okHeaders = headersOf({ "x-telegram-bot-api-secret-token": ENV.webhookSecret });

// 1) secret inválido/ausente => 401, nada é persistido, nenhuma consulta ao "banco" é feita
{
  const deps = makeDeps();
  const result = await handleTelegramWebhook({ getHeader: headersOf({}), rawBody: updateWith({ text: "irrelevante" }), env: ENV, deps });
  assert.equal(result.status, 401);
  assert.equal(deps.inserted.length, 0);
}
{
  const deps = makeDeps();
  const result = await handleTelegramWebhook({ getHeader: headersOf({ "x-telegram-bot-api-secret-token": "errado" }), rawBody: updateWith({ text: "x" }), env: ENV, deps });
  assert.equal(result.status, 401);
  assert.equal(deps.inserted.length, 0);
}

// 2) payload malformado (JSON inválido) => 400, nada persistido
{
  const deps = makeDeps();
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: "{ isso nao é json", env: ENV, deps });
  assert.equal(result.status, 400);
  assert.equal(deps.inserted.length, 0);
}

// 2b) JSON válido mas sem update_id => 400
{
  const deps = makeDeps();
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: JSON.stringify({ message: { chat: CHAT, text: "x" } }), env: ENV, deps });
  assert.equal(result.status, 400);
  assert.equal(deps.inserted.length, 0);
}

// 3) chat não autorizado => 200 silencioso, nada persistido
{
  const deps = makeDeps();
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nNúmero: 5511999999999", chat: { id: -1 } }), env: ENV, deps });
  assert.equal(result.status, 200);
  assert.equal(deps.inserted.length, 0, "mensagem de chat não autorizado nunca deve ser persistida");
}

// 4) mensagem não relacionada (chat correto, texto não é alerta) => IGNORED, mas registrado
{
  const deps = makeDeps();
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Bom dia, tudo certo?" }), env: ENV, deps });
  assert.equal(result.status, 200);
  assert.equal(deps.inserted.length, 1);
  assert.equal(deps.inserted[0].processing_status, "IGNORED");
  assert.equal(deps.inserted[0].event_type, "UNKNOWN");
  assert.equal(deps.inserted[0].number_id, null);
}

// 5) número inexistente (telefone válido, mas sem match) => PENDING_ASSOCIATION, número NUNCA é criado
{
  const deps = makeDeps({ numbers: {} });
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  assert.equal(result.status, 200);
  assert.equal(deps.inserted[0].processing_status, "PENDING_ASSOCIATION");
  assert.equal(deps.inserted[0].number_id, null);
  assert.equal(deps.inserted[0].phone_normalized, "5511999999999");
  assert.equal(deps.inserted[0].matched_confidence, 0);
}

// 6) número existente, 1 só campanha ativa => MATCHED + enriquecimento de campanha/cliente
{
  const deps = makeDeps({
    numbers: { "5511999999999": ["num1"] },
    links: { num1: ["camp1"] },
    campaigns: { camp1: { id: "camp1", name: "Pré Black Aura Radiante", clientId: "client1" } },
  });
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nLiveshop: Pré Black Aura Radiante\nNúmero: 5511999999999" }), env: ENV, deps });
  assert.equal(result.status, 200);
  const row = deps.inserted[0];
  assert.equal(row.processing_status, "LINKED_TO_INCIDENT", "MATCHED evolui para LINKED_TO_INCIDENT assim que o acompanhamento (Bloco 2) é criado e linkado");
  assert.equal(row.number_id, "num1");
  assert.equal(row.campaign_id, "camp1");
  assert.equal(row.client_id, "client1");
  assert.equal(row.matched_confidence, 1);
}

// 7) número existente, campanha ambígua (2+ vínculos ativos, texto não desambigua) => campaign_id/client_id nulos
{
  const deps = makeDeps({
    numbers: { "5511999999999": ["num1"] },
    links: { num1: ["camp1", "camp2"] },
    campaigns: {
      camp1: { id: "camp1", name: "Campanha A", clientId: "clientA" },
      camp2: { id: "camp2", name: "Campanha B", clientId: "clientB" },
    },
  });
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nLiveshop: Nome que não bate com nenhuma\nNúmero: 5511999999999" }), env: ENV, deps });
  const row = deps.inserted[0];
  assert.equal(row.processing_status, "LINKED_TO_INCIDENT", "número foi encontrado (ambiguidade é só na campanha) e o acompanhamento ainda assim é criado/linkado normalmente");
  assert.equal(row.number_id, "num1");
  assert.equal(row.campaign_id, null, "não adivinha entre as campanhas ambíguas");
  assert.equal(row.client_id, null);
  assert.equal(row.metadata.campaignMatch, "ambiguous");
}

// 7b) campanha ambígua, mas o nome do Liveshop desambigua por match exato
{
  const deps = makeDeps({
    numbers: { "5511999999999": ["num1"] },
    links: { num1: ["camp1", "camp2"] },
    campaigns: {
      camp1: { id: "camp1", name: "Campanha A", clientId: "clientA" },
      camp2: { id: "camp2", name: "Campanha B", clientId: "clientB" },
    },
  });
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nLiveshop: campanha b\nNúmero: 5511999999999" }), env: ENV, deps });
  const row = deps.inserted[0];
  assert.equal(row.campaign_id, "camp2");
  assert.equal(row.client_id, "clientB");
  assert.equal(row.metadata.campaignMatch, "matched_by_name");
}

// 8) alerta reconhecido mas sem telefone extraível => ERROR (não descarta o evento)
{
  const deps = makeDeps();
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "🚨 ALERTA DE INFRAESTRUTURA\nStatus: DESCONECTADO\nEmpresa: X" }), env: ENV, deps });
  assert.equal(result.status, 200);
  assert.equal(deps.inserted[0].processing_status, "ERROR");
  assert.ok(deps.inserted[0].error_message);
}

// 9) update duplicado (mesmo update_id reenviado pelo Telegram) => idempotente, não duplica linha
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });
  const body = updateWith({ updateId: 42, text: "Status: DESCONECTADO\nNúmero: 5511999999999" });
  const first = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: body, env: ENV, deps });
  const second = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: body, env: ENV, deps });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(deps.inserted.length, 1, "reenvio não deve criar uma segunda linha");
}

// 10) payload maior que o limite defensivo => 413, nada persistido
{
  const deps = makeDeps();
  const hugeText = "a".repeat(70_000);
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: hugeText }), env: ENV, deps });
  assert.equal(result.status, 413);
  assert.equal(deps.inserted.length, 0);
}

// 11) raw_payload original é sempre preservado integralmente, mesmo em IGNORED/ERROR
{
  const deps = makeDeps();
  const body = updateWith({ updateId: 7, text: "mensagem qualquer" });
  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: body, env: ENV, deps });
  assert.deepEqual(deps.inserted[0].raw_payload, JSON.parse(body));
}

// 12) BUG REAL (produção): numbers.phone = "5581920039925", mas o alerta pode trazer
// o telefone em qualquer uma destas 5 formas — todas devem resolver number_id.
{
  const FORMATOS = ["81920039925", "5581920039925", "+5581920039925", "+55 (81) 92003-9925", "(81) 92003-9925"];
  let updateId = 100;
  for (const formato of FORMATOS) {
    const deps = makeDeps({ numbers: { "5581920039925": ["num-real"] } });
    const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ updateId: updateId++, text: `Status: DESCONECTADO\nNúmero: ${formato}` }), env: ENV, deps });
    assert.equal(result.status, 200);
    const row = deps.inserted[0];
    assert.equal(row.processing_status, "LINKED_TO_INCIDENT", `formato "${formato}" deveria casar com o número existente e ter o acompanhamento linkado`);
    assert.equal(row.number_id, "num-real", `formato "${formato}" deveria resolver number_id`);
    assert.equal(row.matched_confidence, 1);
  }
}

// 13) número não existe em NENHUMA forma (com ou sem 55) => continua PENDING_ASSOCIATION,
// nunca cria número (o fix de formato não deve introduzir falso-positivo).
{
  const deps = makeDeps({ numbers: { "5581920039925": ["num-real"] } });
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nNúmero: 81900000000" }), env: ENV, deps });
  assert.equal(deps.inserted[0].processing_status, "PENDING_ASSOCIATION");
  assert.equal(deps.inserted[0].number_id, null);
}

// 14) telefone já classificado como "não pertence à operação" (memória de externos) =>
// ignorado automaticamente, nunca vira PENDING_ASSOCIATION, número nunca é criado.
{
  const deps = makeDeps({ numbers: {}, externalNumbers: { "5511900000001": "external-1" } });
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nNúmero: 5511900000001" }), env: ENV, deps });
  assert.equal(result.status, 200);
  assert.equal(deps.inserted[0].processing_status, "IGNORED_NOT_OWNED");
  assert.equal(deps.inserted[0].number_id, null);
  assert.equal(deps.inserted[0].matched_confidence, 0);
  assert.deepEqual(deps.inserted[0].metadata.notOwned, { reason: "NUMBER_NOT_OWNED", externalNumberId: "external-1", auto: true });
}

// 15) mesmo telefone externo, formatado com +55/parênteses/hífen (formas equivalentes) =>
// também reconhecido automaticamente (mesma normalização de brazilianPhoneCandidates).
{
  const deps = makeDeps({ numbers: {}, externalNumbers: { "5511900000002": "external-2" } });
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nNúmero: +55 (11) 90000-0002" }), env: ENV, deps });
  assert.equal(result.status, 200);
  assert.equal(deps.inserted[0].processing_status, "IGNORED_NOT_OWNED");
}

// 16) telefone externo SEM o "55" no texto do alerta => ainda reconhecido (candidatos
// determinísticos com/sem código do país, igual ao match de numbers).
{
  const deps = makeDeps({ numbers: {}, externalNumbers: { "5511900000003": "external-3" } });
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nNúmero: 11900000003" }), env: ENV, deps });
  assert.equal(deps.inserted[0].processing_status, "IGNORED_NOT_OWNED");
}

// 17) prioridade: telefone existe em `numbers` E também está (por engano/legado) na
// memória de externos => `numbers` sempre ganha (MATCHED), memória de externos nunca é
// consultada nesse caso.
{
  const deps = makeDeps({ numbers: { "5511900000004": ["num-priority"] }, externalNumbers: { "5511900000004": "external-4" } });
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nNúmero: 5511900000004" }), env: ENV, deps });
  assert.equal(deps.inserted[0].number_id, "num-priority");
  assert.notEqual(deps.inserted[0].processing_status, "IGNORED_NOT_OWNED");
}

console.log("Bloco 1 (handler Telegram): todos os cenários passaram.");
