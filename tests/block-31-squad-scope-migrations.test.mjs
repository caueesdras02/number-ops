import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// BLOCO 31 — isolamento por Squad (migrations 025/026/027 + rollback). Só valida o
// texto dos .sql (mesmo estilo dos blocos 18/26/27) — não aplica nada em banco real.
// A prova de RLS de verdade é feita em banco local/staging (ver tests/sql/).
// ---------------------------------------------------------------------------

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const m025 = await read("../supabase/025_squad_scope_helpers.sql");
const m026 = await read("../supabase/026_squad_scope_select_policies.sql");
const m027 = await read("../supabase/027_squad_scope_write_policies.sql");
const rollback = await read("../supabase/rollback/rollback_025_027_squad_scope.sql");
const all = [m025, m026, m027, rollback];

// Nenhuma migration apaga/trunca/reescreve dado.
for (const sql of all) {
  assert.doesNotMatch(sql, /\btruncate\b|drop table|delete from|\bupdate public\.|insert into/i, "isolamento por Squad nunca toca dados");
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
}

// 025 — helpers: security definer + search_path fixo; ADMIN e MASTER são escopo global.
for (const fn of ["current_squad_id", "current_has_global_scope", "can_see_squad", "can_see_client", "can_see_campaign", "can_see_number"]) {
  assert.match(m025, new RegExp(`create or replace function public\\.${fn}\\([^)]*\\)[\\s\\S]{0,120}security definer set search_path = public`, "i"), `${fn} é security definer com search_path fixo`);
  assert.match(m025, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`, "i"));
  assert.match(m025, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`, "i"));
}
assert.match(m025, /current_access_level\(\) in \('MASTER','ADMIN'\)/, "ADMIN preserva acesso global, igual MASTER");
assert.match(m025, /from public\.profiles where id = auth\.uid\(\) and status = 'ACTIVE'/, "Squad vem do perfil ATIVO do próprio usuário");
assert.doesNotMatch(m025, /public\.push_subscription_squads/,"Squad do perfil nunca se mistura com preferência de notificação");
assert.match(m025, /create index if not exists number_squads_squad_idx on public\.number_squads \(squad_id\)/);
// Número sem Squad ("estoque") é visível a USER com Squad; nunca a usuário sem Squad.
assert.match(m025, /current_squad_id\(\) is not null[\s\S]{0,400}not exists \(select 1 from public\.number_squads ns where ns\.number_id = p_number_id\)/);

// 026/027 — só ALTER POLICY (CREATE POLICY permissiva somaria com OR e não restringiria nada).
for (const sql of [m026, m027]) {
  assert.doesNotMatch(sql, /create policy/i, "nunca cria policy nova ao lado da antiga");
  assert.doesNotMatch(sql, /drop policy/i);
}

const selectTables = ["squads", "clients", "responsibles", "numbers", "number_squads", "number_clients", "incidents", "restrictions", "history_events", "campaigns", "number_campaign_links", "external_number_campaign_links", "integration_events", "external_numbers"];
for (const table of selectTables) {
  assert.match(m026, new RegExp(`alter policy ${table}_select on public\\.${table}`, "i"), `${table}: leitura com escopo de Squad`);
}
// Fora do escopo de propósito: catálogo de localizações, auditoria, perfis, notificações.
assert.doesNotMatch(m026, /alter policy (locations|audit_logs|profiles|push_subscriptions|push_subscription_squads|signup_authorizations)\w*/i);
assert.match(m026, /alter policy numbers_select[\s\S]{0,250}id in \(select public\.visible_number_ids\(\)\)[\s\S]{0,150}is_unassigned_number\(id\)/, "número recém-inserido (ainda sem Squad) continua visível para quem o criou");
assert.match(m026, /alter policy incidents_select[\s\S]{0,250}number_id in \(select public\.visible_number_ids\(\)\)/, "ocorrência segue o número (relação indireta)");
assert.match(m026, /alter policy history_events_select[\s\S]{0,250}number_id in \(select public\.visible_number_ids\(\)\)/);
assert.match(m026, /alter policy campaigns_select[\s\S]{0,250}squad_id = \(select public\.current_squad_id\(\)\)/);
assert.match(m026, /alter policy number_campaign_links_select[\s\S]{0,250}campaign_id in \(select public\.visible_campaign_ids\(\)\)/);
// Desempenho: nenhuma policy de leitura chama função por linha sobre tabela grande — tudo é
// `(select f())` (avaliado 1x por consulta) ou `in (select f())` (subplano com hash). A única
// exceção é is_unassigned_number, último recurso só na tabela numbers.
const perRowCalls = m026.replace(/\(select public\.\w+\(\)\)/g, "").replace(/in \(select public\.\w+\(\)\)/g, "").match(/public\.\w+\(/g) ?? [];
assert.deepEqual([...new Set(perRowCalls)], ["public.is_unassigned_number("], "policies de leitura não chamam função por linha");
for (const fn of ["visible_number_ids", "visible_campaign_ids", "visible_client_ids", "is_unassigned_number"]) {
  assert.match(m025, new RegExp(`create or replace function public\\.${fn}\\([^)]*\\)[\\s\\S]{0,120}security definer set search_path = public`, "i"));
  assert.match(m025, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`, "i"));
}

// 027 — escrita: VIEWER continua fora (tier sem VIEWER), Squad exigido.
assert.doesNotMatch(m027, /'VIEWER'/, "VIEWER nunca ganha escrita");
assert.doesNotMatch(m027, /alter policy \w+_delete on public\.(numbers|campaigns|clients|squads|incidents|history_events)\b/i, "exclusão definitiva continua só MASTER (009)");
assert.match(m027, /alter policy number_squads_insert[\s\S]{0,200}can_see_squad\(squad_id\)/, "USER só associa o próprio Squad");
assert.match(m027, /alter policy campaigns_insert[\s\S]{0,200}can_see_squad\(squad_id\) and public\.can_see_client\(client_id\)/, "cliente da campanha precisa ser do mesmo Squad (antes só no frontend)");
assert.match(m027, /alter policy number_campaign_links_insert[\s\S]{0,200}can_see_campaign\(campaign_id\) and public\.can_see_number\(number_id\)/);
assert.match(m027, /alter policy integration_events_manual_resolution_update[\s\S]{0,600}number_id is null or public\.can_see_number\(number_id\)/, "associação manual nunca aponta número de outro Squad");
assert.match(m027, /alter policy external_numbers_insert on public\.external_numbers\s+with check \(public\.current_has_global_scope\(\)\)/, "memória global de externos: só MASTER/ADMIN");

// Rollback devolve cada policy tocada à forma anterior.
assert.match(rollback, /using \(public\.current_profile_is_active\(\)\)/);
for (const table of selectTables) assert.ok(rollback.includes(`'${table}'`) || rollback.includes(`policy ${table}_select`), `rollback cobre ${table}_select`);
assert.doesNotMatch(rollback, /can_see_|current_squad_id/, "rollback não deixa nenhuma policy dependente de Squad");

console.log("Bloco 31 (migrations de isolamento por Squad): todos os cenários passaram.");
