// Lógica de envio de push, isolada de Deno/rede para poder ser testada com
// "node --test" usando dependências falsas (deps). O entrypoint real
// (index.ts) só monta `deps` com chamadas reais ao Supabase (service_role)
// e ao serviço de push (web-push/VAPID), e chama handleSendPushNotifications.
//
// Cada inscrição traz o perfil do dono (recipient) e só recebe o que ele pode ver — ver
// isRecipientAllowed (isolamento por Squad 025-027 e acesso de cliente 029/030).
//
// Chamada só por três gatilhos do banco:
// - migration 030 (trigger em public.integration_events), com {externalAlertPhone}, quando cai
//   um chip EXTERNO (de cliente, "não pertence à operação") vinculado a campanha de um cliente —
//   só o CLIENT dono daquela campanha recebe.
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

// Acesso de cliente (029/030): o texto e o link são montados só com a campanha DELE — nunca o
// cliente/campanha registrados na Ocorrência (que podem ser de outro cliente num chip
// compartilhado), e o link abre o Portal do cliente (o cliente não tem a tela de Ocorrências).
export function buildClientNotificationPayload({ phone, identification = null, campaignName = null }, { external = false } = {}) {
  const ident = identification ? ` — ${identification}` : "";
  const context = campaignName ? ` · ${campaignName}` : "";
  return {
    title: external ? "Alerta de queda no seu chip" : "Seu chip caiu",
    body: `${formatPhoneForNotification(phone)}${ident}${context}`,
    url: "./",
  };
}

/**
 * Quem pode receber cada notificação (isolamento por Squad 025-027 + acesso de cliente 029):
 * - MASTER/ADMIN: tudo que é interno (quedas e telefone não cadastrado), nunca o alerta de chip
 *   externo de cliente (não é da operação — mesmo comportamento de antes).
 * - USER/VIEWER: só queda de número do PRÓPRIO Squad (ou de número sem Squad, o "estoque" que
 *   todos os Squads enxergam). Telefone não cadastrado não tem Squad — só MASTER/ADMIN.
 * - CLIENT: só queda de chip que está numa campanha DELE agora, ou alerta de chip externo dele.
 * Inscrição sem dono conhecido (perfil apagado/inativo) nunca recebe nada.
 */
export function isRecipientAllowed(recipient, audience) {
  if (!recipient?.active) return false;
  const level = recipient.accessLevel;
  if (level === "MASTER" || level === "ADMIN") return !audience.clientsOnly;
  if (level === "USER" || level === "VIEWER") {
    if (audience.globalOnly || audience.clientsOnly || !recipient.squadId) return false;
    const squads = audience.numberSquadIds ?? [];
    return squads.length === 0 || squads.includes(recipient.squadId);
  }
  if (level === "CLIENT") return Boolean(recipient.clientId) && (audience.clientCampaigns ?? []).some((item) => item.clientId === recipient.clientId);
  return false;
}

// Preferência de Squad por inscrição (migration 024, push_subscription_squads): array VAZIO
// (ou ausente) em subscriptionSquadIds sempre significa "sem filtro, quer tudo" — mesmo
// comportamento de hoje pra quem nunca configurou nada. numberSquadIds vazio/ausente (número não
// cadastrado — unregisteredPhone nunca tem incidentId nem Número pra reler — ou Número sem Squad)
// também sempre é elegível: não há como filtrar por Squad o que não tem Squad nenhum, e suprimir
// esse alerta pra todo mundo seria pior do que mandar sem filtro.
export function isEligibleForSquads(subscriptionSquadIds, numberSquadIds) {
  if (!subscriptionSquadIds?.length) return true;
  if (!numberSquadIds?.length) return true;
  return subscriptionSquadIds.some((id) => numberSquadIds.includes(id));
}

/**
 * @param {object} params
 * @param {(name: string) => string|null} params.getHeader
 * @param {string} params.rawBody
 * @param {{ triggerSecret: string }} params.env
 * @param {{
 *   getIncidentContext: (id: string) => Promise<null|{id:string,classification:string,status:string,numberPhone:string|null,numberIdentification:string|null,campaignName:string|null,clientName:string|null,numberSquadIds?:string[],clientCampaigns?:Array<{clientId:string,campaignName:string}>}>,
 *   getExternalAlertContext?: (phone: string) => Promise<Array<{clientId:string,campaignName:string}>>,
 *   listSubscriptions: () => Promise<Array<{id:string,endpoint:string,p256dh:string,authKey:string,squadIds?:string[],recipient:{accessLevel:string,squadId:string|null,clientId:string|null,active:boolean}|null}>>,
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
  // Três formatos de chamada: {incidentId} (017), {unregisteredPhone} (022) e {externalAlertPhone}
  // (030: alerta de chip EXTERNO, de cliente, vinculado a uma campanha dele).
  let notification;
  let audience;
  let clientPayloadFor = () => null;
  if (payloadIn?.externalAlertPhone) {
    const links = deps.getExternalAlertContext ? await deps.getExternalAlertContext(payloadIn.externalAlertPhone) : [];
    audience = { clientsOnly: true, clientCampaigns: links };
    clientPayloadFor = (recipient) => {
      const link = links.find((item) => item.clientId === recipient.clientId);
      return buildClientNotificationPayload({ phone: payloadIn.externalAlertPhone, campaignName: link?.campaignName }, { external: true });
    };
  } else if (payloadIn?.unregisteredPhone) {
    notification = buildUnregisteredNumberPayload(payloadIn.unregisteredPhone);
    audience = { globalOnly: true };
  } else {
    const incidentId = payloadIn?.incidentId;
    if (!incidentId) return { status: 400, body: { ok: false, reason: "missing_incident_id" } };

    const incident = await deps.getIncidentContext(incidentId);
    if (!incident) return { status: 404, body: { ok: false, reason: "incident_not_found" } };
    if (!(incident.classification === "CONNECTIVITY" && incident.status === "OPEN")) {
      return { status: 200, body: { ok: true, skipped: true, reason: "not_connectivity_open" } };
    }
    notification = buildNotificationPayload(incident);
    audience = { numberSquadIds: incident.numberSquadIds ?? [], clientCampaigns: incident.clientCampaigns ?? [] };
    clientPayloadFor = (recipient) => {
      const link = audience.clientCampaigns.find((item) => item.clientId === recipient.clientId);
      return buildClientNotificationPayload({ phone: incident.numberPhone, identification: incident.numberIdentification, campaignName: link?.campaignName });
    };
  }

  const allSubscriptions = await deps.listSubscriptions();
  // 1) Quem PODE receber (escopo do perfil — isRecipientAllowed). 2) Preferência de Squad
  // (migration 024), só para a equipe interna: quem escolheu Squads específicos só recebe quando
  // o Número que caiu está em algum deles; sem preferência continua recebendo tudo que pode ver.
  const subscriptions = allSubscriptions.filter((subscription) => isRecipientAllowed(subscription.recipient, audience)
    && (subscription.recipient.accessLevel === "CLIENT" || isEligibleForSquads(subscription.squadIds, audience.numberSquadIds ?? [])));

  let sent = 0;
  let removed = 0;
  for (const subscription of subscriptions) {
    try {
      await deps.sendPush(subscription, subscription.recipient.accessLevel === "CLIENT" ? clientPayloadFor(subscription.recipient) : notification);
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
