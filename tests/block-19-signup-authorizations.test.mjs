import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SignupAuthorizationsService } from "../src/js/services/signup-authorizations-service.js";
import { AuthService } from "../src/js/services/auth-service.js";
import { renderSignupAuthorizationForm, renderSignupAuthorizations } from "../src/js/ui/signup-authorizations-view.js";
import { renderRegistration } from "../src/js/ui/auth-view.js";
import { createSupabaseRepositories } from "../src/js/repositories/supabase-repository.js";

// ---------------------------------------------------------------------------
// BLOCO 19 — cadastro por convite (signup_authorizations). Só JS puro +
// asserções de texto na migration 019 (mesmo estilo dos blocos 6/15/16/18) —
// não aplica nada em banco real, não abre conexão com Supabase.
// ---------------------------------------------------------------------------

const master = { id: "m1", name: "Master", access_level: "MASTER" };
const admin = { id: "a1", name: "Admin", access_level: "ADMIN" };
const user = { id: "u1", name: "User", access_level: "USER" };
const viewer = { id: "v1", name: "Viewer", access_level: "VIEWER" };

// ---------------------------------------------------------------------------
// SignupAuthorizationsService — quem pode gerenciar autorizações
// ---------------------------------------------------------------------------
function fakeRepo(initial = []) {
  const rows = [...initial];
  return {
    rows,
    list: async () => rows.map((r) => ({ ...r })),
    upsert: async (record) => { rows.push({ ...record }); return { ...record }; },
    update: async (id, changes) => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error("not found");
      Object.assign(row, changes);
      return { ...row };
    },
  };
}

// Só MASTER cria autorizações — ADMIN/USER/VIEWER tentando são rejeitados.
{
  const service = new SignupAuthorizationsService(fakeRepo());
  for (const actor of [admin, user, viewer]) {
    await assert.rejects(() => service.create({ email: "novo@empresa.com", accessLevel: "USER" }, actor), /Somente MASTER/, `${actor.access_level} não pode autorizar`);
  }
  await assert.doesNotReject(() => service.create({ email: "novo@empresa.com", accessLevel: "USER" }, master));
}

// E-mail inválido / nível inválido são rejeitados antes de qualquer escrita.
{
  const service = new SignupAuthorizationsService(fakeRepo());
  await assert.rejects(() => service.create({ email: "nao-e-email", accessLevel: "USER" }, master), /e-mail válido/i);
  await assert.rejects(() => service.create({ email: "x@y.com", accessLevel: "SUPERADMIN" }, master), /nível de acesso válido/i);
}

// ADMIN não pode conceder MASTER via autorização (só MASTER concede MASTER) — mesmo que de alguma
// forma um ADMIN acessasse este service diretamente, a regra de negócio ainda barra.
{
  const service = new SignupAuthorizationsService(fakeRepo());
  await assert.rejects(() => service.create({ email: "x@y.com", accessLevel: "MASTER" }, admin), /Somente MASTER pode/i);
}

// Reutilização: não pode existir 2 autorizações PENDING para o mesmo e-mail ao mesmo tempo.
{
  const repo = fakeRepo();
  const service = new SignupAuthorizationsService(repo);
  await service.create({ email: "duplicado@empresa.com", accessLevel: "USER" }, master);
  await assert.rejects(() => service.create({ email: "DUPLICADO@empresa.com", accessLevel: "ADMIN" }, master), /Já existe uma autorização pendente/i, "case-insensitive e mesmo status PENDING deve ser bloqueado no client-side também (defesa em profundidade; o índice único no banco é a garantia real)");
}

// Revogação: só MASTER, e só autorizações ainda PENDING.
{
  const repo = fakeRepo([{ id: "s1", email: "x@y.com", status: "PENDING" }, { id: "s2", email: "y@y.com", status: "USED" }]);
  const service = new SignupAuthorizationsService(repo);
  await assert.rejects(() => service.revoke("s1", admin), /Somente MASTER/);
  await assert.rejects(() => service.revoke("s2", master), /pendentes/i, "não é possível revogar uma autorização já usada");
  await service.revoke("s1", master);
  assert.equal(repo.rows.find((r) => r.id === "s1").status, "REVOKED");
}

