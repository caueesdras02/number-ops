import assert from "node:assert/strict";
import { NUMBER_STATUSES, EDITABLE_NUMBER_STATUSES } from "../src/js/config/constants.js";
import { NumbersService } from "../src/js/services/numbers-service.js";
import { CampaignsService } from "../src/js/services/campaigns-service.js";
import { describePasswordError } from "../src/js/models/password.js";
import { AuthService } from "../src/js/services/auth-service.js";

// ---------------------------------------------------------------------------
// Unificação de status: INACTIVE não existe mais; BLOCKED fica de fora dos
// status editáveis livremente (só alcançável via archive()).
// ---------------------------------------------------------------------------
assert.deepEqual(Object.keys(NUMBER_STATUSES).sort(), ["ACTIVE", "BLOCKED", "UNDER_REVIEW", "WARMING"]);
assert.deepEqual(EDITABLE_NUMBER_STATUSES, ["ACTIVE", "WARMING", "UNDER_REVIEW"]);

const seedState = () => ({
  schemaVersion: 2, meta: { seedApplied: true },
  numbers: [
    { id: "n1", phone: "5511987654213", identification: "Chip 1", status: "ACTIVE", locationId: null, responsibleId: null, clientIds: [], groupIds: [], groupCount: 0, notes: "", restriction: null, archivedAt: null },
    { id: "n2", phone: "5511816273849", identification: "Chip 2 em análise", status: "UNDER_REVIEW", locationId: null, responsibleId: null, clientIds: [], groupIds: [], groupCount: 0, notes: "", restriction: null, archivedAt: null },
  ],
  clients: [{ id: "c1", name: "Cliente", squadId: "s1", isActive: true }],
  groups: [{ id: "s1", name: "Nexus", isActive: true }],
  responsibles: [{ id: "r1", name: "Pedro", team: "Nexus", squadId: "s1", isActive: true }],
  locations: [], incidents: [], historyEvents: [], campaigns: [], numberCampaignLinks: [],
});
const repository = (() => { let state = seedState(); return { initialize: () => JSON.parse(JSON.stringify(state)), save: (s) => { state = JSON.parse(JSON.stringify(s)); }, flush: () => Promise.resolve() }; })();
const numbers = new NumbersService(repository);
const campaigns = new CampaignsService(numbers);

// create()/update() nunca aceitam BLOCKED diretamente — só archive() chega lá.
assert.throws(() => numbers.create({ phone: "5511987654213", status: "BLOCKED" }), /nunca começa Bloqueado/);
assert.throws(() => numbers.update("n1", { ...numbers.getNumber("n1"), status: "BLOCKED" }), /Use "Arquivar"/);
assert.doesNotThrow(() => numbers.update("n1", { ...numbers.getNumber("n1"), notes: "ok" }), "editar outro campo continua livre");

// archive() é o único caminho pra BLOCKED, e sempre vem com archivedAt junto.
const campaign = campaigns.create({ name: "Campanha", clientId: "c1", squadId: "s1", responsibleId: "r1" });
campaigns.assign("n1", campaign.id, "PRIMARY");
numbers.archive("n1");
const archived = numbers.getNumber("n1");
assert.equal(archived.status, "BLOCKED");
assert.ok(archived.archivedAt, "archive() sempre seta archivedAt junto com BLOCKED");
assert.equal(campaigns.activeLinksFor("n1").length, 0, "vínculos ativos são encerrados ao arquivar");

// getNumbers() nunca inclui arquivados; getArchivedNumbers() só retorna arquivados.
assert.ok(!numbers.getNumbers().some((n) => n.id === "n1"), "número arquivado não aparece na listagem principal");
assert.ok(numbers.getArchivedNumbers().some((n) => n.id === "n1"), "número arquivado aparece na aba Arquivados");
assert.ok(!numbers.getArchivedNumbers().some((n) => n.id === "n2"), "número ativo não aparece na aba Arquivados");

// restore() tira de Arquivados e devolve pra operação.
numbers.restore("n1");
assert.equal(numbers.getNumber("n1").status, "ACTIVE");
assert.equal(numbers.getNumber("n1").archivedAt, null);
assert.ok(numbers.getNumbers().some((n) => n.id === "n1"), "restaurado volta a aparecer na listagem principal");

