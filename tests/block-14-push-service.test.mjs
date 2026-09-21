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

// 4) permissão negada -> erro amigável, nunca grava linha nem quebra o app
{
  const repository = makeRepo();
  const service = makeService({ repository, requestPermission: async () => "denied" });
  await assert.rejects(() => service.subscribe(), /[Pp]ermiss/);
  assert.equal(repository.rows.length, 0);
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

// 7) urlBase64ToUint8Array: round-trip contra um valor base64url conhecido
{
  const bytes = Uint8Array.from([0, 1, 2, 3, 255, 254, 16, 32]);
  const base64url = Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const decoded = urlBase64ToUint8Array(base64url);
  assert.deepEqual([...decoded], [...bytes]);
}

console.log("Bloco 14 (inscrição/desinscrição de push): todos os cenários passaram.");
