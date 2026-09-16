// Entrypoint Deno da Edge Function. Só faz a "cola" entre a requisição HTTP
// real / Supabase e a lógica pura em handler.js/classification.js (essas sim
// testadas com `node --test`). Não tem lógica de negócio própria de propósito.
//
// Bloco 2 da V3 (classificação/acompanhamento) — esta função nunca altera
// numbers.status, restriction, utilização ou number_campaign_links. Escreve
// em integration_events (sempre) e, quando um CONNECTIVITY_ALERT resolve
// number_id, também em incidents (acompanhamento) e history_events — nunca
// uma ação operacional automática.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handleTelegramWebhook } from "./handler.js";

// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente pelo
// runtime das Edge Functions do Supabase (não precisam ser cadastrados como
// secret manualmente). TELEGRAM_WEBHOOK_SECRET e TELEGRAM_ALLOWED_CHAT_ID são
// secrets próprios desta função — ver instruções de deploy.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const ALLOWED_CHAT_ID = Deno.env.get("TELEGRAM_ALLOWED_CHAT_ID") ?? null;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  // Erro de configuração do ambiente — nunca loga o valor dos secrets, só o fato de faltar.
  console.error("telegram-webhook: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes no ambiente da função.");
}

const supabase = createClient(SUPABASE_URL ?? "", SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

const deps = {
  async findNumberIdsByPhones(phones) {
    if (!phones.length) return [];
    // Match exato contra uma lista curta e determinística de formas equivalentes
    // do mesmo telefone brasileiro (com/sem "55") — nunca LIKE/substring.
    const { data, error } = await supabase.from("numbers").select("id").in("phone", phones);
    if (error) throw error;
    return [...new Set((data ?? []).map((row) => row.id))];
  },
  async findActiveCampaignIdsForNumber(numberId) {
    const { data, error } = await supabase
      .from("number_campaign_links")
      .select("campaign_id")
      .eq("number_id", numberId)
      .is("ended_at", null);
    if (error) throw error;
    return (data ?? []).map((row) => row.campaign_id);
  },
  async getCampaignsByIds(ids) {
    if (!ids.length) return [];
    const { data, error } = await supabase.from("campaigns").select("id,name,client_id").in("id", ids);
    if (error) throw error;
    return (data ?? []).map((row) => ({ id: row.id, name: row.name, clientId: row.client_id }));
  },
  async insertIntegrationEvent(row) {
    const { data, error } = await supabase.from("integration_events").insert(row).select("id").single();
    return { data: data ? { id: data.id } : null, error: error ? { code: error.code, message: error.message } : null };
  },
  async findIntegrationEventBySourceId(source, sourceEventId) {
    const { data, error } = await supabase
      .from("integration_events")
      .select("id,processing_status,event_type,number_id,campaign_id,linked_incident_id")
      .eq("source", source)
      .eq("source_event_id", sourceEventId)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },
  async insertIncident(row) {
    // incidents.id não tem default no banco (mesma convenção do frontend:
    // createIncident() em src/js/models/entities.js) — geramos aqui.
    const { data, error } = await supabase
      .from("incidents")
      .insert({ id: `incident_${crypto.randomUUID()}`, ...row })
      .select("id,title")
      .single();
    return { data: data ? { id: data.id, title: data.title } : null, error: error ? { code: error.code, message: error.message } : null };
  },
  async insertHistoryEvent(row) {
    // history_events.id não tem default no banco (mesma convenção do
    // frontend: createId("history") em src/js/models/helpers.js) — geramos aqui.
    const { error } = await supabase.from("history_events").insert({ id: `history_${crypto.randomUUID()}`, ...row });
    return { error: error ? { message: error.message } : null };
  },
  async linkIncidentToIntegrationEvent(integrationEventId, incidentId) {
    const { error } = await supabase
      .from("integration_events")
      .update({ linked_incident_id: incidentId, processing_status: "LINKED_TO_INCIDENT", processed_at: new Date().toISOString() })
      .eq("id", integrationEventId);
    return { error: error ? { message: error.message } : null };
  },
  async findIncidentByIntegrationEventId(integrationEventId) {
    const { data, error } = await supabase.from("incidents").select("id").eq("integration_event_id", integrationEventId).maybeSingle();
    if (error) throw error;
    return data ?? null;
  },
  async findOpenConnectivityIncident(numberId) {
    // .limit(1) em vez de .maybeSingle(): o índice único parcial da migration
    // 014 garante no banco que nunca há mais de uma linha aqui, mas não
    // depende dessa garantia para não quebrar caso a migration ainda não
    // tenha sido aplicada nesta chamada específica.
    const { data, error } = await supabase
      .from("incidents")
      .select("id")
      .eq("number_id", numberId)
      .eq("classification", "CONNECTIVITY")
      .eq("origin", "TELEGRAM_BOT")
      .eq("status", "OPEN")
      .limit(1);
    if (error) throw error;
    return data?.[0] ?? null;
  },
  async resolveIncident(incidentId) {
    // `.eq("status","OPEN")` na condição do UPDATE torna isto idempotente:
    // se já não estiver OPEN (resolvida por outra tentativa/corrida), 0
    // linhas são afetadas — não é erro, só reporta `data: false` para o
    // chamador saber que NÃO foi esta chamada que resolveu agora.
    const { data, error } = await supabase
      .from("incidents")
      .update({
        status: "RESOLVED",
        resolved_at: new Date().toISOString(),
        resolution_notes: "Resolvida automaticamente pela integração (Telegram) — conectividade normalizada.",
      })
      .eq("id", incidentId)
      .eq("status", "OPEN")
      .select("id");
    if (error) return { data: false, error: { message: error.message } };
    return { data: Boolean(data?.length), error: null };
  },
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), { status: 405 });
  }
  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 400 });
  }

  let result;
  try {
    result = await handleTelegramWebhook({
      getHeader: (name) => request.headers.get(name),
      rawBody,
      env: { webhookSecret: WEBHOOK_SECRET, allowedChatId: ALLOWED_CHAT_ID },
      deps,
    });
  } catch (error) {
    // Nunca retorna detalhe da exceção ao chamador; loga só uma mensagem curta, sem payload/segredo.
    console.error("telegram-webhook: erro inesperado ao processar update.", error instanceof Error ? error.message : String(error));
    result = { status: 500, body: { ok: false } };
  }

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json" },
  });
});
