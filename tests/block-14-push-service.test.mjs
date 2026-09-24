import assert from "node:assert/strict";
import { PushService, urlBase64ToUint8Array } from "../src/js/services/push-service.js";

// ---------------------------------------------------------------------------
// BLOCO 14 — inscrição/desinscrição de notificação push (opt-in pessoal,
// sem RBAC). Nenhuma rede/dado real é usado ou alterado; deps FALSAS.
// ---------------------------------------------------------------------------

function makeRepo(seed = []) {
  const rows = [...seed];
  let n = 0;
  return {
    rows,
    async list() { return rows.map((r) => ({ ...r })); },
    async upsert(record) { const row = { id: `sub-${++n}`, ...record }; rows.push(row); return { ...row }; },
    async update(id, changes) { const row = rows.find((r) => r.id === id); if (!row) throw new Error("push_subscriptions row not found"); Object.assign(row, changes); return { ...row }; },
    async remove(id) { const idx = rows.findIndex((r) => r.id === id); if (idx >= 0) rows.splice(idx, 1); },
  };
}

function makePushManager({ endpoint = "https://push.example/device-1" } = {}) {
  let current = null;
  return {
    async getSubscription() { return current; },
    async subscribe() {
      current = {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: "p256dh-key", auth: "auth-key" } }),
        async unsubscribe() { current = null; return true; },
      };
      return current;
    },
  };
}

function makeService(overrides = {}) {
  return new PushService({
    pushManager: makePushManager(),
    requestPermission: async () => "granted",
    repository: makeRepo(),
    profileId: "profile-1",
    vapidPublicKey: "BNbxGYNMhEtdOOrxJEzSY8VbtxbwkzLQ6E1eO2gQGGZjT9x8x8x8x8x8x8x8x8x8x8x8x8x8x8x8x8x8x8x8x8",
    userAgent: "test-agent",
    ...overrides,
  });
}

// 1) available === false faltando qualquer dependência (modo local/offline, sem SW, etc.)
{
  assert.equal(makeService({ repository: null }).available, false);
  assert.equal(makeService({ pushManager: null }).available, false);
  assert.equal(makeService({ profileId: null }).available, false);
  assert.equal(makeService({ vapidPublicKey: "" }).available, false);
  assert.equal(makeService().available, true);
}

// 2) status(): unsupported sem pushManager; unsubscribed antes; subscribed depois
{
  const service = makeService({ pushManager: null });
  assert.equal(await service.status(), "unsupported");
}
{
  const service = makeService();
  assert.equal(await service.status(), "unsubscribed");
  await service.subscribe();
  assert.equal(await service.status(), "subscribed");
}

// 3) subscribe() grava a inscrição vinculada ao profile certo
{
  const repository = makeRepo();
  const service = makeService({ repository });
  await service.subscribe();
  assert.equal(repository.rows.length, 1);
  assert.equal(repository.rows[0].profile_id, "profile-1");
  assert.equal(repository.rows[0].endpoint, "https://push.example/device-1");
  assert.equal(repository.rows[0].p256dh, "p256dh-key");
  assert.equal(repository.rows[0].auth_key, "auth-key");
}

// 4) permissão negada -> erro amigável e específico (bloqueado no navegador), nunca grava linha
{
  const repository = makeRepo();
  const service = makeService({ repository, requestPermission: async () => "denied" });
  await assert.rejects(() => service.subscribe(), /bloqueadas/i);
  assert.equal(repository.rows.length, 0);
}

// 4b) outro valor não-granted (defensivo) -> mensagem genérica, distinta da de "denied"
{
  const repository = makeRepo();
  const service = makeService({ repository, requestPermission: async () => "default" });
  await assert.rejects(() => service.subscribe(), /[Pp]ermiss.*não concedida/);
  assert.equal(repository.rows.length, 0);
}

// 4c) status() distingue "denied" (bloqueado) de "unsubscribed" (nunca perguntado/pode ativar)
{
  const deniedService = makeService({ getPermission: () => "denied" });
  assert.equal(await deniedService.status(), "denied");
  const defaultService = makeService({ getPermission: () => "default" });
  assert.equal(await defaultService.status(), "unsubscribed");
  const grantedService = makeService({ getPermission: () => "granted" });
  assert.equal(await grantedService.status(), "unsubscribed", "granted sem inscrição ativa ainda é 'unsubscribed' — acionável, não precisa reabrir prompt");
  const noPermissionReaderService = makeService();
  assert.equal(await noPermissionReaderService.status(), "unsubscribed", "sem getPermission injetado, comportamento antigo é preservado");
}

