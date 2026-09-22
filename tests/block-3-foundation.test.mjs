import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AuthService } from "../src/js/services/auth-service.js";
import { SupabaseRepository, createSupabaseRepositories } from "../src/js/repositories/supabase-repository.js";
import { createConfiguredSupabaseClient } from "../src/js/infra/supabase-client.js";
import { ProfilesService } from "../src/js/services/profiles-service.js";
import { renderLogin } from "../src/js/ui/auth-view.js";

const loginHtml = renderLogin();
assert.match(loginHtml, /Acesso seguro/);
assert.match(loginHtml, /Bem-vindo ao Number Ops/);
assert.match(loginHtml, /Centralize e acompanhe a operação dos números em um só lugar\./);

const calls = [];
const configuredClient = await createConfiguredSupabaseClient(async () => ({ createClient: (url, key, options) => ({ url, key, options }) }));
assert.equal(configuredClient.url, "https://puidjdezfyxjornmdzvp.supabase.co");
assert.match(configuredClient.key, /^sb_publishable_/);
assert.equal(configuredClient.options.auth.persistSession, true);
const authRepository = {
  getSession: async () => ({ user: { id: "user-1" } }),
  getProfile: async () => ({ id: "user-1", status: "ACTIVE", access_level: "USER" }),
  signIn: async (credentials) => { calls.push(credentials); return { user: { id: "user-1" }, session: { access_token: "test-only" } }; },
  signUp: async (payload) => { calls.push(payload); return { user: { id: "user-2" } }; },
  signOut: async () => { calls.push("sign-out"); },
  checkSignupAuthorization: async (email) => email === "pessoa@example.com",
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
};
const auth = new AuthService(authRepository);
assert.equal((await auth.getActiveSession()).profile.access_level, "USER");
assert.equal(await auth.isEmailAuthorized("pessoa@example.com"), true);
assert.equal(await auth.isEmailAuthorized("outra@example.com"), false);
await auth.register({ name: "Pessoa", email: "pessoa@example.com", password: "12345678", jobTitle: "ANALYST" });
assert.equal(calls.at(-1).options.data.access_level, undefined, "self-registration não envia nível Admin");
assert.equal(calls.at(-1).options.data.squad_id, undefined, "self-registration não envia squad — quem define é a autorização prévia (019)");

const inactive = new AuthService({ ...authRepository, getProfile: async () => ({ status: "INACTIVE" }) });
await assert.rejects(() => inactive.getActiveSession(), /inativo/);

const builder = {
  select() { return this; }, eq() { return this; },
  async maybeSingle() { return { data: { id: "n1" }, error: null }; },
  async single() { return { data: { id: "n1" }, error: null }; },
  upsert() { return this; }, delete() { return this; },
  then(resolve) { resolve({ data: [], error: null }); },
};
const client = { from: (table) => { calls.push(table); return Object.create(builder); } };
assert.ok(createSupabaseRepositories(client).campaigns instanceof SupabaseRepository);
assert.deepEqual(await createSupabaseRepositories(client).numbers.get("n1"), { id: "n1" });

let savedProfile = null;
const profileRoster = [
  { id: "master-1", name: "Cauê", email: "caue@example.com", access_level: "MASTER", status: "ACTIVE", job_title: "ANALYST", squad_id: null },
  { id: "user-2", name: "Pessoa", email: "pessoa@example.com", access_level: "USER", status: "ACTIVE", job_title: "ANALYST", squad_id: "s1" },
];
const profiles = new ProfilesService(
  { list: async () => profileRoster.map((p) => ({ ...p })), update: async (id, value) => { savedProfile = { id, ...value }; return savedProfile; } },
  { list: async () => [{ id: "s1", name: "Squad 1" }] },
);
// ADMIN pode editar dados, mas NÃO o nível de acesso
await profiles.update("user-2", { name: "Pessoa Nova", job_title: "ANALYST", squad_id: "s1", status: "ACTIVE" }, { id: "admin-1", access_level: "ADMIN" });
assert.equal(savedProfile.name, "Pessoa Nova");
assert.equal(savedProfile.access_level, "USER");
await assert.rejects(() => profiles.update("user-2", { name: "Pessoa", job_title: "ANALYST", squad_id: "s1", status: "ACTIVE", access_level: "VIEWER" }, { id: "admin-1", access_level: "ADMIN" }), /Somente MASTER/);
// MASTER promove/rebaixa
await profiles.update("user-2", { name: "Pessoa", job_title: "ANALYST", squad_id: "s1", status: "ACTIVE", access_level: "ADMIN" }, { id: "master-1", access_level: "MASTER" });
assert.equal(savedProfile.access_level, "ADMIN");
// último MASTER protegido
await assert.rejects(() => profiles.update("master-1", { name: "Cauê", job_title: "ANALYST", squad_id: "", status: "ACTIVE", access_level: "ADMIN" }, { id: "master-1", access_level: "MASTER" }), /próprio acesso|MASTER ativo/);
// VIEWER não altera nada
await assert.rejects(() => profiles.update("user-2", { name: "Pessoa", job_title: "ANALYST", status: "ACTIVE" }, { id: "viewer", access_level: "VIEWER" }), /Somente administradores/);

const sql = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
for (const table of ["profiles", "numbers", "clients", "squads", "campaigns", "number_campaign_links", "responsibles", "locations", "incidents", "restrictions", "history_events", "audit_logs"]) {
  assert.match(sql, new RegExp(`create table public\\.${table}\\b`));
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
}
assert.match(sql, /references auth\.users\(id\)/);
assert.match(sql, /access_level[^\n]+default 'USER'/);
assert.doesNotMatch(sql, /service_role/i);

console.log("Bloco 3: Auth, repositories, modelagem e RLS preparados localmente.");
