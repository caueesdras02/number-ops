import assert from "node:assert/strict";
import { handleTelegramWebhook } from "../supabase/functions/telegram-webhook/handler.js";

// ---------------------------------------------------------------------------
// BLOCO 2 — classificação/acompanhamento (CONNECTIVITY_ALERT -> incidents),
// com Supabase FALSO em memória. Nenhuma rede/dado real é usado ou alterado.
// ---------------------------------------------------------------------------

const ENV = { webhookSecret: "test-secret-123", allowedChatId: "-1009999" };
const CHAT = { id: -1009999 };

function makeDeps({ numbers = {}, links = {}, campaigns = {}, failIncidentInsert = false, failLink = false } = {}) {
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
      if (failIncidentInsert) return { data: null, error: { message: "falha simulada de rede" } };
      // Espelha os DOIS índices únicos parciais da migration 014:
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
      if (failLink) return { error: { message: "falha simulada de rede" } };
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
    resolveIncident(incidentId) {
      const incident = incidents.find((item) => item.id === incidentId);
      if (incident) incident.status = "RESOLVED";
    },
  };
}

function updateWith({ updateId = 1, text, chat = CHAT } = {}) {
  return JSON.stringify({ update_id: updateId, message: { chat, text } });
}
function headersOf(map) { return (name) => map[name.toLowerCase()] ?? null; }
const okHeaders = headersOf({ "x-telegram-bot-api-secret-token": ENV.webhookSecret });

// 1) CONNECTIVITY_ALERT + número encontrado => acompanhamento criado corretamente
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  assert.equal(result.status, 200);
  assert.equal(deps.incidents.length, 1);
  const incident = deps.incidents[0];
  assert.equal(incident.number_id, "num1");
  assert.equal(incident.campaign_id, null);
  assert.equal(incident.classification, "CONNECTIVITY");
  assert.equal(incident.origin, "TELEGRAM_BOT");
  assert.equal(incident.type, "CONNECTIVITY");
  assert.equal(incident.status, "OPEN");
  assert.equal(incident.integration_event_id, deps.inserted[0].id, "acompanhamento preserva referência ao integration_event de origem");
  assert.equal(deps.inserted[0].linked_incident_id, incident.id, "integration_event fica linkado ao acompanhamento criado");
  assert.equal(deps.inserted[0].processing_status, "LINKED_TO_INCIDENT", "processing_status evolui de MATCHED para LINKED_TO_INCIDENT quando o acompanhamento é criado e linkado com sucesso");
  assert.equal(deps.historyEvents.length, 1, "histórico do número recebe o mesmo tipo de evento que a criação manual de ocorrência gera");
  assert.equal(deps.historyEvents[0].number_id, "num1");
  assert.equal(deps.historyEvents[0].type, "INCIDENT_CREATED");
}

// 2) CONNECTIVITY_ALERT + número + campanha encontrados => campaign_id no acompanhamento
{
  const deps = makeDeps({
    numbers: { "5511999999999": ["num1"] },
    links: { num1: ["camp1"] },
    campaigns: { camp1: { id: "camp1", name: "Campanha X", clientId: "clientX" } },
  });
  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nLiveshop: Campanha X\nNúmero: 5511999999999" }), env: ENV, deps });
  const incident = deps.incidents[0];
  assert.equal(incident.campaign_id, "camp1");
  assert.equal(incident.number_id, "num1");
}

// 3) número não encontrado => continua PENDING_ASSOCIATION, NENHUM acompanhamento é criado (não vincula ocorrência a número inexistente)
{
  const deps = makeDeps({ numbers: {} });
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  assert.equal(result.status, 200);
  assert.equal(deps.inserted[0].processing_status, "PENDING_ASSOCIATION");
  assert.equal(deps.inserted[0].number_id, null);
  assert.equal(deps.incidents.length, 0, "nenhuma ocorrência deve ser criada sem number_id resolvido");
  assert.equal(deps.inserted[0].linked_incident_id, null);
}

// 4) evento duplicado (reenvio simples do MESMO update_id, já totalmente processado) => não duplica acompanhamento
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });
  const body = updateWith({ updateId: 50, text: "Status: DESCONECTADO\nNúmero: 5511999999999" });
  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: body, env: ENV, deps });
  const result2 = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: body, env: ENV, deps });
  assert.equal(result2.status, 200);
  assert.equal(result2.body.duplicate, true);
  assert.equal(deps.incidents.length, 1, "reenvio não deve criar um segundo acompanhamento");
  assert.equal(deps.historyEvents.length, 1, "reenvio não deve duplicar o evento de histórico");
}