// ---------------------------------------------------------------------------
// endReview() — contrapartida de markUnderReview(), sem necessidade de editar
// manualmente o status pelo formulário.
// ---------------------------------------------------------------------------
assert.equal(numbers.getNumber("n2").status, "UNDER_REVIEW");
numbers.endReview("n2");
assert.equal(numbers.getNumber("n2").status, "ACTIVE", "endReview tira de Em análise e volta pra Ativo");
const beforeSecondCall = numbers.getNumber("n2").updatedAt;
numbers.endReview("n2");
assert.equal(numbers.getNumber("n2").updatedAt, beforeSecondCall, "endReview em número que não está em análise é no-op");

// ---------------------------------------------------------------------------
// Política de senha — 8+ caracteres, maiúscula, minúscula e número.
// ---------------------------------------------------------------------------
assert.match(describePasswordError("curta1A"), /pelo menos 8 caracteres/);
assert.match(describePasswordError("semmaiuscula1"), /letra maiúscula/);
assert.match(describePasswordError("SEMMINUSCULA1"), /letra minúscula/);
assert.match(describePasswordError("SemNumero"), /pelo menos um número/);
assert.equal(describePasswordError("Senha1234"), null);

const authRepository = {
  signUp: async (payload) => ({ user: { id: "u1" }, ...payload }),
  updatePassword: async () => ({}),
};
const authService = new AuthService(authRepository);
await assert.rejects(() => authService.register({ name: "X", email: "x@x.com", password: "fraca", jobTitle: "ANALYST" }), /pelo menos 8 caracteres/);
await assert.doesNotReject(() => authService.register({ name: "X", email: "x@x.com", password: "Senha1234", jobTitle: "ANALYST" }));
await assert.rejects(() => authService.updatePassword("fraca123"), /letra maiúscula/);
await assert.doesNotReject(() => authService.updatePassword("Senha1234"));

// ---------------------------------------------------------------------------
// Squad "reutiliza chips" — findClientCampaignGaps só acusa número associado ao
// cliente sem campanha ativa quando o squad do cliente é "exclusivo" (reusesChips:false).
// No reuso normal de chips (padrão, ou reusesChips:true explícito), isso é esperado e
// não deve aparecer.
// ---------------------------------------------------------------------------
const reuseState = {
  schemaVersion: 2, meta: { seedApplied: true },
  groups: [{ id: "sq-reuse", name: "Squad Reuso", isActive: true, reusesChips: true }, { id: "sq-exclusive", name: "Squad Exclusiva", isActive: true, reusesChips: false }],
  clients: [{ id: "cl-reuse", name: "Cliente Reuso", squadId: "sq-reuse", isActive: true }, { id: "cl-exclusive", name: "Cliente Exclusiva", squadId: "sq-exclusive", isActive: true }],
  responsibles: [{ id: "resp1", name: "Resp", isActive: true }],
  numbers: [
    { id: "nr1", phone: "5511988880011", identification: "Chip reuso", status: "ACTIVE", groupCount: 0, clientIds: ["cl-reuse"], groupIds: [], locationId: null, responsibleId: null, notes: "", restriction: null, archivedAt: null },
    { id: "nr2", phone: "5511988880022", identification: "Chip exclusivo", status: "ACTIVE", groupCount: 0, clientIds: ["cl-exclusive"], groupIds: [], locationId: null, responsibleId: null, notes: "", restriction: null, archivedAt: null },
  ],
  campaigns: [], numberCampaignLinks: [], incidents: [], historyEvents: [], locations: [],
};
let reusePersisted = structuredClone(reuseState);
const reuseNumbers = new NumbersService({ initialize: () => structuredClone(reusePersisted), save: (v) => { reusePersisted = structuredClone(v); } });
const reuseCampaigns = new CampaignsService(reuseNumbers);
const campForReuseClient = reuseCampaigns.create({ name: "Campanha Reuso", clientId: "cl-reuse", squadId: "sq-reuse", responsibleId: "resp1" });
const campForExclusiveClient = reuseCampaigns.create({ name: "Campanha Exclusiva", clientId: "cl-exclusive", squadId: "sq-exclusive", responsibleId: "resp1" });
const reuseGaps = reuseCampaigns.findClientCampaignGaps();
assert.ok(!reuseGaps.some((g) => g.numberId === "nr1"), "squad que reutiliza chips não deve gerar aviso de lacuna");
assert.ok(reuseGaps.some((g) => g.numberId === "nr2" && g.campaignId === campForExclusiveClient.id), "squad exclusivo deve gerar aviso de lacuna");

console.log("Bloco 25: unificação Bloqueado/Inativo, aba Arquivados, endReview, política de senha e reutilização de chips por squad validados.");
