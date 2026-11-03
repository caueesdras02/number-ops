import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatBadgeCount, renderBotNavBadge, updateBotNavBadge, startBotNavBadge } from "../src/js/ui/bot-nav-badge.js";
import { BotService } from "../src/js/services/bot-service.js";
import { SupabaseRepository } from "../src/js/repositories/supabase-repository.js";

// ---------------------------------------------------------------------------
// BLOCO 33 — contador de alertas pendentes da Central Number Ops Bot no menu lateral.
// ---------------------------------------------------------------------------

// Formato: nada quando zero, número quando há pendentes, "99+" acima de 99.
assert.equal(renderBotNavBadge(0), "");
assert.equal(renderBotNavBadge(null), "");
assert.match(renderBotNavBadge(1), /data-bot-nav-badge[^>]*aria-label="1 alerta pendente sem número associado"[^>]*>1<\/span>/);
assert.match(renderBotNavBadge(7), /7 alertas pendentes/);
assert.equal(formatBadgeCount(150), "99+");
assert.equal(formatBadgeCount(99), "99");

// updateBotNavBadge: insere/troca/remove o contador no link e o ponto no botão do menu mobile.
function fakeRoot() {
  const link = { html: "", badgeRemoved: 0,
    querySelector: (selector) => (selector === "[data-bot-nav-badge]" && link.html ? { remove: () => { link.html = ""; link.badgeRemoved++; } } : null),
    insertAdjacentHTML: (_position, html) => { link.html = html; } };
  const classes = new Set();
  const toggle = { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } };
  const root = { querySelector: (selector) => (selector === '.navigation-link[data-view="bot"]' ? link : selector === "[data-mobile-nav-toggle]" ? toggle : null) };
  return { root, link, classes };
}
{
  const { root, link, classes } = fakeRoot();
  updateBotNavBadge(3, root);
  assert.match(link.html, />3<\/span>/);
  assert.ok(classes.has("has-pending-alerts"));
  updateBotNavBadge(5, root);
  assert.match(link.html, />5<\/span>/, "troca o valor, nunca duplica o contador");
  assert.equal(link.badgeRemoved, 1);
  updateBotNavBadge(0, root);
  assert.equal(link.html, "", "zerou: some o contador");
  assert.ok(!classes.has("has-pending-alerts"));
}

// startBotNavBadge: busca na hora; erro de rede mantém o último valor (nunca quebra o app).
{
  const { root, link } = fakeRoot();
  let calls = 0;
  const win = { setInterval: () => 0 };
  const refresh = startBotNavBadge(async () => { calls++; if (calls === 2) throw new Error("offline"); return 4; }, { root, win });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(link.html, />4<\/span>/);
  await refresh();
  assert.match(link.html, />4<\/span>/, "falha na contagem mantém o último valor");
}

// BotService.pendingCount: conta só PENDING_ASSOCIATION; sem repositório (modo local) é 0.
{
  const numbersService = { state: { numbers: [], campaigns: [], clients: [], incidents: [], numberCampaignLinks: [] } };
  const withCount = new BotService({ integrationEventsRepository: { count: async (equals) => (equals.processing_status === "PENDING_ASSOCIATION" ? 2 : -1) }, numbersService });
  assert.equal(await withCount.pendingCount(), 2);
  const listOnly = new BotService({ integrationEventsRepository: { list: async () => [{ processing_status: "PENDING_ASSOCIATION" }, { processing_status: "MATCHED" }, { processing_status: "PENDING_ASSOCIATION" }] }, numbersService });
  assert.equal(await listOnly.pendingCount(), 2);
  assert.equal(await new BotService({ integrationEventsRepository: null, numbersService }).pendingCount(), 0);
}

// SupabaseRepository.count: só contagem (head: true), com os filtros pedidos.
{
  const calls = [];
  const query = { eq(column, value) { calls.push(["eq", column, value]); return query; }, then: (resolve) => resolve({ count: 6, error: null }) };
  const client = { from: (table) => ({ select: (columns, options) => { calls.push(["select", table, columns, options]); return query; } }) };
  assert.equal(await new SupabaseRepository(client, "integration_events").count({ processing_status: "PENDING_ASSOCIATION" }), 6);
  assert.deepEqual(calls, [["select", "integration_events", "id", { count: "exact", head: true }], ["eq", "processing_status", "PENDING_ASSOCIATION"]]);
}

// CSS do contador existe (sidebar escura nos dois temas) e o app liga o contador.
const css = await readFile(new URL("../src/css/components.css", import.meta.url), "utf8");
assert.match(css, /\.nav-badge\{/);
assert.match(css, /\.mobile-menu-toggle\.has-pending-alerts::after/);
const app = await readFile(new URL("../src/js/app.js", import.meta.url), "utf8");
assert.match(app, /startBotNavBadge\(\(\)=>controllers\.bot\.service\.pendingCount\(\)\)/);

console.log("Bloco 33 (contador de pendentes da Central Number Ops Bot no menu): todos os cenários passaram.");