// 5/6/7) CONNECTIVITY nunca altera status/restrição/utilização do número — a superfície de `deps`
// usada por esta integração não tem NENHUM método capaz de escrever em `numbers` (só leitura, via
// findNumberIdsByPhones) nem em `restrictions` — é estruturalmente impossível este fluxo colocar um
// número em análise, bloqueá-lo ou criar/remover uma restrição.
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });
  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  const methodNames = Object.keys(deps).filter((key) => typeof deps[key] === "function");
  assert.ok(methodNames.every((name) => !/number.*status|restriction|blocked|underReview|setStatus|updateNumber/i.test(name)), `deps não deve expor nenhum método de escrita de status/restrição de número (métodos: ${methodNames.join(", ")})`);
  // o único método que toca `numbers` é de LEITURA (busca de id por telefone) — nunca update/insert.
  assert.equal(typeof deps.findNumberIdsByPhones, "function");
  // "status" só existe no acompanhamento (OPEN/RESOLVED da ocorrência), nunca no número:
  assert.equal(deps.incidents[0].status, "OPEN");
}

// 8) NO_AREA continua independente: a classificação desta integração é sempre "CONNECTIVITY" para
// um CONNECTIVITY_ALERT MATCHED — nunca produz nem consome nada relacionado a restrição/NO_AREA
// (NO_AREA é um conceito exclusivo de public.restrictions / models/number.js, de outro bloco).
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });
  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  const incident = deps.incidents[0];
  assert.equal(incident.classification, "CONNECTIVITY");
  assert.ok(!("restriction" in incident) && !("no_area" in incident) && !("kind" in incident), "acompanhamento não carrega nenhum campo de restrição");
}

// 9) campaign_id NULL continua permitido (número sem nenhuma campanha ativa vinculada)
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] }, links: { num1: [] } });
  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  assert.equal(deps.incidents[0].campaign_id, null);
  assert.equal(deps.incidents.length, 1, "campaign_id nulo não impede a criação do acompanhamento");
}

// 10) falha parcial não deixa dado inconsistente: 1ª tentativa cria o integration_event e o incident,
// mas falha ao GRAVAR o vínculo (linked_incident_id). O reenvio do Telegram (mesmo update_id) deve
// completar o vínculo sem criar um segundo incident nem um segundo history_event.
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] }, failLink: true });
  const body = updateWith({ updateId: 77, text: "Status: DESCONECTADO\nNúmero: 5511999999999" });
  const first = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: body, env: ENV, deps });
  assert.equal(first.status, 500, "falha ao completar o link deve pedir novo envio ao Telegram (nunca reporta sucesso falso)");
  assert.equal(deps.inserted.length, 1, "o integration_event já está salvo de forma consistente (MATCHED, sem link)");
  assert.equal(deps.incidents.length, 1, "o acompanhamento já foi criado nessa tentativa");
  assert.equal(deps.inserted[0].linked_incident_id, null, "o link ainda não foi concluído");

  deps.linkIncidentToIntegrationEvent = async (integrationEventId, incidentId) => {
    const target = deps.inserted.find((item) => item.id === integrationEventId);
    if (target) { target.linked_incident_id = incidentId; target.processing_status = "LINKED_TO_INCIDENT"; }
    return { error: null };
  };
  const second = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: body, env: ENV, deps });
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(deps.incidents.length, 1, "reenvio recupera o acompanhamento já existente em vez de criar outro");
  assert.equal(deps.historyEvents.length, 1, "reenvio não duplica o evento de histórico");
  assert.equal(deps.inserted[0].linked_incident_id, deps.incidents[0].id, "reenvio completa o vínculo que tinha falhado");
}

// 10b) falha ao criar o próprio incident (não é conflito de duplicidade) => 500, e integration_event
// permanece consistente (MATCHED, sem link) para retry — nunca fica com dado incompleto/corrompido.
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] }, failIncidentInsert: true });
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  assert.equal(result.status, 500);
  assert.equal(deps.inserted.length, 1);
  assert.equal(deps.inserted[0].processing_status, "MATCHED");
  assert.equal(deps.inserted[0].linked_incident_id, null);
  assert.equal(deps.incidents.length, 0);
  assert.equal(deps.historyEvents.length, 0, "sem incident criado, não deve sobrar history_event órfão");
}

