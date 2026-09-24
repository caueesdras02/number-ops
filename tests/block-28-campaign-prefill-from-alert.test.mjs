import assert from "node:assert/strict";
import { setPendingCampaignPrefill, takePendingCampaignPrefill } from "../src/js/models/pending-campaign-prefill.js";
import { renderBotEventDetail } from "../src/js/ui/bot-view.js";
import { renderCampaignForm } from "../src/js/ui/campaigns-view.js";

// ---------------------------------------------------------------------------
// BLOCO 28 — atalho "Campanha ainda não existe? Criar nova", a partir de um
// evento do Telegram não pertencente à operação: leva Nome/Empresa/Conta do
// Cliente pro form de Nova Campanha (nunca cria a campanha sozinho — quem
// confirma e salva é sempre a pessoa).
// ---------------------------------------------------------------------------

// 1) pending-campaign-prefill: take() consome E limpa — nunca "sobra" pra uma navegação futura
{
  assert.equal(takePendingCampaignPrefill(), null, "nada pendente por padrão");
  setPendingCampaignPrefill({ name: "Live X", empresa: "Zig Online", contaCliente: "Dhenny novo" });
  const taken = takePendingCampaignPrefill();
  assert.deepEqual(taken, { name: "Live X", empresa: "Zig Online", contaCliente: "Dhenny novo" });
  assert.equal(takePendingCampaignPrefill(), null, "segunda leitura já vem vazia — consumido só uma vez");
}

// 2) renderBotEventDetail: botão "Criar nova" só aparece quando IGNORED_NOT_OWNED + canModify
{
  const event = {
    id: "e1", eventType: "CONNECTIVITY_ALERT", processingStatus: "IGNORED_NOT_OWNED", phoneNormalized: "5581914101890",
    number: null, campaign: null, incident: null, linkedIncidentId: null, campaignId: null, numberId: null, externalRecord: null,
    metadata: { empresa: "Zig Online", liveshop: "Mega Feirão de fábrica", contaCliente: "Dhenny novo" },
    existingExternalLinks: [], receivedAt: "2026-01-01T00:00:00.000Z",
  };
  const html = renderBotEventDetail(event, { canModify: true, availableCampaigns: [] });
  assert.match(html, /data-action="bot-create-campaign" data-id="e1"/);

  const readOnlyHtml = renderBotEventDetail(event, { canModify: false, availableCampaigns: [] });
  assert.doesNotMatch(readOnlyHtml, /data-action="bot-create-campaign"/, "VIEWER não vê o atalho de criar campanha");

  const pendingEvent = { ...event, processingStatus: "PENDING_ASSOCIATION" };
  assert.doesNotMatch(renderBotEventDetail(pendingEvent, { canModify: true, availableCampaigns: [] }), /data-action="bot-create-campaign"/, "só oferece depois de classificado como externo");
}

// 3) renderCampaignForm: aviso de pré-preenchimento aparece só pra campanha NOVA sem Cliente já
//    resolvido; some quando o Cliente já veio pré-selecionado (nada a conferir) ou quando é edição
{
  const withPrefillNoMatch = renderCampaignForm({ item: { name: "Mega Feirão de fábrica" }, clients: [], squads: [], prefillHint: { name: "Mega Feirão de fábrica", empresa: "Zig Online", contaCliente: "Dhenny novo" } });
  assert.match(withPrefillNoMatch, /form-prefill-note/);
  assert.match(withPrefillNoMatch, /Zig Online/);
  assert.match(withPrefillNoMatch, /Dhenny novo/);
  assert.match(withPrefillNoMatch, /value="Mega Feirão de fábrica"/, "nome vem preenchido no campo");

  const withPrefillMatched = renderCampaignForm({ item: { name: "X", clientId: "client1" }, clients: [{ id: "client1", name: "Zig Online", squadId: "squad1" }], squads: [], prefillHint: { name: "X", empresa: "Zig Online" } });
  assert.doesNotMatch(withPrefillMatched, /form-prefill-note/, "sem nada a conferir quando o Cliente já foi resolvido automaticamente");

  const withoutPrefill = renderCampaignForm({ item: {}, clients: [], squads: [] });
  assert.doesNotMatch(withoutPrefill, /form-prefill-note/);

  const editingExisting = renderCampaignForm({ item: { id: "camp1", name: "X" }, clients: [], squads: [], prefillHint: { empresa: "Não deveria aparecer" } });
  assert.doesNotMatch(editingExisting, /form-prefill-note/, "prefillHint nunca é usado editando uma campanha já existente");
}

console.log("Bloco 28 (atalho criar campanha a partir de alerta externo): todos os cenários passaram.");
