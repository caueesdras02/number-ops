import assert from "node:assert/strict";
import { handleTelegramWebhook } from "../supabase/functions/telegram-webhook/handler.js";
import { resolveOpenConnectivity, processConnectivityClassification } from "../supabase/functions/telegram-webhook/classification.js";

// ---------------------------------------------------------------------------
// BLOCO — fechamento do ciclo CONNECTIVITY: OPEN -> RESOLVED -> nova OPEN.
//
// IMPORTANTE: não existe evidência do texto real que o bot de infraestrutura
// envia numa recuperação/normalização, então o parser (parse-alert.js) NÃO
// foi alterado e nunca produz event_type "CONNECTIVITY_RESTORED" a partir de
// texto real. Por isso os testes abaixo exercitam o lado "recuperação" DIRETO
// em classification.js, com um integration_event sintético — provando que a
// arquitetura interna está pronta, sem fingir que o parser já sabe reconhecer
// essa mensagem. O lado "alerta" continua indo pelo caminho real
// (handleTelegramWebhook), exatamente como nos blocos anteriores.
// ---------------------------------------------------------------------------

const ENV = { webhookSecret: "test-secret-123", allowedChatId: "-1009999" };
const CHAT = { id: -1009999 };

function makeDeps({ numbers = {} } = {}) {
  const inserted = [];
  const incidents = [];
  const historyEvents = [];
  let nextIntegrationId = 1;
  let nextIncidentId = 1;
  return {
    inserted, incidents, historyEvents,
    async findExternalNumberMatch() { return null; },
    async findNumberIdsByPhones(phones) {
      const ids = new Set();
      phones.forEach((phone) => (numbers[phone] ?? []).forEach((id) => ids.add(id)));
      return [...ids];
    },
    async findActiveCampaignIdsForNumber() { return []; },
    async getCampaignsByIds() { return []; },
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
    async resolveIncident(incidentId) {
      const incident = incidents.find((item) => item.id === incidentId);
      if (!incident || incident.status !== "OPEN") return { data: false, error: null };
      incident.status = "RESOLVED";
      incident.resolved_at = "2026-01-01T00:00:00.000Z";
      incident.resolution_notes = "Resolvida automaticamente pela integração (Telegram) — conectividade normalizada.";
      return { data: true, error: null };
    },
  };
}

function updateWith({ updateId = 1, text, chat = CHAT } = {}) {
  return JSON.stringify({ update_id: updateId, message: { chat, text } });
}
function headersOf(map) { return (name) => map[name.toLowerCase()] ?? null; }
const okHeaders = headersOf({ "x-telegram-bot-api-secret-token": ENV.webhookSecret });

const syntheticRestored = (id, numberId) => ({ id, processing_status: "MATCHED", event_type: "CONNECTIVITY_RESTORED", number_id: numberId, campaign_id: null, linked_incident_id: null });

// 1) ciclo completo: ALERT cria OPEN -> RESTORED (sintético) resolve -> novo ALERT cria uma OPEN NOVA
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });

  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ updateId: 1, text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  assert.equal(deps.incidents.length, 1, "alerta real cria a primeira ocorrência OPEN");
  const firstIncidentId = deps.incidents[0].id;
  assert.equal(deps.incidents[0].status, "OPEN");

  const outcome = await resolveOpenConnectivity(deps, syntheticRestored("synthetic-recovery-1", "num1"));
  assert.equal(outcome.resolved, true);
  assert.equal(outcome.incidentId, firstIncidentId);
  assert.equal(deps.incidents[0].status, "RESOLVED", "recuperação resolve a MESMA ocorrência");
  assert.equal(deps.incidents[0].origin, "TELEGRAM_BOT", "continua auditável como originada pelo bot mesmo depois de resolvida");
  assert.equal(deps.historyEvents.filter((e) => e.type === "INCIDENT_RESOLVED").length, 1);
  assert.equal(deps.historyEvents.at(-1).metadata.origin, "TELEGRAM_BOT");

  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ updateId: 2, text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  assert.equal(deps.incidents.length, 2, "com a anterior RESOLVED, um novo alerta deve criar uma ocorrência NOVA");
  assert.notEqual(deps.incidents[1].id, firstIncidentId);
  assert.equal(deps.incidents[1].status, "OPEN");
}

