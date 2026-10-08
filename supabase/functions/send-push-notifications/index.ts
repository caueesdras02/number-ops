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

// Vínculos ativos (ended_at nulo) de `table` filtrados por `column = value`, resolvidos para
// { clientId, campaignName } — usado tanto para chip nosso (number_campaign_links) quanto para
// chip externo de cliente (external_number_campaign_links).
async function activeClientCampaigns(table, column, value) {
  const { data: links, error } = await supabase.from(table).select("campaign_id").eq(column, value).is("ended_at", null);
  if (error) throw error;
  const campaignIds = [...new Set((links ?? []).map((row) => row.campaign_id))];
  if (!campaignIds.length) return [];
  const { data: campaigns, error: campaignsError } = await supabase.from("campaigns").select("id,name,client_id").in("id", campaignIds);
  if (campaignsError) throw campaignsError;
  return (campaigns ?? []).filter((row) => row.client_id).map((row) => ({ clientId: row.client_id, campaignName: row.name }));
}

const deps = {
  async getIncidentContext(incidentId) {
    const { data: incident, error } = await supabase
      .from("incidents")
      .select("id,classification,status,number_id,campaign_id")
      .eq("id", incidentId)
      .maybeSingle();
    if (error) throw error;
    if (!incident) return null;

    const [{ data: number }, campaignAndClient, { data: numberSquads }] = await Promise.all([
      incident.number_id
        ? supabase.from("numbers").select("phone,identification").eq("id", incident.number_id).maybeSingle()
        : Promise.resolve({ data: null }),
      incident.campaign_id
        ? supabase.from("campaigns").select("name,client_id").eq("id", incident.campaign_id).maybeSingle()
        : Promise.resolve({ data: null }),
      // Squad(s) do NÚMERO que caiu (não da campanha) — pra filtrar por preferência de Squad
      // (migration 024). Um número pode estar em mais de um Squad; qualquer um deles é elegível.
      incident.number_id
        ? supabase.from("number_squads").select("squad_id").eq("number_id", incident.number_id)
        : Promise.resolve({ data: [] }),
    ]);

    let clientName = null;
    if (campaignAndClient.data?.client_id) {
      const { data: client } = await supabase.from("clients").select("name").eq("id", campaignAndClient.data.client_id).maybeSingle();
      clientName = client?.name ?? null;
    }

    // Campanhas em que o número está AGORA (acesso de cliente, 029/030): define quais clientes
    // recebem a queda e qual campanha aparece no texto de cada um.
    const clientCampaigns = incident.number_id ? await activeClientCampaigns("number_campaign_links", "number_id", incident.number_id) : [];

    return {
      id: incident.id,
      classification: incident.classification,
      status: incident.status,
      numberPhone: number?.phone ?? null,
      numberIdentification: number?.identification ?? null,
      campaignName: campaignAndClient.data?.name ?? null,
      clientName,
      numberSquadIds: (numberSquads ?? []).map((row) => row.squad_id),
      clientCampaigns,
    };
  },
  // Chip EXTERNO (de cliente) que caiu: campanhas ativas às quais ele está vinculado (023).
  async getExternalAlertContext(phone) {
    return activeClientCampaigns("external_number_campaign_links", "phone_normalized", phone);
  },
  async listSubscriptions() {
    const [{ data: subscriptions, error }, { data: preferences }] = await Promise.all([
      supabase.from("push_subscriptions").select("id,endpoint,p256dh,auth_key,profile_id"),
      supabase.from("push_subscription_squads").select("subscription_id,squad_id"),
    ]);
    if (error) throw error;
    const squadIdsBySubscription = new Map();
    for (const row of preferences ?? []) {
      if (!squadIdsBySubscription.has(row.subscription_id)) squadIdsBySubscription.set(row.subscription_id, []);
      squadIdsBySubscription.get(row.subscription_id).push(row.squad_id);
    }
    // Perfil do dono de cada inscrição — o handler só envia o que esse perfil pode ver.
    const profileIds = [...new Set((subscriptions ?? []).map((row) => row.profile_id))];
    const { data: profiles, error: profilesError } = profileIds.length
      ? await supabase.from("profiles").select("id,access_level,squad_id,client_id,status").in("id", profileIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    return (subscriptions ?? []).map((row) => {
      const profile = profileById.get(row.profile_id);
      return {
        id: row.id, endpoint: row.endpoint, p256dh: row.p256dh, authKey: row.auth_key,
        squadIds: squadIdsBySubscription.get(row.id) ?? [],
        recipient: profile ? { accessLevel: profile.access_level, squadId: profile.squad_id, clientId: profile.client_id ?? null, active: profile.status === "ACTIVE" } : null,
      };
    });
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
