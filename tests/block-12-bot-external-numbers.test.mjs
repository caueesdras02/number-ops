import assert from "node:assert/strict";
import { BotService } from "../src/js/services/bot-service.js";
import { canonicalBrazilianPhone } from "../src/js/models/phone.js";

// ---------------------------------------------------------------------------
// BLOCO 12 — tratamento definitivo de números externos (memória "não pertence
// à operação" + associação manual reprocessando o pipeline). Tudo com
// repositórios FALSOS em memória — nenhuma rede/dado real é usado ou alterado.
// ---------------------------------------------------------------------------

function makeExternalNumbersRepository(seed = []) {
  const rows = [...seed];
  let n = 0;
  return {
    rows,
    async list() { return rows.map((row) => ({ ...row })); },
    async upsert(record) {
      const activeConflict = rows.find((row) => row.phone_normalized === record.phone_normalized && !row.reverted_at);
      if (activeConflict) { const error = new Error("duplicate key value violates unique constraint"); error.code = "23505"; throw error; }
      const row = { id: `ext-${++n}`, reverted_at: null, reverted_by: null, created_at: new Date().toISOString(), ...record };
      rows.push(row);
      return { ...row };
    },
    async update(id, changes) {
      const row = rows.find((item) => item.id === id);
      if (!row) throw new Error("external_numbers row not found");
      Object.assign(row, changes);
      return { ...row };
    },
  };
}

function makeIntegrationEventsRepository(seed = []) {
  const rows = [...seed];
  return {
    rows,
    async list() { return rows.map((row) => ({ ...row })); },
    async update(id, changes) {
      const row = rows.find((item) => item.id === id);
      if (!row) throw new Error("integration_events row not found");
      Object.assign(row, changes);
      return { ...row };
    },
  };
}

function makeIncidentsRepository(seed = []) {
  const rows = [...seed];
  let n = 0;
  return {
    rows,
    upsertCalls: 0,
    async list() { return rows.map((row) => ({ ...row })); },
    async upsert(record) {
      this.upsertCalls++;
      const duplicate = rows.some((row) =>
        (record.integration_event_id && row.integration_event_id === record.integration_event_id) ||
        (row.number_id === record.number_id && row.classification === "CONNECTIVITY" && row.origin === "TELEGRAM_BOT" && row.status === "OPEN"));
      if (duplicate) { const error = new Error("duplicate key value violates unique constraint"); error.code = "23505"; throw error; }
      const row = { id: `inc-${++n}`, ...record };
      rows.push(row);
      return { ...row };
    },
  };
}

function makeHistoryEventsRepository() {
  const rows = [];
  return { rows, async upsert(record) { rows.push(record); return { ...record }; } };
}

function makeEvent(overrides = {}) {
  return {
    id: "evt-1", source: "TELEGRAM", eventType: "CONNECTIVITY_ALERT", phoneNormalized: "5511900000001",
    numberId: null, campaignId: null, clientId: null, processingStatus: "PENDING_ASSOCIATION",
    linkedIncidentId: null, metadata: {}, receivedAt: "2026-01-01T00:00:00.000Z", processedAt: null,
    ...overrides,
  };
}

function makeService({ profile = { id: "profile-1", access_level: "USER" }, numbers = [], campaigns = [], numberCampaignLinks = [], incidents = [], events = [], externalRows = [] } = {}) {
  const integrationEventsRepository = makeIntegrationEventsRepository(events);
  const externalNumbersRepository = makeExternalNumbersRepository(externalRows);
  const incidentsRepository = makeIncidentsRepository(incidents);
  const historyEventsRepository = makeHistoryEventsRepository();
  const numbersService = { state: { numbers, campaigns, numberCampaignLinks, incidents } };
  const service = new BotService({ integrationEventsRepository, externalNumbersRepository, incidentsRepository, historyEventsRepository, numbersService, currentProfile: profile });
  return { service, integrationEventsRepository, externalNumbersRepository, incidentsRepository, historyEventsRepository, numbersService };
}

