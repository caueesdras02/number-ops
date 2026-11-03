import assert from "node:assert/strict";
import { hasGlobalScope, isSquadScoped, scopeSquadIdOf } from "../src/js/models/access.js";
import { NumbersService } from "../src/js/services/numbers-service.js";
import { renderNumberForm } from "../src/js/ui/numbers-view.js";
import { renderBackup } from "../src/js/ui/backup-view.js";
import { translateDatabaseError } from "../src/js/repositories/supabase-state-repository.js";

// ---------------------------------------------------------------------------
// BLOCO 32 — isolamento por Squad no frontend. O isolamento real é o RLS (025-027);
// aqui só valida que a interface respeita o escopo e lida com as recusas do banco.
// ---------------------------------------------------------------------------

// access.js — ADMIN preserva o escopo global (igual MASTER); USER/VIEWER são por Squad.
assert.equal(hasGlobalScope({ access_level: "MASTER" }), true);
assert.equal(hasGlobalScope({ access_level: "ADMIN" }), true);
assert.equal(hasGlobalScope({ access_level: "USER" }), false);
assert.equal(isSquadScoped({ access_level: "USER" }), true);
assert.equal(isSquadScoped({ access_level: "VIEWER" }), true);
assert.equal(isSquadScoped({ access_level: "ADMIN" }), false);
assert.equal(scopeSquadIdOf({ access_level: "USER", squad_id: "s1" }), "s1");
assert.equal(scopeSquadIdOf({ access_level: "ADMIN", squad_id: "s1" }), null, "ADMIN nunca é restringido pelo próprio Squad");
assert.equal(scopeSquadIdOf(null), null, "modo local (sem profile) não tem escopo");

function makeService(scopeSquadId, numbers = []) {
  let persisted = {
    schemaVersion: 2, meta: { seedApplied: true },
    groups: [{ id: "s1", name: "Squad 1", isActive: true }, { id: "s2", name: "Squad 2", isActive: true }],
    clients: [], responsibles: [], locations: [], campaigns: [], numberCampaignLinks: [], incidents: [], historyEvents: [],
    numbers,
  };
  const repository = { initialize: () => structuredClone(persisted), save: (value) => { persisted = structuredClone(value); } };
  return new NumbersService(repository, { scopeSquadId });
}

// USER: número novo sempre fica no Squad de quem cadastrou.
{
  const service = makeService("s1");
  const created = service.create({ phone: "5511999990001", groupIds: [] });
  assert.deepEqual(created.groupIds, ["s1"]);
  const withOther = service.create({ phone: "5511999990002", groupIds: ["s2"] });
  assert.deepEqual(withOther.groupIds, ["s2", "s1"]);
}

// USER: editar um número do próprio Squad não o tira do Squad; número de estoque não é puxado sozinho.
{
  const base = { identification: "", status: "ACTIVE", locationId: null, responsibleId: null, clientIds: [], groupCount: 0, notes: "", restriction: null, archivedAt: null };
  const service = makeService("s1", [
    { ...base, id: "own", phone: "5511999990003", groupIds: ["s1"] },
    { ...base, id: "stock", phone: "5511999990004", groupIds: [] },
  ]);
  assert.deepEqual(service.update("own", { phone: "5511999990003", groupIds: [] }).groupIds, ["s1"]);
  assert.deepEqual(service.update("stock", { phone: "5511999990004", groupIds: [] }).groupIds, []);
}

// MASTER/ADMIN (sem escopo): comportamento idêntico ao anterior.
{
  const service = makeService(null);
  assert.deepEqual(service.create({ phone: "5511999990005", groupIds: [] }).groupIds, []);
}

// Número recusado pelo banco sai do estado local (senão todo save seguinte falharia de novo).
{
  const service = makeService("s1");
  const created = service.create({ phone: "5511999990006", groupIds: [] });
  assert.ok(service.state.historyEvents.some((event) => event.numberId === created.id));
  service.discardUnsyncedNumber(created.id);
  assert.equal(service.getNumber(created.id), null);
  assert.ok(!service.state.historyEvents.some((event) => event.numberId === created.id));
}

// Formulário: o Squad do USER vem marcado e travado (e ainda assim entra no FormData via hidden).
{
  const groups = [{ id: "s1", name: "Squad 1" }];
  const html = renderNumberForm({ locations: [], responsibles: [], groups, lockedGroupId: "s1" });
  assert.match(html, /<input type="checkbox" value="s1" checked disabled><input type="hidden" name="groupIds" value="s1">/);
  const free = renderNumberForm({ locations: [], responsibles: [], groups });
  assert.doesNotMatch(free, /disabled><input type="hidden" name="groupIds"/, "sem escopo, nada travado");
}

// Erros do banco esperados com o isolamento ganham mensagem clara, preservando o código.
{
  const duplicate = translateDatabaseError({ code: "23505", message: 'duplicate key value violates unique constraint "numbers_phone_key"', details: "Key (phone)=(5511999990001) already exists." });
  assert.equal(duplicate.duplicatePhone, true);
  assert.equal(duplicate.code, "23505");
  assert.match(duplicate.message, /telefone já está cadastrado/);
  assert.doesNotMatch(duplicate.message, /5511999990001/, "nunca ecoa dado do outro Squad");
  const rls = translateDatabaseError({ code: "42501", message: 'new row violates row-level security policy for table "numbers"' });
  assert.match(rls.message, /outro Squad/);
  assert.equal(rls.code, "42501");
  const other = { code: "23505", message: "duplicate key value violates unique constraint \"incidents_integration_event_uidx\"" };
  assert.equal(translateDatabaseError(other), other, "outros 23505 seguem intactos (ex.: dedupe do Bot)");
}

// Backup: restaurar só para quem pode (MASTER/ADMIN); exportar continua para todos.
{
  assert.match(renderBackup(null, "", null, null, true, true), /data-backup-file/);
  const userHtml = renderBackup(null, "", null, null, true, false);
  assert.doesNotMatch(userHtml, /data-backup-file/);
  assert.match(userHtml, /data-backup-export/);
}

console.log("Bloco 32 (isolamento por Squad no frontend): todos os cenários passaram.");
