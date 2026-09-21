// Entrypoint Deno da Edge Function. Só faz a "cola" entre a requisição HTTP
// real (disparada pelo gatilho `incidents_notify_number_down`, migration
// 017) e a lógica pura em handler.js (essa sim testada com `node --test`).
//
// Nunca confia no corpo recebido: relê a Ocorrência pelo id direto no banco
// antes de decidir se envia notificação. Só leitura de incidents/numbers/
// campaigns/clients/push_subscriptions, e delete em push_subscriptions
// quando uma inscrição expira (404/410) — nunca escreve em nenhuma tabela
// operacional.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { handleSendPushNotifications } from "./handler.js";

// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente pelo
// runtime das Edge Functions do Supabase. VAPID_* e PUSH_TRIGGER_SECRET são
// secrets próprios desta função — ver instruções de deploy no README.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const TRIGGER_SECRET = Deno.env.get("PUSH_TRIGGER_SECRET") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("send-push-notifications: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes no ambiente da função.");
}
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
  console.error("send-push-notifications: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT ausentes no ambiente da função.");
} else {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const supabase = createClient(SUPABASE_URL ?? "", SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false },
});

const deps = {
  async getIncidentContext(incidentId) {
    const { data: incident, error } = await supabase
      .from("incidents")
      .select("id,classification,status,number_id,campaign_id")
      .eq("id", incidentId)
      .maybeSingle();
    if (error) throw error;
    if (!incident) return null;

    const [{ data: number }, campaignAndClient] = await Promise.all([
      incident.number_id
        ? supabase.from("numbers").select("phone,identification").eq("id", incident.number_id).maybeSingle()
        : Promise.resolve({ data: null }),
      incident.campaign_id
        ? supabase.from("campaigns").select("name,client_id").eq("id", incident.campaign_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    let clientName = null;
    if (campaignAndClient.data?.client_id) {
      const { data: client } = await supabase.from("clients").select("name").eq("id", campaignAndClient.data.client_id).maybeSingle();
      clientName = client?.name ?? null;
    }

    return {
      id: incident.id,
      classification: incident.classification,
      status: incident.status,
      numberPhone: number?.phone ?? null,
      numberIdentification: number?.identification ?? null,
      campaignName: campaignAndClient.data?.name ?? null,
      clientName,
    };
  },
  async listSubscriptions() {
    const { data, error } = await supabase.from("push_subscriptions").select("id,endpoint,p256dh,auth_key");
    if (error) throw error;
    return (data ?? []).map((row) => ({ id: row.id, endpoint: row.endpoint, p256dh: row.p256dh, authKey: row.auth_key }));
  },
  async sendPush(subscription, payload) {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.authKey } },
      JSON.stringify(payload),
    );
  },
  async deleteSubscription(id) {
    await supabase.from("push_subscriptions").delete().eq("id", id);
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
    result = await handleSendPushNotifications({
      getHeader: (name) => request.headers.get(name),
      rawBody,
      env: { triggerSecret: TRIGGER_SECRET },
      deps,
    });
  } catch (error) {
    console.error("send-push-notifications: erro inesperado.", error instanceof Error ? error.message : String(error));
    result = { status: 500, body: { ok: false } };
  }

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json" },
  });
});
