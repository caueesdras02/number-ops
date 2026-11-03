import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// BLOCO 27 — migration 024 (preferência de notificação push por Squad). Só
// valida o texto do .sql (mesmo estilo dos blocos 18/26) — não aplica nada em
// banco real.
// ---------------------------------------------------------------------------

const m024 = await readFile(new URL("../supabase/024_push_squad_preferences.sql", import.meta.url), "utf8");

assert.match(m024, /create table public\.push_subscription_squads/i);
assert.match(m024, /id uuid primary key default gen_random_uuid\(\)/i);
assert.match(m024, /subscription_id uuid not null references public\.push_subscriptions\(id\) on delete cascade/i);
// squads.id é text (mesmo padrão de clients/campaigns), nunca uuid.
assert.match(m024, /squad_id text not null references public\.squads\(id\) on delete cascade/i);
assert.match(m024, /unique \(subscription_id, squad_id\)/i, "nunca duplica a mesma preferência de Squad pra mesma inscrição");

assert.match(m024, /create index push_subscription_squads_subscription_idx on public\.push_subscription_squads \(subscription_id\)/i);

// RLS: só o dono da inscrição (via subscription_id -> push_subscriptions.profile_id) — mesmo
// modelo de dado pessoal por dispositivo já usado em push_subscriptions.
assert.match(m024, /alter table public\.push_subscription_squads enable row level security/i);
assert.match(m024, /create policy push_subscription_squads_own_select[\s\S]{0,300}ps\.profile_id = auth\.uid\(\)/i);
assert.match(m024, /create policy push_subscription_squads_own_insert[\s\S]{0,300}ps\.profile_id = auth\.uid\(\)/i);
assert.match(m024, /create policy push_subscription_squads_own_delete[\s\S]{0,300}ps\.profile_id = auth\.uid\(\)/i);
assert.match(m024, /grant select, insert, delete on public\.push_subscription_squads to authenticated/i);

// Nunca precisa de UPDATE (preferência é sempre substituída por completo: remove tudo, grava de novo).
assert.doesNotMatch(m024, /for update/i);

// Aditiva: nunca toca dado existente.
assert.doesNotMatch(m024, /truncate|drop table|delete from public\.(numbers|clients|campaigns|incidents|push_subscriptions)/i, "024 é aditiva — nunca apaga dado existente");

console.log("Bloco 27 (migration 024 — preferência de push por Squad): todos os cenários passaram.");