// 1) pendente -> externo: não apaga o evento, não cria número/ocorrência, não toca status/utilização/campanha.
{
  const event = makeEvent();
  const { service, integrationEventsRepository, externalNumbersRepository, incidentsRepository } = makeService({ events: [{ id: event.id, processing_status: "PENDING_ASSOCIATION" }] });
  await service.markNotOwned(event.id, event);
  assert.equal(integrationEventsRepository.rows.length, 1, "evento não é apagado");
  assert.equal(integrationEventsRepository.rows[0].processing_status, "IGNORED_NOT_OWNED");
  assert.equal(integrationEventsRepository.rows[0].metadata.notOwned.reason, "NUMBER_NOT_OWNED");
  assert.equal(integrationEventsRepository.rows[0].metadata.notOwned.auto, false, "classificação manual registrada como não-automática");
  assert.ok(integrationEventsRepository.rows[0].metadata.notOwned.classifiedBy, "registra quem classificou");
  assert.ok(integrationEventsRepository.rows[0].metadata.notOwned.classifiedAt, "registra quando");
  assert.equal(externalNumbersRepository.rows.length, 1, "memória de externos gravada");
  assert.equal(externalNumbersRepository.rows[0].phone_normalized, "5511900000001");
  assert.equal(incidentsRepository.upsertCalls, 0, "nenhuma ocorrência criada");
}

// 2) externo deixa de contar como pendente
{
  const events = [
    makeEvent({ id: "e1", processingStatus: "PENDING_ASSOCIATION" }),
    makeEvent({ id: "e2", processingStatus: "IGNORED_NOT_OWNED", phoneNormalized: "5511900000002" }),
  ];
  const { service } = makeService();
  const metrics = service.computeMetrics(events);
  assert.equal(metrics.pending, 1, "só o evento PENDING_ASSOCIATION conta como pendente");
  assert.equal(metrics.notOwned, 1);
}

// 3) idempotência da memória: dois eventos do MESMO telefone marcados como externo não duplicam external_numbers
{
  const phone = "5511900000003";
  const eventA = makeEvent({ id: "ea", phoneNormalized: phone });
  const eventB = makeEvent({ id: "eb", phoneNormalized: phone });
  const { service, externalNumbersRepository, integrationEventsRepository } = makeService({
    events: [{ id: "ea", processing_status: "PENDING_ASSOCIATION" }, { id: "eb", processing_status: "PENDING_ASSOCIATION" }],
  });
  await service.markNotOwned(eventA.id, eventA);
  await service.markNotOwned(eventB.id, eventB);
  assert.equal(externalNumbersRepository.rows.length, 1, "reaproveita o mesmo registro de memória, nunca duplica");
  assert.equal(integrationEventsRepository.rows.find((r) => r.id === "ea").metadata.notOwned.externalNumberId, integrationEventsRepository.rows.find((r) => r.id === "eb").metadata.notOwned.externalNumberId);
}

// 4) telefone externo depois cadastrado em numbers tem prioridade sobre a memória — responsabilidade do
// handler.js do backend (numbers é sempre verificado ANTES de external_numbers); ver tests/block-8 casos 14-17.
// Aqui confirmamos apenas que markNotOwned nunca é chamado/necessário quando o evento já resolveu número:
{
  const event = makeEvent({ numberId: "num1", processingStatus: "MATCHED" });
  const { service } = makeService({ events: [{ id: event.id, processing_status: "MATCHED" }] });
  await assert.rejects(() => service.markNotOwned(event.id, event), /não está pendente/);
}

// 5) pendente -> associação manual: nunca cria número, associa ao number_id escolhido
{
  const event = makeEvent();
  const numbers = [{ id: "num1", phone: "5511900000001", archivedAt: null }];
  const campaigns = [{ id: "camp1", name: "Campanha X", clientId: "client1" }];
  const numberCampaignLinks = [{ numberId: "num1", campaignId: "camp1", endedAt: null }];
  const { service, integrationEventsRepository, numbersService } = makeService({
    events: [{ id: event.id, processing_status: "PENDING_ASSOCIATION" }], numbers, campaigns, numberCampaignLinks,
  });
  const numbersBefore = numbersService.state.numbers.length;
  await service.associateNumber(event.id, "num1", event);
  assert.equal(numbersService.state.numbers.length, numbersBefore, "nenhum número é criado");
  const row = integrationEventsRepository.rows[0];
  assert.equal(row.number_id, "num1");
  assert.equal(row.campaign_id, "camp1", "campanha resolvida via vínculo ativo único");
  assert.equal(row.processing_status, "LINKED_TO_INCIDENT");
  assert.equal(numbersService.state.incidents.length, 1, "ocorrência criada pelo reprocessamento");
  assert.equal(numbersService.state.incidents[0].classification, "CONNECTIVITY");
  assert.equal(numbersService.state.incidents[0].origin, "TELEGRAM_BOT");
}

