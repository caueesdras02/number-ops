import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleSendPushNotifications, isRecipientAllowed, buildClientNotificationPayload } from "../supabase/functions/send-push-notifications/handler.js";

// ---------------------------------------------------------------------------
// BLOCO 36 — push com escopo por perfil: cada inscrição só recebe o que o dono pode ver
// (isolamento por Squad 025-027 + acesso de cliente 029/030). Deps FALSAS, sem rede.
// ---------------------------------------------------------------------------

const ENV = { triggerSecret: "segredo" };
const request = (body) => ({ getHeader: (name) => (name === "x-push-trigger-secret" ? ENV.triggerSecret : null), rawBody: JSON.stringify(body), env: ENV });
const sub = (id, recipient, squadIds = []) => ({ id, endpoint: `https://push/${id}`, p256dh: "p", authKey: "a", squadIds, recipient });
const MASTER = { accessLevel: "MASTER", squadId: null, clientId: null, active: true };
const ADMIN = { accessLevel: "ADMIN", squadId: "sB", clientId: null, active: true };
const USER_A = { accessLevel: "USER", squadId: "sA", clientId: null, active: true };
const VIEWER_B = { accessLevel: "VIEWER", squadId: "sB", clientId: null, active: true };
const USER_SEM_SQUAD = { accessLevel: "USER", squadId: null, clientId: null, active: true };
const ZIG = { accessLevel: "CLIENT", squadId: "sA", clientId: "zig", active: true };
const OUTRO = { accessLevel: "CLIENT", squadId: null, clientId: "outro", active: true };
const INATIVO = { accessLevel: "ADMIN", squadId: null, clientId: null, active: false };

const SUBS = [sub("master", MASTER), sub("admin", ADMIN), sub("userA", USER_A), sub("viewerB", VIEWER_B), sub("semSquad", USER_SEM_SQUAD), sub("zig", ZIG), sub("outro", OUTRO), sub("inativo", INATIVO), sub("orfa", null)];

function makeDeps({ incident = null, externalLinks = [] } = {}) {
  const sentTo = [];
  return {
    sentTo,
    async getIncidentContext() { return incident; },
    async getExternalAlertContext() { return externalLinks; },
    async listSubscriptions() { return SUBS; },
    async sendPush(subscription, payload) { sentTo.push({ id: subscription.id, payload }); },
    async deleteSubscription() {},
  };
}
const ids = (deps) => deps.sentTo.map((item) => item.id).sort();

// 1) Queda de número do Squad A, em campanha da Zig.
{
  const deps = makeDeps({ incident: { id: "i1", classification: "CONNECTIVITY", status: "OPEN", numberPhone: "5511999990001", numberIdentification: "CHIP 1", campaignName: "Live Outro (registrada na ocorrência)", clientName: "Outro Cliente", numberSquadIds: ["sA"], clientCampaigns: [{ clientId: "zig", campaignName: "Live Zig" }] } });
  await handleSendPushNotifications({ ...request({ incidentId: "i1" }), deps });
  assert.deepEqual(ids(deps), ["admin", "master", "userA", "zig"], "MASTER/ADMIN, USER do Squad A e o cliente dono da campanha — nunca Squad B, outro cliente, inativo ou inscrição sem dono");
  const zig = deps.sentTo.find((item) => item.id === "zig").payload;
  assert.equal(zig.title, "Seu chip caiu");
  assert.match(zig.body, /\+55 \(11\) 99999-0001 — CHIP 1 · Live Zig/);
  assert.doesNotMatch(zig.body, /Outro/, "cliente nunca vê cliente/campanha de outro, mesmo que estejam na ocorrência");
  assert.equal(zig.url, "./", "link do cliente abre o portal, não a tela interna de Ocorrências");
  assert.equal(deps.sentTo.find((item) => item.id === "admin").payload.url, "./#incidents/i1", "equipe interna segue indo para a Ocorrência");
}

// 2) Queda de número de estoque (sem Squad) e sem campanha: equipe interna com Squad recebe; cliente não.
{
  const deps = makeDeps({ incident: { id: "i2", classification: "CONNECTIVITY", status: "OPEN", numberPhone: "5511999990002", numberSquadIds: [], clientCampaigns: [] } });
  await handleSendPushNotifications({ ...request({ incidentId: "i2" }), deps });
  assert.deepEqual(ids(deps), ["admin", "master", "userA", "viewerB"]);
}

