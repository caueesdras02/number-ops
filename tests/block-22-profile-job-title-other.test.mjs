import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderRegistration } from "../src/js/ui/auth-view.js";
import { renderProfileForm, renderProfiles } from "../src/js/ui/profiles-view.js";
import { ProfilesService } from "../src/js/services/profiles-service.js";

// ---------------------------------------------------------------------------
// BLOCO 22 — cargo "Outro" (OTHER) em public.profile_job_title. Pedido do
// usuário: um novo valor de enum além de ANALYST/ACCOUNT_MANAGER. Como o
// enum é usado em produção, exige duas migrations isoladas (mesma regra já
// aplicada em 008/009 para o enum access_level): 020 só adiciona o valor,
// 021 (numa transação separada) atualiza handle_new_user pra reconhecê-lo.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Frontend — as 3 telas que listam/gravam Cargo.
// ---------------------------------------------------------------------------
const registrationHtml = renderRegistration();
assert.match(registrationHtml, /<option value="OTHER">Outro<\/option>/, "cadastro precisa oferecer Outro como cargo");

const formHtml = renderProfileForm({ id: "u1", job_title: "OTHER", status: "ACTIVE", access_level: "USER" }, [], { access_level: "MASTER" });
assert.match(formHtml, /<option value="OTHER" selected>Outro<\/option>/, "edição de usuário precisa oferecer e pré-selecionar Outro corretamente");

const listHtml = renderProfiles({ profiles: [{ id: "u1", name: "Fulano", email: "f@x.com", job_title: "OTHER", squad_id: null, status: "ACTIVE", access_level: "USER" }], squads: [], currentProfile: { id: "m1", access_level: "MASTER" } });
assert.match(listHtml, /<td>Outro<\/td>/, "listagem de usuários precisa mostrar o rótulo em português, não o valor cru OTHER");

// ProfilesService.update precisa aceitar "OTHER" como cargo válido (mesma validação que já
// existia pra ANALYST/ACCOUNT_MANAGER).
{
  const profiles = [{ id: "u1", name: "Fulano", email: "f@x.com", access_level: "USER", status: "ACTIVE", squad_id: null }];
  const service = new ProfilesService(
    { list: async () => profiles.map((p) => ({ ...p })), update: async (id, changes) => ({ id, ...changes }) },
    { list: async () => [] },
  );
  await assert.doesNotReject(() => service.update("u1", { name: "Fulano", job_title: "OTHER", squad_id: "", status: "ACTIVE" }, { id: "m1", access_level: "MASTER" }));
}

// ---------------------------------------------------------------------------
// Migration 020 — só adiciona o valor de enum, isolada (sem begin/commit),
// mesma regra do 008_master_access_level.sql.
// ---------------------------------------------------------------------------
const m020 = await readFile(new URL("../supabase/020_profile_job_title_other.sql", import.meta.url), "utf8");
assert.match(m020, /alter type public\.profile_job_title add value if not exists 'OTHER'/i);
assert.doesNotMatch(m020, /\bbegin;/i, "020 não deve abrir transação — mesma regra de enum isolado do 008");
assert.doesNotMatch(m020, /create or replace function/i, "020 só adiciona o valor — nada de lógica de trigger no mesmo arquivo/transação");

// ---------------------------------------------------------------------------
// Migration 021 — handle_new_user reconhece OTHER, sem quebrar os 2 ramos
// existentes (ACCOUNT_MANAGER explícito, ANALYST como default).
// ---------------------------------------------------------------------------
const m021 = await readFile(new URL("../supabase/021_profile_job_title_other_trigger.sql", import.meta.url), "utf8");
assert.match(m021, /create or replace function public\.handle_new_user/i);
assert.match(m021, /when 'OTHER' then 'OTHER'::public\.profile_job_title/);
assert.match(m021, /when 'ACCOUNT_MANAGER' then 'ACCOUNT_MANAGER'::public\.profile_job_title/, "ramo existente precisa continuar intacto");
assert.match(m021, /else 'ANALYST'::public\.profile_job_title/, "default continua ANALYST — não é regra de negócio nova, só um valor a mais");
// Resto da função (autorização, squad, trigger update) precisa ter sido preservado de 019, não reescrito do zero.
assert.match(m021, /for update;/);
assert.match(m021, /raise exception 'E-mail não autorizado/);
assert.match(m021, /status = 'USED', used_by = new\.id/);
assert.doesNotMatch(m021, /truncate|drop table|delete from/i, "021 é aditiva — nunca apaga dado existente");

console.log("Bloco 22 (cargo \"Outro\" em profile_job_title): todos os cenários passaram.");
