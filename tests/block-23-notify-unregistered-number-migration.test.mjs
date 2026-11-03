import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// BLOCO 23 — migration 022 (push pra número que caiu sem estar cadastrado).
// Só valida o texto do .sql (mesmo estilo dos blocos 15/16/18) — não aplica
// nada em banco real.
// ---------------------------------------------------------------------------

const m022 = await readFile(new URL("../supabase/022_notify_unregistered_number.sql", import.meta.url), "utf8");

// Gatilho na tabela certa, no momento certo (INSERT — integration_events é log imutável).
assert.match(m022, /create trigger integration_events_notify_unregistered\s+after insert on public\.integration_events/i);
assert.match(m022, /create or replace function public\.notify_unregistered_number\(\)/i);

// Condição precisa dos três campos — nunca dispara pra evento já MATCHED/IGNORED/ERROR, nem
// pra um event_type diferente de CONNECTIVITY_ALERT, nem sem telefone.
assert.match(m022, /new\.event_type = 'CONNECTIVITY_ALERT'/);
assert.match(m022, /new\.processing_status = 'PENDING_ASSOCIATION'/);
assert.match(m022, /new\.phone_normalized is not null/);

// Dedupe por telefone numa janela — evita reenviar a cada novo alerta do mesmo número ainda não
// associado (sem estado OPEN/RESOLVED disponível aqui, diferente de incidents).
assert.match(m022, /interval '30 minutes'/);
assert.match(m022, /phone_normalized = new\.phone_normalized/);
assert.match(m022, /processing_status = 'PENDING_ASSOCIATION'/);

// Reaproveita o MESMO segredo/URL da 017 — não pede um novo passo manual de vault.
assert.match(m022, /push_trigger_secret/);
assert.match(m022, /vault\.decrypted_secrets/);
assert.match(m022, /x-push-trigger-secret/);

// Payload no formato que handler.js (send-push-notifications) sabe interpretar.
assert.match(m022, /jsonb_build_object\('unregisteredPhone', new\.phone_normalized\)/);

// Mesma blindagem da 017: qualquer falha no efeito colateral vira só um warning, nunca impede a
// gravação real do integration_event que disparou o gatilho.
assert.match(m022, /exception when others then/);
assert.match(m022, /raise warning 'notify_unregistered_number/);

// Aditiva: nunca mexe em dado existente, nunca recria a tabela/gatilho da 017.
assert.doesNotMatch(m022, /truncate|drop table|delete from public\.|drop trigger incidents_notify_number_down|create or replace function public\.notify_number_down/i, "022 é aditiva — nunca apaga dado nem redefine o gatilho da 017");

console.log("Bloco 23 (migration 022 — push pra número não cadastrado): todos os cenários passaram.");