// 3) Telefone não cadastrado: só MASTER/ADMIN (USER/VIEWER não enxergam a fila de triagem).
{
  const deps = makeDeps();
  await handleSendPushNotifications({ ...request({ unregisteredPhone: "5511988887777" }), deps });
  assert.deepEqual(ids(deps), ["admin", "master"]);
}

// 4) Chip EXTERNO da Zig caiu: só o cliente dono da campanha recebe.
{
  const deps = makeDeps({ externalLinks: [{ clientId: "zig", campaignName: "Live Zig" }] });
  const result = await handleSendPushNotifications({ ...request({ externalAlertPhone: "5511977776666" }), deps });
  assert.equal(result.status, 200);
  assert.deepEqual(ids(deps), ["zig"]);
  assert.equal(deps.sentTo[0].payload.title, "Alerta de queda no seu chip");
  assert.match(deps.sentTo[0].payload.body, /\+55 \(11\) 97777-6666 · Live Zig/);
}
{
  const deps = makeDeps({ externalLinks: [] });
  await handleSendPushNotifications({ ...request({ externalAlertPhone: "5511977776666" }), deps });
  assert.deepEqual(ids(deps), [], "chip externo sem campanha de cliente ativa não notifica ninguém");
}

// 5) Preferência de Squad (024) continua valendo para a equipe interna, nunca para o cliente.
{
  const subs = [sub("admin-pref-sul", MASTER, ["sSul"]), sub("zig-com-pref", ZIG, ["sSul"])];
  const deps = makeDeps({ incident: { id: "i3", classification: "CONNECTIVITY", status: "OPEN", numberPhone: "5511999990003", numberSquadIds: ["sA"], clientCampaigns: [{ clientId: "zig", campaignName: "Live Zig" }] } });
  deps.listSubscriptions = async () => subs;
  await handleSendPushNotifications({ ...request({ incidentId: "i3" }), deps });
  assert.deepEqual(ids(deps), ["zig-com-pref"]);
}

// 6) Regras isoladas.
assert.equal(isRecipientAllowed(null, {}), false);
assert.equal(isRecipientAllowed({ accessLevel: "CLIENT", clientId: null, active: true }, { clientCampaigns: [{ clientId: "zig" }] }), false, "cliente sem cliente vinculado nunca recebe");
assert.equal(isRecipientAllowed({ accessLevel: "OUTRO", active: true }, {}), false, "nível desconhecido nunca recebe");
assert.equal(isRecipientAllowed(MASTER, { clientsOnly: true }), false);
assert.equal(buildClientNotificationPayload({ phone: "" }).url, "./");

// 7) Migration 030 + rollback (texto).
const m030 = await readFile(new URL("../supabase/030_client_push_notifications.sql", import.meta.url), "utf8");
const r030 = await readFile(new URL("../supabase/rollback/rollback_030_client_push.sql", import.meta.url), "utf8");
assert.match(m030, /ORDEM OBRIGATÓRIA: publique ANTES a nova versão da Edge Function/);
assert.match(m030, /alter policy push_subscriptions_own_insert on public\.push_subscriptions\s+with check \(profile_id = auth\.uid\(\)\);/);
assert.match(m030, /new\.processing_status = 'IGNORED_NOT_OWNED'/);
assert.match(m030, /l\.phone_normalized = new\.phone_normalized and l\.ended_at is null/);
assert.match(m030, /interval '30 minutes'/, "mesmo anti-spam da 022");
assert.match(m030, /exception when others then/, "notificação nunca impede a gravação do evento");
assert.match(m030, /jsonb_build_object\('externalAlertPhone', new\.phone_normalized\)/);
assert.match(m030, /drop trigger if exists integration_events_notify_external_alert/);
assert.doesNotMatch(m030, /\btruncate\b|drop table|delete from/i);
assert.match(r030, /drop function if exists public\.notify_external_number_alert\(\)/);
assert.match(r030, /<> 'CLIENT'/, "rollback volta a bloquear a inscrição de cliente");

// 8) Edge Function real (index.ts) busca o perfil de cada inscrição e as campanhas do chip.
const index = await readFile(new URL("../supabase/functions/send-push-notifications/index.ts", import.meta.url), "utf8");
assert.match(index, /select\("id,access_level,squad_id,client_id,status"\)/);
assert.match(index, /select\("id,endpoint,p256dh,auth_key,profile_id"\)/);
assert.match(index, /activeClientCampaigns\("number_campaign_links", "number_id", incident\.number_id\)/);
assert.match(index, /activeClientCampaigns\("external_number_campaign_links", "phone_normalized", phone\)/);

console.log("Bloco 36 (push com escopo por perfil e por cliente): todos os cenários passaram.");