// 5) assinar duas vezes no mesmo aparelho (mesmo endpoint) não duplica — idempotente
{
  const repository = makeRepo();
  const service = makeService({ repository });
  await service.subscribe();
  await service.subscribe();
  assert.equal(repository.rows.length, 1, "reassinar no mesmo aparelho atualiza a linha existente, não duplica");
}

// 6) unsubscribe() remove a inscrição e limpa o PushManager; chamar sem estar inscrito não quebra
{
  const repository = makeRepo();
  const service = makeService({ repository });
  await service.subscribe();
  assert.equal(repository.rows.length, 1);
  await service.unsubscribe();
  assert.equal(repository.rows.length, 0);
  assert.equal(await service.status(), "unsubscribed");
  await service.unsubscribe(); // no-op, não deve lançar
}

// 8) getSquadPreference/setSquadPreference: sem inscrição -> vazio; replace completo funciona;
//    array vazio volta a "notifica de tudo" (nenhuma linha na preferência)
{
  const repository = makeRepo();
  const squadsRepo = makeRepo();
  const service = makeService({ repository, squadsRepository: squadsRepo });

  assert.deepEqual(await service.getSquadPreference(), [], "sem inscrição ativa, preferência é vazia");
  await assert.rejects(() => service.setSquadPreference(["squad1"]), /Ative as notificações/, "não dá pra gravar preferência sem inscrição");

  await service.subscribe();
  assert.deepEqual(await service.getSquadPreference(), [], "logo após assinar, sem preferência salva = notifica de tudo");

  await service.setSquadPreference(["squad1", "squad2"]);
  assert.deepEqual((await service.getSquadPreference()).sort(), ["squad1", "squad2"]);
  assert.equal(squadsRepo.rows.length, 2);
  const subscriptionId = repository.rows[0].id;
  assert.ok(squadsRepo.rows.every((row) => row.subscription_id === subscriptionId));

  // replace completo: nunca acumula lixo de uma escolha anterior
  await service.setSquadPreference(["squad3"]);
  assert.deepEqual(await service.getSquadPreference(), ["squad3"]);
  assert.equal(squadsRepo.rows.length, 1);

  // array vazio -> volta a notificar de tudo (remove a preferência, não deixa "squad vazio" salvo)
  await service.setSquadPreference([]);
  assert.deepEqual(await service.getSquadPreference(), []);
  assert.equal(squadsRepo.rows.length, 0);
}

// 9) squadPreferenceAvailable / getSquadPreference sem squadsRepository (modo local/offline) — nunca quebra
{
  const service = makeService({ squadsRepository: null });
  assert.equal(service.squadPreferenceAvailable, false);
  assert.deepEqual(await service.getSquadPreference(), []);
  await assert.rejects(() => service.setSquadPreference(["squad1"]), /não disponível/);
}

// 10) preferência é isolada por DISPOSITIVO (subscription_id) — nunca mistura com outra inscrição
{
  const repository = makeRepo([{ id: "sub-outro-aparelho", endpoint: "https://push.example/outro", profile_id: "profile-1" }]);
  const squadsRepo = makeRepo([{ id: "pref-1", subscription_id: "sub-outro-aparelho", squad_id: "squad-de-outro-aparelho" }]);
  const service = makeService({ repository, squadsRepository: squadsRepo });
  await service.subscribe(); // endpoint diferente ("device-1"), vira uma nova linha
  assert.deepEqual(await service.getSquadPreference(), [], "preferência de outro dispositivo não vaza pra este");
}

// 7) urlBase64ToUint8Array: round-trip contra um valor base64url conhecido
{
  const bytes = Uint8Array.from([0, 1, 2, 3, 255, 254, 16, 32]);
  const base64url = Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const decoded = urlBase64ToUint8Array(base64url);
  assert.deepEqual([...decoded], [...bytes]);
}

console.log("Bloco 14 (inscrição/desinscrição de push): todos os cenários passaram.");