// 11) evento desconhecido/IGNORED (mensagem não relacionada) => nenhum acompanhamento é criado
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });
  const result = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ text: "Bom dia time!" }), env: ENV, deps });
  assert.equal(result.status, 200);
  assert.equal(deps.inserted[0].processing_status, "IGNORED");
  assert.equal(deps.incidents.length, 0);
  assert.equal(deps.historyEvents.length, 0);
}

// ---------------------------------------------------------------------------
// Consolidação por número: alertas CONNECTIVITY consecutivos do MESMO número,
// enquanto a ocorrência anterior continuar OPEN, reaproveitam a mesma
// ocorrência — sem janela de tempo, só "existe uma OPEN?".
// ---------------------------------------------------------------------------

// 12) primeiro CONNECTIVITY cria ocorrência; segundo do MESMO número reutiliza a OPEN;
// os dois integration_events ficam vinculados à MESMA ocorrência; INCIDENT_CREATED não duplica.
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });
  const first = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ updateId: 201, text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  assert.equal(first.status, 200);
  assert.equal(deps.incidents.length, 1, "primeiro alerta cria a ocorrência");
  const incidentId = deps.incidents[0].id;

  const second = await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ updateId: 202, text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  assert.equal(second.status, 200);
  assert.equal(deps.incidents.length, 1, "segundo alerta do MESMO número, com a ocorrência anterior ainda OPEN, não cria uma segunda");
  assert.equal(deps.incidents[0].id, incidentId, "continua a mesma ocorrência (id inalterado)");

  // dois integration_events DIFERENTES, ambos vinculados à mesma ocorrência:
  assert.equal(deps.inserted.length, 2);
  assert.notEqual(deps.inserted[0].id, deps.inserted[1].id, "são dois eventos distintos (update_id diferente)");
  assert.equal(deps.inserted[0].linked_incident_id, incidentId);
  assert.equal(deps.inserted[1].linked_incident_id, incidentId, "o segundo evento também fica linkado à mesma ocorrência do primeiro");
  assert.equal(deps.inserted[1].processing_status, "LINKED_TO_INCIDENT");

  // INCIDENT_CREATED não duplica: só o primeiro alerta gera o evento de histórico.
  assert.equal(deps.historyEvents.length, 1, "reaproveitar a ocorrência não deve gerar um segundo INCIDENT_CREATED");

  // a campanha resolvida em cada evento é preservada em cada linha, sem reescrever a ocorrência:
  assert.equal(deps.incidents[0].campaign_id, null, "campaign_id da ocorrência não é o critério de reuso e não é sobrescrito pelo segundo evento");
}

// 13) depois que a ocorrência é RESOLVED, um novo CONNECTIVITY do mesmo número cria uma ocorrência NOVA
{
  const deps = makeDeps({ numbers: { "5511999999999": ["num1"] } });
  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ updateId: 301, text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  assert.equal(deps.incidents.length, 1);
  deps.resolveIncident(deps.incidents[0].id);

  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ updateId: 302, text: "Status: DESCONECTADO\nNúmero: 5511999999999" }), env: ENV, deps });
  assert.equal(deps.incidents.length, 2, "com a primeira ocorrência RESOLVED, o novo alerta deve criar uma ocorrência nova");
  assert.notEqual(deps.incidents[1].id, deps.incidents[0].id);
  assert.equal(deps.incidents[1].status, "OPEN");
  assert.equal(deps.historyEvents.length, 2, "a nova ocorrência gera seu próprio INCIDENT_CREATED");
}

// 14) números DIFERENTES sempre criam ocorrências diferentes (a consolidação é só por número)
{
  const deps = makeDeps({ numbers: { "5511999999991": ["numA"], "5511999999992": ["numB"] } });
  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ updateId: 401, text: "Status: DESCONECTADO\nNúmero: 5511999999991" }), env: ENV, deps });
  await handleTelegramWebhook({ getHeader: okHeaders, rawBody: updateWith({ updateId: 402, text: "Status: DESCONECTADO\nNúmero: 5511999999992" }), env: ENV, deps });
  assert.equal(deps.incidents.length, 2, "números diferentes nunca compartilham ocorrência");
  assert.equal(deps.incidents[0].number_id, "numA");
  assert.equal(deps.incidents[1].number_id, "numB");
}

console.log("Bloco 2 (classificação/acompanhamento Telegram): todos os cenários passaram.");
