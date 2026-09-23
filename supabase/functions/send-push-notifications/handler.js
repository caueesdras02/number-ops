// Lógica de envio de push, isolada de Deno/rede para poder ser testada com
// "node --test" usando dependências falsas (deps). O entrypoint real
// (index.ts) só monta `deps` com chamadas reais ao Supabase (service_role)
// e ao serviço de push (web-push/VAPID), e chama handleSendPushNotifications.
//
// Chamada só por dois gatilhos do banco:
// - migration 017 (trigger em public.incidents), com {incidentId} — nunca confia no corpo
//   recebido: sempre relê a Ocorrência pelo id antes de decidir, e só notifica
//   classification=CONNECTIVITY + status=OPEN.
// - migration 022 (trigger em public.integration_events), com {unregisteredPhone}, quando o
//   telefone que caiu nem está cadastrado em `numbers` — nesse caso não existe Ocorrência
//   nenhuma pra reler (incidents.number_id é NOT NULL), então o texto é montado direto a
//   partir do telefone recebido.
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

// Telefone caiu mas não está cadastrado em `numbers` — nunca vira Ocorrência (incidents.number_id
// é NOT NULL/FK), então não existe incidentId nenhum pra reler aqui. O texto já avisa isso de cara
// (pedido explícito: "já informa de cara que não está registrado"), e o link manda direto pra
// Central do Bot, onde a associação pendente pode ser resolvida.
export function buildUnregisteredNumberPayload(phone) {
  return {
    title: "Número caiu — não registrado",
    body: `${formatPhoneForNotification(phone)} não está cadastrado no Number Ops. Associe ou marque como não pertencente à operação.`,
    url: "./#bot",
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

  // Dois formatos de chamada: {incidentId} (queda de número JÁ cadastrado — gatilho
  // notify_number_down, migration 017) ou {unregisteredPhone} (queda de telefone que não existe
  // em `numbers`, então nunca vira Ocorrência — gatilho notify_unregistered_number, migration
  // 022). Nunca os dois ao mesmo tempo; unregisteredPhone tem prioridade só porque é o caminho
  // mais novo e mais restrito (não depende de reler nada do banco).
  let notification;
  if (payloadIn?.unregisteredPhone) {
    notification = buildUnregisteredNumberPayload(payloadIn.unregisteredPhone);
  } else {
    const incidentId = payloadIn?.incidentId;
    if (!incidentId) return { status: 400, body: { ok: false, reason: "missing_incident_id" } };

    const incident = await deps.getIncidentContext(incidentId);
    if (!incident) return { status: 404, body: { ok: false, reason: "incident_not_found" } };
    if (!(incident.classification === "CONNECTIVITY" && incident.status === "OPEN")) {
      return { status: 200, body: { ok: true, skipped: true, reason: "not_connectivity_open" } };
    }
    notification = buildNotificationPayload(incident);
  }

  const subscriptions = await deps.listSubscriptions();

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
