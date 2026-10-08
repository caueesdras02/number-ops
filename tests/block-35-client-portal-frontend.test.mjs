import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ACCESS_LEVELS, canOperate, isClientAccess, isAdminOrAbove, isSquadScoped } from "../src/js/models/access.js";
import { chipHealth, buildPortalView, ClientPortalService, CHIP_HEALTH } from "../src/js/services/client-portal-service.js";
import { renderClientPortal, renderClientPortalError } from "../src/js/ui/client-portal-view.js";
import { ClientPortalController } from "../src/js/controllers/client-portal-controller.js";
import { SignupAuthorizationsService } from "../src/js/services/signup-authorizations-service.js";
import { ProfilesService } from "../src/js/services/profiles-service.js";
import { renderSignupAuthorizationForm, renderSignupAuthorizations } from "../src/js/ui/signup-authorizations-view.js";
import { renderProfileForm, renderProfiles } from "../src/js/ui/profiles-view.js";
import { renderDirectoryDetail } from "../src/js/ui/directory-view.js";

// ---------------------------------------------------------------------------
// BLOCO 35 — Portal do cliente (acesso CLIENT) no frontend.
// ---------------------------------------------------------------------------

// Acesso: CLIENT é externo e só leitura.
assert.ok(ACCESS_LEVELS.includes("CLIENT"));
assert.equal(isClientAccess({ access_level: "CLIENT" }), true);
assert.equal(canOperate({ access_level: "CLIENT" }), false, "cliente nunca opera");
assert.equal(isAdminOrAbove({ access_level: "CLIENT" }), false);
assert.equal(isSquadScoped({ access_level: "CLIENT" }), false, "cliente não é escopo de Squad");
assert.equal(canOperate({ access_level: "USER" }), true, "USER continua operando");

// Saúde do chip.
const NOW = new Date("2026-10-08T12:00:00Z").getTime();
const ago = (days) => new Date(NOW - days * 86400000).toISOString();
assert.equal(chipHealth({ status: "ACTIVE" }, [], NOW).level, CHIP_HEALTH.OK);
assert.deepEqual(chipHealth({ status: "BLOCKED" }, [], NOW), { level: "CRITICAL", reasons: ["Bloqueado"] });
assert.deepEqual(chipHealth({ status: "ACTIVE", restriction: "NO_AREA" }, [], NOW).reasons, ["Sem área"]);
assert.equal(chipHealth({ status: "ACTIVE" }, [{ status: "OPEN", createdAt: ago(1) }], NOW).level, "CRITICAL");
assert.deepEqual(chipHealth({ status: "WARMING", restriction: "SEND_LIMIT" }, [], NOW), { level: "ATTENTION", reasons: ["Em aquecimento", "Limitação no envio"] });
assert.equal(chipHealth({ status: "ACTIVE" }, [{ status: "RESOLVED", createdAt: ago(3) }], NOW).level, "ATTENTION", "queda recente pede atenção");
assert.equal(chipHealth({ status: "ACTIVE" }, [{ status: "RESOLVED", createdAt: ago(20) }], NOW).level, "OK", "queda antiga resolvida não pesa");
assert.equal(chipHealth({ status: "ACTIVE", archived: true }, [], NOW).level, "INACTIVE");

