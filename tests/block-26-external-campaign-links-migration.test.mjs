import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// BLOCO 26 — migration 023 (vincular Cliente/Campanha em números que não são
// nossos). Só valida o texto do .sql (mesmo estilo do bloco 18) — não aplica
// nada em banco real.
// ---------------------------------------------------------------------------

const m023 = await readFile(new URL("../supabase/023_external_number_campaign_links.sql", import.meta.url), "utf8");

assert.match(m023, /create table public\.external_number_campaign_links/i);
assert.match(m023, /external_number_id text not null references public\.external_numbers\(id\) on delete cascade/i);
// campaigns.id é text (ver schema.sql:92), nunca uuid — a FK precisa casar o tipo.
assert.match(m023, /campaign_id text not null references public\.campaigns\(id\) on delete cascade/i);
assert.match(m023, /phone_normalized text not null check \(phone_normalized ~ '\^55\[0-9\]\{10,11\}\$'\)/);
assert.match(m023, /company_label text/i);
assert.match(m023, /client_account_label text/i);
assert.match(m023, /ended_at timestamptz/i, "precisa preservar histórico (encerrar sem apagar a linha)");

// Índices: dois de lookup + o unique parcial que impede duplicar o MESMO vínculo ativo.
assert.match(m023, /create index external_number_campaign_links_campaign_idx on public\.external_number_campaign_links \(campaign_id\)/i);
assert.match(m023, /create index external_number_campaign_links_external_idx on public\.external_number_campaign_links \(external_number_id\)/i);
assert.match(m023, /create unique index external_number_campaign_links_active_uidx\s+on public\.external_number_campaign_links \(external_number_id, campaign_id\) where ended_at is null/i);

// RLS: leitura pra qualquer perfil ativo, escrita só MASTER/ADMIN/USER (mesmo tier de numbers/campaigns/external_numbers).
assert.match(m023, /alter table public\.external_number_campaign_links enable row level security/i);
assert.match(m023, /create policy external_number_campaign_links_select[\s\S]{0,200}using \(public\.current_profile_is_active\(\)\)/i);
assert.match(m023, /create policy external_number_campaign_links_insert[\s\S]{0,200}with check \(public\.current_access_level\(\) in \('MASTER','ADMIN','USER'\)\)/i);
assert.match(m023, /create policy external_number_campaign_links_update[\s\S]{0,300}with check \(public\.current_access_level\(\) in \('MASTER','ADMIN','USER'\)\)/i);
assert.match(m023, /grant select, insert, update on public\.external_number_campaign_links to authenticated/i);

// Nunca cria policy de DELETE (nunca apaga de verdade — só encerra via ended_at, mesmo padrão de external_numbers/number_campaign_links).
assert.doesNotMatch(m023, /for delete/i);

// Aditiva: nunca toca dado operacional existente.
assert.doesNotMatch(m023, /truncate|drop table|delete from public\.(numbers|clients|campaigns|number_campaign_links|incidents|external_numbers)/i, "023 é aditiva — nunca apaga dado operacional existente");

console.log("Bloco 26 (migration 023 — vincular Cliente/Campanha em números que não são nossos): todos os cenários passaram.");
