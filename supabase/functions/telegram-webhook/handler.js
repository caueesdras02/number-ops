// Lógica de processamento do webhook do Telegram, isolada de Deno/rede para
// poder ser testada com "node --test" usando dependências falsas (deps).
// O entrypoint real (index.ts) só monta `deps` com chamadas reais ao
// Supabase (service_role) e chama handleTelegramWebhook.
//
// IMPORTANTE: esta função NUNCA altera numbers.status, restriction,
// utilização ou number_campaign_links. As únicas escritas são: insert em
// integration_events e, via classification.js, criação/reuso ou resolução
// de um acompanhamento (incidents) + history_events — nunca uma alteração
// operacional automática.
import { parseAlertText } from "./parse-alert.js";
import { brazilianPhoneCandidates } from "./phone.js";
import { processConnectivityClassification } from "./classification.js";

const MAX_BODY_BYTES = 65536; // limite defensivo contra payload anormalmente grande
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

function byteLength(text) {
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(text).length : Buffer.byteLength(text, "utf8");
}

function normalizeLabel(value) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/**
 * @param {object} params
 * @param {(name: string) => string|null} params.getHeader
 * @param {string} params.rawBody
 * @param {{ webhookSecret: string, allowedChatId: string|null }} params.env
 * @param {{
 *   findNumberIdsByPhones: (phones: string[]) => Promise<string[]>,
 *   findActiveCampaignIdsForNumber: (numberId: string) => Promise<string[]>,
 *   getCampaignsByIds: (ids: string[]) => Promise<Array<{id:string,name:string,clientId:string|null}>>,
 *   insertIntegrationEvent: (row: object) => Promise<{ data: {id:string}|null, error: null|{code?:string,message:string} }>,
 *   findIntegrationEventBySourceId: (source: string, sourceEventId: string) => Promise<object|null>,
 *   insertIncident: (row: object) => Promise<{ data: {id:string,title:string}|null, error: null|{code?:string,message:string} }>,
 *   insertHistoryEvent: (row: object) => Promise<{ error: null|{message:string} }>,
 *   linkIncidentToIntegrationEvent: (integrationEventId: string, incidentId: string) => Promise<{ error: null|{message:string} }>,
 *   findIncidentByIntegrationEventId: (integrationEventId: string) => Promise<{id:string}|null>,
 *   findOpenConnectivityIncident: (numberId: string) => Promise<{id:string}|null>,
 *   resolveIncident: (incidentId: string) => Promise<{ data: boolean, error: null|{message:string} }>,
 * }} params.deps
 */