// Montagem da tela a partir da resposta de client_portal().
const raw = {
  client: { id: "zig", name: "Zig - Rafa" },
  generatedAt: ago(0),
  campaigns: [
    { id: "k1", name: "Live Zig", status: "ACTIVE", stage: "TA_ROLANDO_POS_LIVE", startedAt: ago(15), endedAt: null },
    { id: "k0", name: "Live antiga", status: "CLOSED", stage: "CAPTACAO", startedAt: ago(60), endedAt: ago(40) },
  ],
  chips: [
    { id: "n1", phone: "5511999990001", identification: "CHIP 1", status: "ACTIVE", archived: false, location: "Celular 01", groupCount: 40, restriction: null, links: [{ campaignId: "k1", role: "PRIMARY", startedAt: ago(10), endedAt: null }] },
    { id: "n2", phone: "5511999990002", identification: "CHIP 2", status: "ACTIVE", archived: false, location: null, groupCount: 3, restriction: null, links: [{ campaignId: "k0", role: "BACKUP", startedAt: ago(60), endedAt: ago(40) }] },
  ],
  outages: [{ id: "i1", numberId: "n1", campaignId: "k1", status: "OPEN", createdAt: ago(1), resolvedAt: null }],
  externalChips: [{ id: "e1", phone: "5511999990009", campaignId: "k1", linkedAt: ago(3), endedAt: null, alerts: [ago(1), ago(10)] }],
};
const view = buildPortalView(raw, NOW);
assert.equal(view.chips[0].id, "n1", "chips críticos primeiro");
assert.equal(view.chips[0].health.level, "CRITICAL");
assert.deepEqual(view.chips[0].currentLinks.map((link) => [link.campaignName, link.roleLabel]), [["Live Zig", "Principal/Disparo"]]);
assert.equal(view.chips[1].lastCampaignName, "Live antiga");
assert.equal(view.campaigns[0].id, "k1", "campanhas ativas antes das encerradas");
assert.equal(view.campaigns[0].stageLabel, "Tá rolando / Pós live");
assert.equal(view.campaigns[1].stageLabel, "Encerrada");
assert.deepEqual(view.summary, { chips: 3, inCampaignNow: 2, needAttention: 1, openOutages: 1, outages7d: 2 });
assert.equal(view.outages[0].phone, "5511999990001");
assert.equal(view.externalChips[0].alerts7d, 1);

const html = renderClientPortal(view);
for (const expected of ["Zig - Rafa", "Celular 01", "Live Zig", "Principal/Disparo", ">40<", "Crítico", "Queda em aberto", "Em aberto", "Outros chips acompanhados"]) {
  assert.ok(html.includes(expected), `portal mostra ${expected}`);
}
assert.ok(!/data-action="(edit|archive|add|close|hard-delete)"/.test(html), "portal não tem nenhuma ação de edição");
assert.ok(!html.includes("Pré-visualização"));
assert.ok(renderClientPortal(view, { preview: true }).includes("Pré-visualização"));
assert.ok(renderClientPortal(buildPortalView({ client: { name: "<b>X</b>" } }, NOW)).includes("&lt;b&gt;X&lt;/b&gt;"), "nome é escapado");
assert.ok(renderClientPortalError("<x>").includes("&lt;x&gt;"));

// Serviço: chama a RPC certa; parâmetro de cliente só na pré-visualização; erro amigável.
{
  const calls = [];
  const service = new ClientPortalService({ rpc: async (name, args) => { calls.push([name, args]); return { data: raw, error: null }; } });
  await service.load();
  await service.load("zig");
  assert.deepEqual(calls, [["client_portal", {}], ["client_portal", { p_client_id: "zig" }]]);
  const denied = new ClientPortalService({ rpc: async () => ({ data: null, error: { code: "42501", message: "x" } }) });
  await assert.rejects(() => denied.load(), /acesso de cliente ainda não foi configurado/);
}

// Controller: renderiza, mostra erro sem quebrar e liga o "Atualizar".
{
  let clicked = null;
  const content = { innerHTML: "", querySelector: () => ({ addEventListener: (_event, handler) => { clicked = handler; } }) };
  const ok = new ClientPortalController({ service: { load: async () => view }, content, win: null });
  await ok.render();
  assert.ok(content.innerHTML.includes("Zig - Rafa"));
  assert.equal(typeof clicked, "function");
  const failing = new ClientPortalController({ service: { load: async () => { throw new Error("fora do ar"); } }, content, win: null });
  await failing.render();
  assert.ok(content.innerHTML.includes("fora do ar"));
}

// Convite e edição de usuário CLIENT: exige cliente, nunca grava Squad.
{
  const saved = [];
  const repo = { list: async () => [], upsert: async (row) => { saved.push(row); return row; } };
  const service = new SignupAuthorizationsService(repo);
  const master = { id: "m1", access_level: "MASTER" };
  await assert.rejects(() => service.create({ email: "zig@cliente.com", accessLevel: "CLIENT" }, master), /Selecione o cliente/);
  await service.create({ email: "zig@cliente.com", accessLevel: "CLIENT", squadId: "s1", clientId: "zig" }, master);
  assert.equal(saved[0].client_id, "zig");
  assert.equal(saved[0].squad_id, null);
  await service.create({ email: "user@empresa.com", accessLevel: "USER", squadId: "s1", clientId: "zig" }, master);
  assert.equal(saved[1].client_id, null, "acesso interno nunca guarda cliente");
  assert.equal(saved[1].squad_id, "s1");
}
{
  const updates = [];
  const profiles = [{ id: "m1", name: "M", access_level: "MASTER", status: "ACTIVE" }, { id: "c1", name: "C", access_level: "USER", status: "ACTIVE", squad_id: "s1" }];
  const service = new ProfilesService({ list: async () => profiles, update: async (id, changes) => { updates.push(changes); return changes; } }, { list: async () => [] });
  const master = profiles[0];
  await assert.rejects(() => service.update("c1", { name: "C", job_title: "OTHER", status: "ACTIVE", access_level: "CLIENT" }, master), /Selecione o cliente/);
  await service.update("c1", { name: "C", job_title: "OTHER", status: "ACTIVE", access_level: "CLIENT", client_id: "zig", squad_id: "s1" }, master);
  assert.equal(updates[0].client_id, "zig");
  assert.equal(updates[0].squad_id, null);
}