// 2) idempotência: dois eventos de recuperação DIFERENTES (update_id distintos) para a mesma
// ocorrência não duplicam a resolução nem o histórico — só o primeiro "conta".
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });
  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ updateId: 10, text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  const incidentId = deps.incidents[0].id;

  const first = await resolveOpenConnectivity(deps, syntheticRestored("recovery-a", "num1"));
  const second = await resolveOpenConnectivity(deps, syntheticRestored("recovery-b", "num1"));
  assert.equal(first.resolved, true, "primeiro evento de recuperação resolve de fato");
  assert.equal(second.resolved, false, "segundo evento (já sem OPEN) não resolve de novo");
  assert.equal(deps.incidents[0].status, "RESOLVED");
  assert.equal(deps.historyEvents.filter((e) => e.type === "INCIDENT_RESOLVED").length, 1, "não duplica INCIDENT_RESOLVED");
  assert.equal(deps.incidents.length, 1, "não cria ocorrência nenhuma a partir de recuperação");
  void incidentId;
}

// 3) idempotência do MESMO update (reenvio exato do Telegram) — reaproveita a infraestrutura já
// testada nos blocos anteriores (dedupe por source_event_id), agora também para CONNECTIVITY_RESTORED.
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });
  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ updateId: 20, text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  const incidentId = deps.incidents[0].id;

  const event = syntheticRestored("recovery-x", "num1");
  const first = await resolveOpenConnectivity(deps, event);
  assert.equal(first.resolved, true);
  // simula o "reenvio": o mesmo objeto de evento, agora já linkado (como estaria no banco)
  const alreadyLinked = { ...event, linked_incident_id: incidentId };
  const second = await resolveOpenConnectivity(deps, alreadyLinked);
  assert.equal(second.resolved, false, "evento já linkado não faz nada de novo (guarda de idempotência)");
  assert.equal(deps.historyEvents.filter((e) => e.type === "INCIDENT_RESOLVED").length, 1);
}

// 4) se NÃO houver ocorrência OPEN para o número, recuperação não cria nada
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });
  const outcome = await resolveOpenConnectivity(deps, syntheticRestored("recovery-none", "num1"));
  assert.equal(outcome.resolved, false);
  assert.equal(deps.incidents.length, 0, "recuperação nunca cria ocorrência, só resolve uma existente");
  assert.equal(deps.historyEvents.length, 0);
}

// 5) dispatcher: CONNECTIVITY_ALERT vai para criação/reuso, CONNECTIVITY_RESTORED vai para resolução,
// qualquer outro event_type não faz nada (não inventa comportamento para o desconhecido).
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });
  const alertEvent = { id: "evt-a", processing_status: "MATCHED", event_type: "CONNECTIVITY_ALERT", number_id: "num1", campaign_id: null, linked_incident_id: null };
  const created = await processConnectivityClassification(deps, alertEvent);
  assert.equal(created.created, true);

  const restoredEvent = syntheticRestored("evt-b", "num1");
  const resolved = await processConnectivityClassification(deps, restoredEvent);
  assert.equal(resolved.resolved, true);

  const unknownEvent = { id: "evt-c", processing_status: "MATCHED", event_type: "SOME_FUTURE_TYPE", number_id: "num1", campaign_id: null, linked_incident_id: null };
  const noop = await processConnectivityClassification(deps, unknownEvent);
  assert.deepEqual(noop, { created: false, resolved: false });
  assert.equal(deps.incidents.length, 1, "event_type desconhecido não cria nem resolve nada");
}

// 6) recuperação nunca toca nada operacional — a mesma garantia estrutural do Bloco 2: a superfície
// de `deps` usada aqui não expõe NENHUM método de escrita em numbers/restrictions/campanha.
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });
  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ updateId: 30, text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  await resolveOpenConnectivity(deps, syntheticRestored("recovery-safety", "num1"));
  const methodNames = Object.keys(deps).filter((key) => typeof deps[key] === "function");
  assert.ok(methodNames.every((name) => !/number.*status|restriction|blocked|underReview|setStatus|updateNumber|unassign|campaignLink/i.test(name)), `deps não deve expor nenhuma escrita operacional (métodos: ${methodNames.join(", ")})`);
}

console.log("Bloco (ciclo CONNECTIVITY OPEN->RESOLVED->OPEN): todos os cenários passaram.");