export async function handleTelegramWebhook({ getHeader, rawBody, env, deps }) {
  const providedSecret = getHeader(SECRET_HEADER);
  if (!env.webhookSecret || !providedSecret || providedSecret !== env.webhookSecret) {
    return { status: 401, body: { ok: false } };
  }

  if (typeof rawBody !== "string" || rawBody.length === 0) {
    return { status: 400, body: { ok: false } };
  }
  if (byteLength(rawBody) > MAX_BODY_BYTES) {
    return { status: 413, body: { ok: false } };
  }

  let update;
  try {
    update = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false } };
  }
  if (!update || typeof update !== "object" || update.update_id === undefined || update.update_id === null) {
    return { status: 400, body: { ok: false } };
  }

  const message = update.message ?? update.channel_post ?? update.edited_message ?? null;
  const chatId = message?.chat?.id;

  // Chat não autorizado: ignora com segurança, sem persistir nada e sem
  // revelar ao chamador se o motivo foi o chat ou a ausência de mensagem.
  if (env.allowedChatId && String(chatId) !== String(env.allowedChatId)) {
    return { status: 200, body: { ok: true } };
  }
  if (!message) {
    return { status: 200, body: { ok: true } };
  }

  const text = typeof message.text === "string" ? message.text : (typeof message.caption === "string" ? message.caption : "");
  const parsed = parseAlertText(text);

  let eventType = "UNKNOWN";
  let processingStatus = "IGNORED";
  let errorMessage = null;
  let phoneNormalized = null;
  let numberId = null;
  let campaignId = null;
  let clientId = null;
  let matchedConfidence = null;
  const metadata = {};

  if (parsed.matchesAlertShape) {
    // HOJE: todo alerta reconhecido é sempre "CONNECTIVITY_ALERT" (desconexão).
    // Ainda não existe evidência de qual texto real o bot de infraestrutura
    // envia para uma recuperação/normalização — por isso não há aqui nenhuma
    // tentativa de detectar isso a partir de `parsed.status` (não inventamos
    // palavra-chave). Quando esse texto for conhecido, este é o único ponto
    // que precisa mudar: reconhecer o valor real de `parsed.status` e, nesse
    // caso, atribuir eventType = "CONNECTIVITY_RESTORED" em vez de
    // "CONNECTIVITY_ALERT" — classification.js já sabe processar os dois.
    eventType = "CONNECTIVITY_ALERT";
    metadata.status = parsed.status;
    metadata.empresa = parsed.empresa;
    metadata.liveshop = parsed.liveshop;
    metadata.contaCliente = parsed.contaCliente;

    if (!parsed.phoneNormalized) {
      processingStatus = "ERROR";
      errorMessage = "Alerta reconhecido, mas não foi possível extrair um telefone válido.";
    } else {
      phoneNormalized = parsed.phoneNormalized;
      try {
        // Telefone brasileiro pode chegar no alerta com ou sem "55" (código do país).
        // numbers.phone é sempre armazenado com "55" — testamos as formas exatas
        // equivalentes (nunca LIKE/substring) e nunca alteramos numbers.phone.
        const candidates = brazilianPhoneCandidates(phoneNormalized);
        const numberIds = await deps.findNumberIdsByPhones(candidates);
        if (numberIds.length === 1) {
          numberId = numberIds[0];
          matchedConfidence = 1;
          processingStatus = "MATCHED";

          const activeCampaignIds = await deps.findActiveCampaignIdsForNumber(numberId);
          if (activeCampaignIds.length === 1) {
            campaignId = activeCampaignIds[0];
            const [campaign] = await deps.getCampaignsByIds([campaignId]);
            clientId = campaign?.clientId ?? null;
            metadata.campaignMatch = "single_active_link";
          } else if (activeCampaignIds.length > 1) {
            const candidates = await deps.getCampaignsByIds(activeCampaignIds);
            const targetLabel = parsed.liveshop ? normalizeLabel(parsed.liveshop) : null;
            const byName = targetLabel ? candidates.filter((item) => normalizeLabel(item.name) === targetLabel) : [];
            if (byName.length === 1) {
              campaignId = byName[0].id;
              clientId = byName[0].clientId ?? null;
              metadata.campaignMatch = "matched_by_name";
            } else {
              metadata.campaignMatch = "ambiguous";
            }
          } else {
            metadata.campaignMatch = "none";
          }
        } else {
          // 0 (nenhum candidato bateu) ou >1 (mais de uma forma do telefone bateu com
          // registros DISTINTOS — não deveria ocorrer, `numbers.phone` é único por linha;
          // tratado aqui como "sem match confiável", nunca escolhendo um dos dois arbitrariamente).
          matchedConfidence = 0;
          processingStatus = "PENDING_ASSOCIATION";
        }
      } catch (error) {
        processingStatus = "ERROR";
        errorMessage = "Falha ao consultar números para associação.";
      }
    }
  }

  const row = {
    source: "TELEGRAM",
    source_event_id: String(update.update_id),
    event_type: eventType,
    raw_payload: update,
    metadata,
    phone_normalized: phoneNormalized,
    number_id: numberId,
    campaign_id: campaignId,
    client_id: clientId,
    matched_confidence: matchedConfidence,
    processing_status: processingStatus,
    error_message: errorMessage,
    processed_at: new Date().toISOString(),
  };

  const { data, error } = await deps.insertIntegrationEvent(row);
  if (error) {
    if (error.code === "23505") {
      // update_id já processado (reenvio idempotente do Telegram) — não é erro.
      // Pode ser um reenvio "puro" (já tudo concluído) ou a recuperação de uma
      // falha parcial anterior (evento salvo, mas acompanhamento não criado/
      // linkado ainda) — processConnectivityClassification cobre os dois
      // casos (criação/reuso OU resolução) sem duplicar nada.
      try {
        const existing = await deps.findIntegrationEventBySourceId(row.source, row.source_event_id);
        if (existing) await processConnectivityClassification(deps, existing);
      } catch {
        // Não deixa uma falha na recuperação do acompanhamento mascarar a
        // resposta idempotente do evento em si; o próximo reenvio tenta de novo.
      }
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    return { status: 500, body: { ok: false } };
  }

  if (data?.id) {
    try {
      await processConnectivityClassification(deps, { ...row, id: data.id, linked_incident_id: null });
    } catch {
      // O integration_event já está salvo de forma consistente (MATCHED, sem
      // link ainda) — devolve 500 para o Telegram tentar de novo mais tarde;
      // o reenvio cai no ramo de duplicidade acima e completa o acompanhamento.
      return { status: 500, body: { ok: false } };
    }
  }

  return { status: 200, body: { ok: true } };
}
