import assert from "node:assert/strict";
import { NumbersService } from "../src/js/services/numbers-service.js";
import { CampaignsService, CAMPAIGN_STAGES, CAMPAIGN_STAGE_LABELS, effectiveCampaignStage } from "../src/js/services/campaigns-service.js";
import { renderCampaigns, renderCampaignDetail, stageMenuItemsFor } from "../src/js/ui/campaigns-view.js";
import { CampaignsController } from "../src/js/controllers/campaigns-controller.js";
import { computeMenuPosition } from "../src/js/ui/stage-dropdown.js";

// ---------------------------------------------------------------------------
// BLOCO 17 — etapa operacional da campanha. Modelo final: `stage` só existe
// (CAPTACAO/TA_ROLANDO_POS_LIVE) enquanto a campanha está ACTIVE; "Encerrada"
// nunca é gravada em `stage` — é sempre derivada de status='CLOSED'. Nenhuma
// rede/dado real é usado ou alterado.
// ---------------------------------------------------------------------------

function makeState() {
  return {
    schemaVersion: 2, meta: { seedApplied: true },
    groups: [{ id: "s1", name: "Squad Nexus", isActive: true }],
    clients: [{ id: "c1", name: "Cliente 1", squadId: "s1", isActive: true }],
    responsibles: [{ id: "r1", name: "Pedro Melo", team: "Nexus", isActive: true }],
    campaigns: [],
    numbers: [{ id: "n1", phone: "5511999999991", identification: "Chip 1", status: "ACTIVE", groupCount: 1, clientIds: ["c1"], groupIds: ["s1"], locationId: null, responsibleId: null, notes: "", restriction: null, archivedAt: null }],
    numberCampaignLinks: [], incidents: [], historyEvents: [], locations: [],
  };
}
function makeServices() {
  let persisted = structuredClone(makeState());
  const repository = { initialize: () => structuredClone(persisted), save: (value) => { persisted = structuredClone(value); } };
  const numbers = new NumbersService(repository);
  const campaigns = new CampaignsService(numbers);
  return { numbers, campaigns };
}

// 1) só duas etapas existem, na ordem certa, sem EM_ANDAMENTO/POS_LIVE isolada
{
  assert.deepEqual(CAMPAIGN_STAGES, ["CAPTACAO", "TA_ROLANDO_POS_LIVE"]);
  assert.equal(CAMPAIGN_STAGE_LABELS.TA_ROLANDO_POS_LIVE, "Tá rolando / Pós live", "é UMA etapa visual, não duas");
  assert.equal(CAMPAIGN_STAGE_LABELS.CAPTACAO, "Captação");
  assert.equal(CAMPAIGN_STAGE_LABELS.ENCERRADA, "Encerrada", "rótulo de exibição existe, mas nunca é um valor gravável em stage");
}

// 2) campanha nova nasce CAPTACAO + ACTIVE
{
  const { campaigns } = makeServices();
  const item = campaigns.create({ name: "Live do Lider", clientId: "c1", squadId: "s1", responsibleId: "r1" });
  assert.equal(item.stage, "CAPTACAO");
  assert.equal(item.status, "ACTIVE");
  assert.equal(effectiveCampaignStage(item), "CAPTACAO");
}

// 3) changeStage para TA_ROLANDO_POS_LIVE + ACTIVE; não encerra a campanha; não mexe em número/vínculo/responsável/cliente
{
  const { campaigns, numbers } = makeServices();
  const item = campaigns.create({ name: "Live do Lider", clientId: "c1", squadId: "s1", responsibleId: "r1" });
  campaigns.assign("n1", item.id, "PRIMARY");
  const numberBefore = structuredClone(numbers.getNumber("n1"));
  const linksBefore = structuredClone(numbers.state.numberCampaignLinks);
  const updated = campaigns.changeStage(item.id, "TA_ROLANDO_POS_LIVE");
  assert.equal(updated.stage, "TA_ROLANDO_POS_LIVE");
  assert.equal(updated.status, "ACTIVE", "mudar a etapa nunca encerra a campanha");
  assert.equal(effectiveCampaignStage(updated), "TA_ROLANDO_POS_LIVE");
  assert.deepEqual(numbers.getNumber("n1"), numberBefore);
  assert.deepEqual(numbers.state.numberCampaignLinks, linksBefore);
  assert.equal(campaigns.get(item.id).responsibleId, "r1");
  assert.equal(campaigns.get(item.id).clientId, "c1");
}