// ---------------------------------------------------------------------------
// AuthService — registro não aceita mais squadId/access_level vindos do
// cliente, e a checagem antecipada é só um wrapper fino do RPC.
// ---------------------------------------------------------------------------
{
  const calls = [];
  const authRepository = {
    signUp: async (payload) => { calls.push(payload); return { user: { id: "new-user" } }; },
    checkSignupAuthorization: async (email) => email === "autorizado@empresa.com",
  };
  const authService = new AuthService(authRepository);

  assert.equal(await authService.isEmailAuthorized("autorizado@empresa.com"), true);
  assert.equal(await authService.isEmailAuthorized("outro@empresa.com"), false);
  assert.equal(await authService.isEmailAuthorized(""), false, "e-mail vazio não deve nem chamar o RPC");
  assert.equal(await authService.isEmailAuthorized("  "), false);

  // Mesmo se o form values tiver squadId/access_level "grudados" (ex.: alguém manipulando o DOM
  // e injetando campos extra no FormData), register() só encaminha os campos que espera.
  await authService.register({ name: "Fulano", email: "autorizado@empresa.com", password: "senha1234", jobTitle: "ANALYST", squadId: "s-hackeado", access_level: "MASTER" });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].options.data).sort(), ["job_title", "name"], "squad_id e access_level nunca podem ser enviados no signUp — quem decide isso é a autorização, no banco");
  assert.ok(!("squad_id" in calls[0].options.data));
  assert.ok(!("access_level" in calls[0].options.data));
}

// AuthService não expõe mais listActiveSquads (squad deixou de ser escolha do usuário no cadastro).
assert.equal(typeof new AuthService({}).listActiveSquads, "undefined");

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
const registrationHtml = renderRegistration();
assert.doesNotMatch(registrationHtml, /name="squadId"/, "cadastro não pode mais deixar o usuário escolher Squad");
assert.doesNotMatch(registrationHtml, /name="access_level"|name="accessLevel"/, "cadastro nunca expõe nível de acesso");
assert.match(registrationHtml, /data-email-auth-hint/, "precisa ter o slot para o aviso de e-mail não autorizado");
assert.match(registrationHtml, /autorizado/i);

const authorizationsHtml = renderSignupAuthorizations(
  [
    { id: "s1", email: "pendente@empresa.com", access_level: "USER", squad_id: null, status: "PENDING", created_at: "2026-01-01T00:00:00Z" },
    { id: "s2", email: "usado@empresa.com", access_level: "ADMIN", squad_id: "sq1", status: "USED", created_at: "2026-01-02T00:00:00Z" },
    { id: "s3", email: "revogado@empresa.com", access_level: "VIEWER", squad_id: null, status: "REVOKED", created_at: "2026-01-03T00:00:00Z" },
  ],
  [{ id: "sq1", name: "Nexus" }],
);
assert.match(authorizationsHtml, /data-master-only/, "seção inteira precisa ser marcada master-only, mesmo já gateada no controller (defesa em profundidade)");
assert.match(authorizationsHtml, /pendente@empresa\.com/);
assert.match(authorizationsHtml, /Nexus/);
assert.match(authorizationsHtml, /data-action="revoke-authorization" data-id="s1"/, "só a pendente pode ser revogada");
assert.doesNotMatch(authorizationsHtml, /data-action="revoke-authorization" data-id="s2"/, "autorização já usada não deve ter botão de revogar");
assert.doesNotMatch(authorizationsHtml, /data-action="revoke-authorization" data-id="s3"/, "autorização já revogada não deve ter botão de revogar de novo");

const formHtmlMaster = renderSignupAuthorizationForm([], true);
assert.match(formHtmlMaster, /value="MASTER"/, "MASTER pode conceder acesso MASTER na autorização");
const formHtmlNonMaster = renderSignupAuthorizationForm([], false);
assert.doesNotMatch(formHtmlNonMaster, /value="MASTER"/, "quem não é MASTER nunca pode oferecer a opção MASTER, nem defensivamente");

// ---------------------------------------------------------------------------
// Repositório genérico — nova tabela registrada
// ---------------------------------------------------------------------------
const repos = createSupabaseRepositories({});
assert.ok(repos.signupAuthorizations, "supabase-repository precisa expor o repo de signup_authorizations");

