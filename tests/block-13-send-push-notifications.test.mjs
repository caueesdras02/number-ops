import assert from "node:assert/strict";
import { handleSendPushNotifications, buildNotificationPayload } from "../supabase/functions/send-push-notifications/handler.js";

// ---------------------------------------------------------------------------
// BLOCO 13 — envio de push quando uma Ocorrência de conectividade abre.
// Nenhuma rede/dado real é usado ou alterado; deps FALSAS em memória.
// ---------------------------------------------------------------------------

const ENV = { triggerSecret: "test-push-secret-123" };

function makeDeps({ incidents = {}, subscriptions = [], sendResult = {} } = {}) {
  const deletedIds = [];
  const sentTo = [];
  return {
    deletedIds, sentTo,
    async getIncidentContext(id) { return incidents[id] ?? null; },
    async listSubscriptions() { return subscriptions; },
    async sendPush(subscription, payload) {
      sentTo.push({ subscriptionId: subscription.id, payload });
      const failure = sendResult[subscription.id];
      if (failure) { const error = new Error("push failed"); error.statusCode = failure; throw error; }
    },
    async deleteSubscription(id) { deletedIds.push(id); },
  };
}

function makeRequest({ header = ENV.triggerSecret, body }) {
  return { getHeader: (name) => (name === "x-push-trigger-secret" ? header : null), rawBody: JSON.stringify(body ?? {}), env: ENV };
}

// 1) header ausente/errado -> 401, nunca chega a olhar o corpo
{
  const deps = makeDeps();
  const result = await handleSendPushNotifications({ ...makeRequest({ header: "errado", body: { incidentId: "i1" } }), deps });
  assert.equal(result.status, 401);
}

// 2) sem incidentId -> 400
{
  const deps = makeDeps();
  const result = await handleSendPushNotifications({ ...makeRequest({ body: {} }), deps });
  assert.equal(result.status, 400);
}

// 3) ocorrência não encontrada -> 404, nunca envia
{
  const deps = makeDeps({ incidents: {} });
  const result = await handleSendPushNotifications({ ...makeRequest({ body: { incidentId: "ghost" } }), deps });
  assert.equal(result.status, 404);
  assert.equal(deps.sentTo.length, 0);
}

// 4) ocorrência existe mas NÃO é CONNECTIVITY/OPEN -> não envia (mesmo que o corpo minta outra coisa)
{
  const deps = makeDeps({
    incidents: { i1: { id: "i1", classification: "CONFIRMED_RESTRICTION", status: "OPEN", numberPhone: "5511999999999" } },
    subscriptions: [{ id: "sub1", endpoint: "https://push/1", p256dh: "p", authKey: "a" }],
  });
  const result = await handleSendPushNotifications({ ...makeRequest({ body: { incidentId: "i1", title: "forjado", body: "forjado" } }), deps });
  assert.equal(result.body.skipped, true);
  assert.equal(deps.sentTo.length, 0, "classificação diferente de CONNECTIVITY nunca dispara push");
}
{
  const deps = makeDeps({
    incidents: { i1: { id: "i1", classification: "CONNECTIVITY", status: "RESOLVED", numberPhone: "5511999999999" } },
    subscriptions: [{ id: "sub1", endpoint: "https://push/1", p256dh: "p", authKey: "a" }],
  });
  const result = await handleSendPushNotifications({ ...makeRequest({ body: { incidentId: "i1" } }), deps });
  assert.equal(result.body.skipped, true);
  assert.equal(deps.sentTo.length, 0, "status RESOLVED nunca dispara push");
}

// 5) CONNECTIVITY/OPEN -> envia pra todas as inscrições, com texto derivado SEMPRE da releitura (nunca do payload de fora)
{
  const deps = makeDeps({
    incidents: { i1: { id: "i1", classification: "CONNECTIVITY", status: "OPEN", numberPhone: "5511999999999", numberIdentification: "CHIP 4", campaignName: "Live do Lider", clientName: "Embaixador Móveis" } },
    subscriptions: [
      { id: "sub1", endpoint: "https://push/1", p256dh: "p1", authKey: "a1" },
      { id: "sub2", endpoint: "https://push/2", p256dh: "p2", authKey: "a2" },
    ],
  });
  const result = await handleSendPushNotifications({ ...makeRequest({ body: { incidentId: "i1", title: "TENTATIVA DE FORJAR TÍTULO", body: "TENTATIVA DE FORJAR CORPO" } }), deps });
  assert.equal(result.status, 200);
  assert.equal(result.body.sent, 2);
  assert.equal(deps.sentTo.length, 2);
  assert.equal(deps.sentTo[0].payload.title, "Número caiu");
  assert.match(deps.sentTo[0].payload.body, /Embaixador Móveis/);
  assert.match(deps.sentTo[0].payload.body, /Live do Lider/);
  assert.doesNotMatch(deps.sentTo[0].payload.body, /FORJAR/, "nunca usa texto vindo do corpo da requisição");
}

// 6) inscrição expirada (404/410) é removida; erro de outra natureza (5xx) não remove
{
  const deps = makeDeps({
    incidents: { i1: { id: "i1", classification: "CONNECTIVITY", status: "OPEN", numberPhone: "5511999999999" } },
    subscriptions: [
      { id: "expired-404", endpoint: "https://push/1", p256dh: "p", authKey: "a" },
      { id: "expired-410", endpoint: "https://push/2", p256dh: "p", authKey: "a" },
      { id: "flaky-500", endpoint: "https://push/3", p256dh: "p", authKey: "a" },
      { id: "ok", endpoint: "https://push/4", p256dh: "p", authKey: "a" },
    ],
    sendResult: { "expired-404": 404, "expired-410": 410, "flaky-500": 500 },
  });
  const result = await handleSendPushNotifications({ ...makeRequest({ body: { incidentId: "i1" } }), deps });
  assert.equal(result.body.total, 4);
  assert.equal(result.body.sent, 1, "só a inscrição \"ok\" conta como enviada");
  assert.equal(result.body.removed, 2);
  assert.deepEqual(deps.deletedIds.sort(), ["expired-404", "expired-410"]);
  assert.ok(!deps.deletedIds.includes("flaky-500"), "erro 5xx não remove a inscrição — tenta de novo na próxima queda");
}

// 7) buildNotificationPayload: identificação/cliente/campanha ausentes não quebram o texto
{
  const payload = buildNotificationPayload({ id: "i1", numberPhone: "5511999999999" });
  assert.equal(payload.title, "Número caiu");
  assert.match(payload.body, /\+55 \(11\) 99999-9999/);
  assert.equal(payload.url, "./#incidents/i1");
}

console.log("Bloco 13 (envio de push / número caiu): todos os cenários passaram.");
