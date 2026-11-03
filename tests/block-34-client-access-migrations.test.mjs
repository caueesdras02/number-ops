import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// BLOCO 34 — acesso de cliente (migrations 028/029 + rollback). Só valida o texto dos .sql;
// a prova em banco real é tests/sql/client_portal_rls.test.sql (local/staging).
// ---------------------------------------------------------------------------

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const m025 = await read("../supabase/025_squad_scope_helpers.sql");
const m028 = await read("../supabase/028_client_access_level.sql");
const m029 = await read("../supabase/029_client_portal.sql");
const rollback = await read("../supabase/rollback/rollback_029_client_portal.sql");

// 028: valor de enum sozinho, sem transação (mesma regra de 008/020).
assert.match(m028, /alter type public\.access_level add value if not exists 'CLIENT'/);
assert.doesNotMatch(m028, /^\s*(begin|commit);/im, "028 não pode ter begin/commit");

// Nada apaga dados.
for (const sql of [m028, m029, rollback]) {
  assert.doesNotMatch(sql, /\btruncate\b|drop table|delete from|drop column/i, "acesso de cliente nunca apaga dados");
}

// Squad do perfil só restringe USER/VIEWER — um CLIENT com squad_id preenchido não herda dados do Squad.
assert.match(m025, /access_level::text in \('USER','VIEWER'\)/);

// 029: vínculo usuário -> cliente, obrigatório para CLIENT (no perfil e no convite).
assert.match(m029, /alter table public\.profiles add column if not exists client_id text references public\.clients\(id\)/);
assert.match(m029, /profiles_client_access_check\s+check \(access_level::text <> 'CLIENT' or client_id is not null\)/);
assert.match(m029, /signup_authorizations_client_access_check\s+check \(access_level::text <> 'CLIENT' or client_id is not null\)/);
assert.match(m029, /create or replace function public\.current_client_id\(\)[\s\S]{0,200}access_level::text = 'CLIENT'/);
// Cadastro: cliente vem só da autorização; CLIENT nunca recebe Squad.
assert.match(m029, /select access_level, squad_id, client_id into v_access_level, v_squad_id, v_client_id\s+from public\.signup_authorizations/);
assert.match(m029, /if v_access_level::text = 'CLIENT' then\s+v_squad_id := null;/);
assert.doesNotMatch(m029, /raw_user_meta_data ->> '(client_id|squad_id|access_level)'/, "nada de acesso vem do metadata enviado pelo navegador");

// Fecha o que era "qualquer usuário ativo": localizações e inscrição de push.
assert.match(m029, /alter policy locations_select[\s\S]{0,200}<> 'CLIENT'/);
assert.match(m029, /alter policy push_subscriptions_own_insert[\s\S]{0,200}<> 'CLIENT'/);
assert.doesNotMatch(m029, /create policy/i, "só ALTER POLICY (create permissiva somaria com OR)");

// Portal: security definer, só para authenticated, parâmetro de cliente só para escopo global.
assert.match(m029, /create or replace function public\.client_portal\(p_client_id text default null\)\s+returns jsonb language plpgsql stable security definer set search_path = public/);
assert.match(m029, /if p_client_id is not null and public\.current_has_global_scope\(\) then/);
assert.match(m029, /raise exception 'Acesso de cliente não configurado para este usuário\.' using errcode = '42501'/);
assert.match(m029, /revoke all on function public\.client_portal\(text\) from public, anon/);
assert.match(m029, /grant execute on function public\.client_portal\(text\) to authenticated/);
// Só os campos combinados — nunca observações, colaborador, descrição de ocorrência ou payload bruto.
const portalBody = m029.slice(m029.indexOf("create or replace function public.client_portal"), m029.indexOf("revoke all on function public.client_portal"));
for (const forbidden of ["n.notes", "responsible_id', ", "'description'", "i.description", "raw_payload", "resolution_notes", "r.description"]) {
  assert.ok(!portalBody.includes(forbidden), `portal não pode devolver ${forbidden}`);
}
for (const allowed of ["'location', loc.name", "'groupCount', n.group_count", "'restriction', r.kind", "'identification', n.identification"]) {
  assert.ok(portalBody.includes(allowed), `portal precisa devolver ${allowed}`);
}
// Quedas só dentro do período do chip numa campanha do cliente.
assert.match(portalBody, /i\.created_at >= l\.started_at and \(l\.ended_at is null or i\.created_at <= l\.ended_at\)/);
assert.match(portalBody, /where i\.classification = 'CONNECTIVITY'/);

// Rollback desfaz policies e funções do portal.
assert.match(rollback, /drop function if exists public\.client_portal\(text\)/);
assert.match(rollback, /drop function if exists public\.current_client_id\(\)/);
assert.match(rollback, /alter policy locations_select on public\.locations using \(public\.current_profile_is_active\(\)\)/);
assert.doesNotMatch(rollback, /<> 'CLIENT'/, "rollback não deixa policy dependente de CLIENT");

console.log("Bloco 34 (migrations do acesso de cliente): todos os cenários passaram.");
