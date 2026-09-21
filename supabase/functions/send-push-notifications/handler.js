// Lógica de envio de push, isolada de Deno/rede para poder ser testada com
// "node --test" usando dependências falsas (deps). O entrypoint real
// (index.ts) só monta `deps` com chamadas reais ao Supabase (service_role)
// e ao serviço de push (web-push/VAPID), e chama handleSendPushNotifications.
//
// Chamada só pelo gatilho do banco (migration 017, trigger em
// public.incidents) — nunca confia no corpo recebido: sempre relê a
// Ocorrência pelo id antes de decidir se notifica, e só notifica
// classification=CONNECTIVITY + status=OPEN.
const SECRET_HEADER = "x-push-trigger-secret";

function formatPhoneForNotification(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 13) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.length === 12) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  return phone || "Número não identificado";
}

export function buildNotificationPayload(incident) {
  const identification = incident.numberIdentification ? ` — ${incident.numberIdentification}` : "";
  const context = incident.clientName ? ` · ${incident.clientName}${incident.campaignName ? ` / ${incident.campaignName}` : ""}` : "";
  return {
    title: "Número caiu",
    body: `${formatPhoneForNotification(incident.numberPhone)}${identification}${context}`,
    url: `./#incidents/${incident.id}`,
  };
}

/**
 * @param {object} params
 * @param {(name: string) => string|null} params.getHeader
 * @param {string} params.rawBody
 * @param {{ triggerSecret: string }} params.env
 * @param {{
 *   getIncidentContext: (id: string) => Promise<null|{id:string,classification:string,status:string,numberPhone:string|null,numberIdentification:string|null,campaignName:string|null,clientName:string|null}>,
 *   listSubscriptions: () => Promise<Array<{id:string,endpoint:string,p256dh:string,authKey:string}>>,
 *   sendPush: (subscription: object, payload: object) => Promise<void>,
 *   deleteSubscription: (id: string) => Promise<void>,
 * }} params.deps
 */
export async function handleSendPushNotifications({ getHeader, rawBody, env, deps }) {
  const providedSecret = getHeader(SECRET_HEADER);
  if (!env.triggerSecret || !providedSecret || providedSecret !== env.triggerSecret) {
    return { status: 401, body: { ok: false } };
  }

  let payloadIn;
  try {
    payloadIn = JSON.parse(rawBody || "{}");
  } catch {
    return { status: 400, body: { ok: false, reason: "invalid_json" } };
  }
  const incidentId = payloadIn?.incidentId;
  if (!incidentId) return { status: 400, body: { ok: false, reason: "missing_incident_id" } };

  const incident = await deps.getIncidentContext(incidentId);
  if (!incident) return { status: 404, body: { ok: false, reason: "incident_not_found" } };
  if (!(incident.classification === "CONNECTIVITY" && incident.status === "OPEN")) {
    return { status: 200, body: { ok: true, skipped: true, reason: "not_connectivity_open" } };
  }

  const subscriptions = await deps.listSubscriptions();
  const notification = buildNotificationPayload(incident);

  let sent = 0;
  let removed = 0;
  for (const subscription of subscriptions) {
    try {
      await deps.sendPush(subscription, notification);
      sent++;
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await deps.deleteSubscription(subscription.id);
        removed++;
      }
      // Outros erros (rede, 5xx do serviço de push) não removem a inscrição — tenta de novo na próxima queda.
    }
  }

  return { status: 200, body: { ok: true, total: subscriptions.length, sent, removed } };
}