// 6) associação continua o pipeline sem duplicar ocorrência (dedupe CONNECTIVITY OPEN por número)
{
  const numbers = [{ id: "num1", phone: "5511900000001", archivedAt: null }];
  const eventA = makeEvent({ id: "ea" });
  const eventB = makeEvent({ id: "eb", phoneNormalized: "5511900000009" });
  const { service, numbersService, incidentsRepository } = makeService({
    events: [{ id: "ea", processing_status: "PENDING_ASSOCIATION" }, { id: "eb", processing_status: "PENDING_ASSOCIATION" }], numbers,
  });
  await service.associateNumber(eventA.id, "num1", eventA);
  await service.associateNumber(eventB.id, "num1", eventB);
  assert.equal(incidentsRepository.rows.length, 1, "uma única ocorrência OPEN para o número, nunca duplicada");
  assert.equal(numbersService.state.incidents.length, 1);
}

// 7) VIEWER sem escrita
{
  const event = makeEvent();
  const { service } = makeService({ profile: { access_level: "VIEWER" }, events: [{ id: event.id, processing_status: "PENDING_ASSOCIATION" }] });
  await assert.rejects(() => service.markNotOwned(event.id, event), /permissão/);
  await assert.rejects(() => service.associateNumber(event.id, "num1", event), /permissão/);
  await assert.rejects(() => service.revertNotOwned("ext-1"), /permissão/);
  assert.equal(service.canModify, false);
}

// 8) +55 e formatos brasileiros equivalentes chegam à MESMA forma canônica (sem LIKE/substring)
{
  assert.equal(canonicalBrazilianPhone("5511900000002"), "5511900000002");
  assert.equal(canonicalBrazilianPhone("+55 (11) 90000-0002"), "5511900000002");
  assert.equal(canonicalBrazilianPhone("11900000002"), "5511900000002");
  assert.equal(canonicalBrazilianPhone("(11) 90000-0002"), "5511900000002");
  assert.equal(canonicalBrazilianPhone("123"), null, "nunca inventa/completa dígitos para formato não reconhecível");
}

// 9) idempotência do reprocessamento: corrida em que a ocorrência já foi criada por outra chamada é recuperada, não duplicada
{
  const numbers = [{ id: "num1", phone: "5511900000001", archivedAt: null }];
  const event = makeEvent();
  const { service, numbersService, incidentsRepository } = makeService({ events: [{ id: event.id, processing_status: "PENDING_ASSOCIATION" }], numbers });
  // Simula que já existe (de outra aba/ação) uma OPEN para este número, sem estar ainda no state em memória.
  incidentsRepository.rows.push({ id: "inc-race", number_id: "num1", classification: "CONNECTIVITY", origin: "TELEGRAM_BOT", status: "OPEN", integration_event_id: null });
  await service.associateNumber(event.id, "num1", event);
  assert.equal(incidentsRepository.rows.length, 1, "recupera a ocorrência existente em vez de duplicar");
  assert.equal(numbersService.state.incidents.length, 0, "não empurra uma ocorrência nova pro state — reaproveitou a existente via linked_incident_id");
}

// 10) nenhum externo cria ocorrência
{
  const event = makeEvent();
  const { service, incidentsRepository, numbersService } = makeService({ events: [{ id: event.id, processing_status: "PENDING_ASSOCIATION" }] });
  await service.markNotOwned(event.id, event);
  assert.equal(incidentsRepository.upsertCalls, 0);
  assert.equal(numbersService.state.incidents.length, 0);
}

console.log("Bloco 12 (números externos / associação manual): todos os cenários passaram.");