// 4) rejeita etapa fora da lista (inclusive ENCERRADA — não é um valor gravável em stage)
{
  const { campaigns } = makeServices();
  const item = campaigns.create({ name: "Live do Lider", clientId: "c1", squadId: "s1", responsibleId: "r1" });
  assert.throws(() => campaigns.changeStage(item.id, "ENCERRADA"), /etapa válida/i, "Encerrada nunca é gravada em stage — precisa ir pelo close()");
  assert.throws(() => campaigns.changeStage(item.id, "EM_ANDAMENTO"), /etapa válida/i, "EM_ANDAMENTO foi removido do modelo");
  assert.throws(() => campaigns.changeStage("id-inexistente", "CAPTACAO"), /não encontrada/i);
}

// 5) não é possível mudar a etapa de uma campanha já CLOSED (é preciso reabrir antes)
{
  const { campaigns } = makeServices();
  const item = campaigns.create({ name: "Live do Lider", clientId: "c1", squadId: "s1", responsibleId: "r1" });
  campaigns.close(item.id);
  assert.throws(() => campaigns.changeStage(item.id, "TA_ROLANDO_POS_LIVE"), /campanha ativa/i);
}

// 6) close() é o único caminho pra "Encerrada" — stage não muda, endedAt/status seguem exatamente como hoje;
//    CLOSED aparece como "Encerrada" via effectiveCampaignStage (status), não como valor gravado em stage
{
  const { campaigns } = makeServices();
  const item = campaigns.create({ name: "Live do Lider", clientId: "c1", squadId: "s1", responsibleId: "r1" });
  campaigns.changeStage(item.id, "TA_ROLANDO_POS_LIVE");
  const closed = campaigns.close(item.id);
  assert.equal(closed.status, "CLOSED");
  assert.ok(closed.endedAt, "endedAt continua funcionando como hoje");
  assert.equal(closed.stage, "TA_ROLANDO_POS_LIVE", "stage NÃO é sobrescrito ao encerrar — continua guardando a última etapa operacional");
  assert.equal(effectiveCampaignStage(closed), "ENCERRADA", "exibição usa o status estrutural, não um valor 'ENCERRADA' gravado");
}

// 7) reabrir preserva a última etapa operacional registrada, sem inventar outra
{
  const { campaigns } = makeServices();
  const item = campaigns.create({ name: "Live do Lider", clientId: "c1", squadId: "s1", responsibleId: "r1" });
  campaigns.changeStage(item.id, "TA_ROLANDO_POS_LIVE");
  campaigns.close(item.id);
  const reopened = campaigns.reactivate(item.id);
  assert.equal(reopened.status, "ACTIVE");
  assert.equal(reopened.endedAt, null);
  assert.equal(reopened.stage, "TA_ROLANDO_POS_LIVE", "reabrir preserva a etapa que já estava — não volta pra CAPTACAO nem inventa outra");
  assert.equal(effectiveCampaignStage(reopened), "TA_ROLANDO_POS_LIVE");
}

// 8) histórico de números permanece após encerrar (comportamento já existente, não regressivo)
{
  const { campaigns, numbers } = makeServices();
  const item = campaigns.create({ name: "Live do Lider", clientId: "c1", squadId: "s1", responsibleId: "r1" });
  campaigns.assign("n1", item.id, "PRIMARY");
  campaigns.close(item.id);
  const links = numbers.state.numberCampaignLinks.filter((link) => link.campaignId === item.id);
  assert.equal(links.length, 1, "vínculo não é apagado, só encerrado");
  assert.ok(links[0].endedAt);
}

// 9) filtro por etapa em list() só considera CAPTACAO/TA_ROLANDO_POS_LIVE
{
  const { campaigns } = makeServices();
  const a = campaigns.create({ name: "A", clientId: "c1", squadId: "s1", responsibleId: "r1" });
  const b = campaigns.create({ name: "B", clientId: "c1", squadId: "s1", responsibleId: "r1" });
  campaigns.changeStage(b.id, "TA_ROLANDO_POS_LIVE");
  assert.deepEqual(campaigns.list({ stage: "CAPTACAO" }).map((x) => x.id), [a.id]);
  assert.deepEqual(campaigns.list({ stage: "TA_ROLANDO_POS_LIVE" }).map((x) => x.id), [b.id]);
}

// 10) stageMenuItemsFor: ACTIVE oferece as 2 etapas + Encerrada; CLOSED não oferece nada (badge fica estático)
{
  const items = stageMenuItemsFor("ACTIVE");
  assert.deepEqual(items.map((i) => i.value), ["CAPTACAO", "TA_ROLANDO_POS_LIVE", "ENCERRADA"]);
  assert.deepEqual(stageMenuItemsFor("CLOSED"), []);
}

