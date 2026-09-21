import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// BLOCO 15 — migration 017 (notificação push / "número caiu"): só valida o
// texto do .sql (mesmo estilo do bloco 6 para 008/009/012) — não aplica nada
// em banco real.
// ---------------------------------------------------------------------------

const m017 = await readFile(new URL("../supabase/017_push_notifications.sql", import.meta.url), "utf8");

assert.match(m017, /create extension if not exists pg_net/i);

assert.match(m017, /create table public\.push_subscriptions/i);
assert.match(m017, /profile_id uuid not null references public\.profiles\(id\)/i);
assert.match(m017, /create unique index push_subscriptions_endpoint_uidx/i);

assert.match(m017, /create policy push_subscriptions_own_select/i);
assert.match(m017, /create policy push_subscriptions_own_insert/i);
assert.match(m017, /create policy push_subscriptions_own_update/i, "precisa de UPDATE — reassinar no mesmo aparelho atualiza a linha existente (PushService.subscribe)");
assert.match(m017, /create policy push_subscriptions_own_delete/i);
assert.match(m017, /grant select, insert, update, delete on public\.push_subscriptions/i);
assert.match(m017, /profile_id = auth\.uid\(\)/);
assert.doesNotMatch(m017, /current_access_level\(\)/, "inscrição de push é dado pessoal — não passa pelos tiers MASTER/ADMIN/USER/VIEWER");

assert.match(m017, /create or replace function public\.notify_number_down/i);
assert.match(m017, /classification = 'CONNECTIVITY' and new\.status = 'OPEN'/i);
assert.match(m017, /tg_op = 'UPDATE' and old\.status = 'OPEN'/i, "não deve notificar de novo numa ocorrência já aberta que só foi editada");
assert.match(m017, /vault\.decrypted_secrets/i);
assert.match(m017, /net\.http_post/i);
assert.match(m017, /exception when others then/i, "falha ao notificar nunca pode derrubar o insert/update real da Ocorrência (Bot/CONNECTIVITY)");
assert.match(m017, /create trigger incidents_notify_number_down/i);
assert.match(m017, /after insert or update on public\.incidents/i);

assert.doesNotMatch(m017, /truncate|drop table|delete from public\.(numbers|clients|campaigns|incidents)/i, "017 é aditiva — nunca apaga dado operacional existente");

console.log("Bloco 15 (migration 017 — notificação push): todos os cenários passaram.");