// ---------------------------------------------------------------------------
// Migration 019 — texto do SQL
// ---------------------------------------------------------------------------
const m019 = await readFile(new URL("../supabase/019_signup_authorizations.sql", import.meta.url), "utf8");

// Tabela + índice único parcial (só 1 PENDING por e-mail ao mesmo tempo).
assert.match(m019, /create table if not exists public\.signup_authorizations/i);
assert.match(m019, /status text not null default 'PENDING' check \(status in \('PENDING','USED','REVOKED'\)\)/);
assert.match(m019, /create unique index if not exists signup_authorizations_email_pending_uidx[\s\S]{0,120}where status = 'PENDING'/i, "unicidade tem que ser parcial (só entre PENDING) para permitir reconvite depois de usado/revogado");

// RLS: habilitada, e toda policy usa current_is_master() (mais restrito que ADMIN normal).
assert.match(m019, /alter table public\.signup_authorizations enable row level security/i);
const policyBlocks = [...m019.matchAll(/create policy signup_authorizations_master_(select|insert|update)[\s\S]{0,200}?current_is_master\(\)/g)];
assert.equal(policyBlocks.length, 3, "select/insert/update precisam existir e todas devem checar current_is_master()");
assert.doesNotMatch(m019, /current_access_level\(\) in \(''?ADMIN/i, "não pode liberar para ADMIN — autorização é MASTER-only, diferente do resto de Usuários");
assert.doesNotMatch(m019, /create policy signup_authorizations.*delete/i, "sem policy de delete — revogar é update de status, preserva histórico");

// Nunca abre a tabela para anon/authenticated em geral.
assert.match(m019, /revoke all on public\.signup_authorizations from anon, authenticated/i);
assert.doesNotMatch(m019, /grant select on public\.signup_authorizations to anon/i, "anon nunca pode ler a tabela diretamente — só via RPC que devolve boolean");

// RPC pública: devolve só boolean, security definer, liberada pra anon (precisa funcionar antes do login).
assert.match(m019, /create or replace function public\.check_signup_authorization\(p_email text\)\s*\nreturns boolean/i);
assert.match(m019, /security definer/i);
assert.match(m019, /grant execute on function public\.check_signup_authorization\(text\) to anon, authenticated/i);
// A RPC não pode devolver a linha inteira nem vazar squad/access_level.
const rpcBodyMatch = m019.match(/check_signup_authorization\(p_email text\)[\s\S]*?\$\$/);
assert.ok(rpcBodyMatch);
assert.doesNotMatch(rpcBodyMatch[0], /access_level|squad_id/i, "a RPC pública não pode devolver nível de acesso nem squad — só um boolean de existência");

// Gate real no trigger: handle_new_user precisa ser substituída, exigir autorização e não confiar
// em nada vindo do metadata do cliente para squad_id/access_level.
assert.match(m019, /create or replace function public\.handle_new_user/i);
assert.match(m019, /where lower\(email\) = lower\(new\.email\) and status = 'PENDING'\s*\n\s*for update/i, "precisa travar a linha (FOR UPDATE) para impedir reuso em corrida de cadastros concorrentes");
assert.match(m019, /if not found then\s*\n\s*raise exception/i, "sem autorização válida, a função precisa abortar (o que reverte inclusive o INSERT em auth\\.users)");
assert.doesNotMatch(m019, /raw_user_meta_data ->> 'squad_id'/i, "squad_id não pode mais vir do metadata enviado pelo cliente — só da autorização");
assert.doesNotMatch(m019, /'USER'\s*\n\s*\);/, "access_level não pode mais ser hardcoded 'USER' — precisa vir da autorização (v_access_level)");
assert.match(m019, /v_access_level/);
assert.match(m019, /status = 'USED', used_by = new\.id, used_at = now\(\)/i, "precisa marcar a autorização como usada e registrar quem consumiu");

// Nunca destrutiva / nunca toca em usuários existentes / nunca usa service_role no cliente.
assert.doesNotMatch(m019, /truncate|drop table|delete from (public\.profiles|auth\.users)/i, "019 é aditiva — nunca apaga profile ou usuário existente");
assert.doesNotMatch(m019, /service_role/i);
assert.doesNotMatch(m019, /delete from public\.profiles/i);

console.log("Bloco 19 (cadastro por convite — signup_authorizations): todos os cenários passaram.");