// 11) renderCampaigns: badge interativo (botão) quando ACTIVE+canEdit; estático quando CLOSED ou !canEdit
{
  const { campaigns } = makeServices();
  const active = campaigns.create({ name: "Ativa", clientId: "c1", squadId: "s1", responsibleId: "r1" });
  const toClose = campaigns.create({ name: "Vai fechar", clientId: "c1", squadId: "s1", responsibleId: "r1" });
  campaigns.close(toClose.id);

  const htmlCanEdit = renderCampaigns({ campaigns: campaigns.list(), clients: [], squads: [], responsibles: [], filters: { query: "", status: "", stage: "" }, canEdit: true });
  assert.match(htmlCanEdit, /data-action="stage-open" data-id="[^"]*"/, "campanha ACTIVE com canEdit vira botão interativo");
  assert.match(htmlCanEdit, /stage-static stage-encerrada/, "campanha CLOSED é sempre estática, mesmo com canEdit=true");
  assert.doesNotMatch(htmlCanEdit, /data-action="change-stage"/i, "badge de etapa não é mais um <select> nativo (só os filtros de Status/Etapa continuam sendo <select>)");

  const htmlViewer = renderCampaigns({ campaigns: campaigns.list(), clients: [], squads: [], responsibles: [], filters: { query: "", status: "", stage: "" }, canEdit: false });
  assert.doesNotMatch(htmlViewer, /data-action="stage-open"/, "VIEWER nunca vê o botão interativo, só o badge estático");
  assert.match(htmlViewer, /stage-static stage-captacao/);
}

// 12) renderCampaignDetail: mesmo padrão visual, badges de status+etapa juntos
{
  const { campaigns } = makeServices();
  const item = campaigns.create({ name: "Live do Lider", clientId: "c1", squadId: "s1", responsibleId: "r1" });
  const html = renderCampaignDetail({ item, clients: [], squads: [], responsibles: [], numbers: [], locations: [], links: [], canEdit: true });
  assert.match(html, /campaign-detail-badges/);
  assert.match(html, /data-action="stage-open" data-id="[^"]*"/);
}

// 13) CampaignsController.canEdit: local/offline (sem profile) = acesso total; VIEWER = leitura; demais = total
{
  const content = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
  assert.equal(new CampaignsController({ service: {}, content, currentProfile: null }).canEdit, true);
  assert.equal(new CampaignsController({ service: {}, content, currentProfile: { access_level: "VIEWER" } }).canEdit, false);
  assert.equal(new CampaignsController({ service: {}, content, currentProfile: { access_level: "USER" } }).canEdit, true);
  assert.equal(new CampaignsController({ service: {}, content, currentProfile: { access_level: "MASTER" } }).canEdit, true);
}

// 14) computeMenuPosition (popover customizado): abre pra baixo-esquerda por padrão; nunca sai da viewport
{
  const trigger = { top: 200, bottom: 220, left: 700, right: 780 };
  const menuSize = { width: 236, height: 160 };
  const viewport = { width: 1024, height: 768 };
  const pos = computeMenuPosition(trigger, menuSize, viewport);
  assert.equal(pos.top, 226, "abre embaixo do trigger (bottom + gap)");
  assert.equal(pos.left, trigger.right - menuSize.width, "abre pra esquerda: borda direita do menu alinhada com a do trigger");
  assert.ok(pos.left >= 0 && pos.left + menuSize.width <= viewport.width, "nunca sai da viewport horizontalmente");
}
{
  // trigger perto do topo da tela -> não cabe embaixo -> abre pra cima
  const trigger = { top: 10, bottom: 30, left: 700, right: 780 };
  const menuSize = { width: 236, height: 700 };
  const viewport = { width: 1024, height: 400 };
  const pos = computeMenuPosition(trigger, menuSize, viewport);
  assert.ok(pos.top < trigger.top, "sem espaço embaixo, abre pra cima do trigger");
  assert.ok(pos.top >= 0, "nunca sai da viewport verticalmente");
}
{
  // trigger perto da borda esquerda -> abrir pra esquerda cortaria -> cai pra alinhar pela esquerda do trigger
  const trigger = { top: 200, bottom: 220, left: 10, right: 90 };
  const menuSize = { width: 236, height: 160 };
  const viewport = { width: 1024, height: 768 };
  const pos = computeMenuPosition(trigger, menuSize, viewport);
  assert.ok(pos.left >= 0, "nunca corta a viewport pela esquerda");
}

console.log("Bloco 17 (etapa operacional da campanha): todos os cenários passaram.");