// Telas de Usuários/Autorizações mostram o cliente; formulário alterna Cliente x Squad.
{
  const clients = [{ id: "zig", name: "Zig - Rafa" }];
  const form = renderSignupAuthorizationForm([], true, clients);
  assert.match(form, /value="CLIENT"/);
  assert.match(form, /data-client-field hidden>Cliente acompanhado<select class="input" name="clientId">/);
  assert.match(form, /<option value="zig">Zig - Rafa<\/option>/);
  assert.match(renderSignupAuthorizations([{ id: "a1", email: "zig@c.com", access_level: "CLIENT", client_id: "zig", status: "PENDING" }], [], clients), /Cliente: Zig - Rafa/);
  const profileForm = renderProfileForm({ id: "c1", access_level: "CLIENT", client_id: "zig", status: "ACTIVE", job_title: "OTHER" }, [], { access_level: "MASTER" }, clients);
  assert.match(profileForm, /<label data-client-field >Cliente acompanhado/);
  assert.match(profileForm, /<option value="zig" selected>Zig - Rafa<\/option>/);
  assert.match(profileForm, /<label data-squad-field hidden>Squad/);
  assert.match(renderProfiles({ profiles: [{ id: "c1", name: "C", email: "c@c.com", job_title: "OTHER", status: "ACTIVE", access_level: "CLIENT", client_id: "zig" }], squads: [], clients, currentProfile: { id: "m1", access_level: "MASTER" } }), /Cliente: Zig - Rafa/);
}

// Detalhe do cliente: atalho de pré-visualização (só MASTER/ADMIN via data-admin-only).
{
  const detail = renderDirectoryDetail("clients", { id: "zig", name: "Zig - Rafa", isActive: true, squadId: null }, [], [], [], [], [], []);
  assert.match(detail, /<a class="button button-quiet" href="#client-portal\/zig" data-admin-only>Ver como o cliente vê<\/a>/);
  const squadDetail = renderDirectoryDetail("locations", { id: "l1", name: "Celular 01", isActive: true }, [], [], [], [], [], []);
  assert.ok(!squadDetail.includes("client-portal"));
}

// app.js: CLIENT vai direto para o portal e nunca carrega o estado interno.
const app = await readFile(new URL("../src/js/app.js", import.meta.url), "utf8");
const clientBranch = app.slice(app.indexOf("if(isClientAccess(authenticated.profile))"), app.indexOf("content.innerHTML='<section class=\"directory-empty\"><div><h2>Carregando dados compartilhados"));
assert.ok(clientBranch.includes("return;"), "CLIENT encerra o bootstrap no portal");
assert.ok(app.indexOf("if(isClientAccess(authenticated.profile))") < app.indexOf("SupabaseStateRepository.create(supabase)"), "decide antes de carregar o estado compartilhado");
assert.ok(!clientBranch.includes("startBotNavBadge"), "cliente não liga o contador do Bot");
assert.match(clientBranch, /initPush\(repositories\.pushSubscriptions,authenticated\.profile\.id\)/, "cliente tem o sino, sem preferência de Squad");
const css = await readFile(new URL("../src/css/components.css", import.meta.url), "utf8");
assert.match(css, /\.app-shell\[data-access-level="CLIENT"\] \.sidebar/);
assert.match(css, /\.app-shell\[data-access-level="CLIENT"\] \[data-push-squads-trigger\]\{display:none!important\}/);
assert.doesNotMatch(css, /\.app-shell\[data-access-level="CLIENT"\] \[data-push-toggle\]/, "o sino aparece para o cliente");

console.log("Bloco 35 (Portal do cliente no frontend): todos os cenários passaram.");
