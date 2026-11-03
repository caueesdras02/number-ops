import { EDITABLE_NUMBER_STATUSES, NUMBER_STATUSES } from "../config/constants.js";
import { createSeedState } from "../data/seed-data.js";
import { createNumber, getUtilization, UTILIZATION } from "../models/number.js";
import { normalizePhone, now } from "../models/helpers.js";
import { describeBrazilianPhoneError } from "../models/phone.js";
import { assertHardDeletable, applyLocalHardDelete } from "../models/hard-delete.js";
import { matchesClientName } from "../models/client-naming.js";
import { HistoryService } from "./history-service.js";

export class NumbersService {
  constructor(repository, { hardDeletePort = null, scopeSquadId = null } = {}) {
    this.repository = repository;
    this.hardDeletePort = hardDeletePort;
    // Squad do USER/VIEWER logado (null = MASTER/ADMIN ou modo local, sem escopo). O RLS
    // (migrations 025-027) é quem isola de verdade; aqui só garantimos que um número
    // cadastrado/editado por um USER continue no Squad dele.
    this.scopeSquadId = scopeSquadId;
    this.state = repository.initialize();
    this.state.campaigns ??= [];
    this.state.numberCampaignLinks ??= [];
    this.state.numbers = (this.state.numbers ?? []).map((number) => ({ ...number, groupCount: number.groupCount ?? 0 }));
    this.state.clients = (this.state.clients ?? []).map((client) => ({ ...client, squadId: client.squadId ?? null }));
    this.state.responsibles = (this.state.responsibles ?? []).map((responsible) => ({ ...responsible, squadId: responsible.squadId ?? null }));
    this.state.locations = (this.state.locations ?? []).map((location) => ({ ...location, responsibleId: location.responsibleId ?? null }));
    this.history = new HistoryService(this);
    this.initializeSeed();
  }

  initializeSeed() {
    const isEmpty = this.state.numbers.length === 0 && this.state.locations.length === 0 && this.state.responsibles.length === 0;
    if (!this.state.meta?.seedApplied && isEmpty) {
      this.state = createSeedState();
      this.persist();
    }
  }

  hasActiveCampaignLink(numberId) {
    return this.state.numberCampaignLinks.some((link) => link.numberId === numberId && !link.endedAt);
  }

  /** Utilização derivada: EM USO (vínculo ativo) / DISPONÍVEL (apto e livre) / INDISPONÍVEL. */
  utilizationOf(numberOrId) {
    const number = typeof numberOrId === "string" ? this.getNumber(numberOrId) : numberOrId;
    if (!number) return UTILIZATION.UNAVAILABLE;
    return getUtilization(number, this.hasActiveCampaignLink(number.id));
  }

  /** Número "nomeado por cliente": identificação contém o nome de um Cliente cadastrado
   * (ex.: "CHIP ZIG 03" bate com o cliente ZIG) — "Tim" nunca conta (é operadora, não
   * cliente). Derivado por padrão (nunca armazenado): se a identificação ou o nome do
   * cliente mudar, o número troca de aba sozinho no próximo render — a MENOS que
   * clientNumberOverride esteja definido (true/false), caso em que a decisão manual
   * sempre vence a detecção automática por texto. */
  isClientNamed(number) {
    if (number.clientNumberOverride === true) return true;
    if (number.clientNumberOverride === false) return false;
    return matchesClientName(number.identification, this.state.clients);
  }

  /** Força manualmente (value: true/false) ou limpa (value: null, volta a ser automático) a
   * classificação de "número de cliente", independente do texto da identificação. */
  setClientNumberOverride(id, value) {
    const existing = this.getNumber(id);
    if (!existing) throw new Error("Número não encontrado.");
    if (existing.clientNumberOverride === value) return existing;
    const updated = { ...existing, clientNumberOverride: value, updatedAt: now() };
    this.state.numbers = this.state.numbers.map((number) => number.id === id ? updated : number);
    this.persist();
    const description = value === true ? "Marcado manualmente como número de cliente." : value === false ? "Marcado manualmente como fora de números de clientes." : "Classificação de número de cliente voltou a ser automática.";
    this.record(id, "CLIENT_NUMBER_OVERRIDE_CHANGED", description, { previousValue: existing.clientNumberOverride ?? null, newValue: value });
    return updated;
  }

  /** Lista principal — nunca inclui arquivados (Bloqueado = sempre arquivado agora, ver
   * archive()) nem números nomeados por cliente (ver isClientNamed / getClientNumbers),
   * pra não bagunçar a listagem com os dois casos especiais. */
  getNumbers(query = "", filters = {}) {
    return this.state.numbers.filter((number) => !number.archivedAt && !this.isClientNamed(number) && this.matchesNumberFilters(number, query, filters));
  }

  /** Aba "Arquivados" — só números bloqueados/arquivados, mesmos filtros de busca. */
  getArchivedNumbers(query = "", filters = {}) {
    return this.state.numbers.filter((number) => number.archivedAt && this.matchesNumberFilters(number, query, filters));
  }

  /** Aba "Números de Clientes" — identificação nomeada por cliente, ainda em operação
   * (arquivado tem prioridade e fica só em Arquivados). */
  getClientNumbers(query = "", filters = {}) {
    return this.state.numbers.filter((number) => !number.archivedAt && this.isClientNamed(number) && this.matchesNumberFilters(number, query, filters));
  }

  matchesNumberFilters(number, query, filters) {
    const normalizedQuery = normalizePhone(query);
    const matchesQuery = !normalizedQuery || number.phone.includes(normalizedQuery);
    // Um número pode ter vínculo ativo com várias campanhas ao mesmo tempo — precisa checar
    // TODOS os vínculos ativos, não só "o primeiro encontrado" (senão o filtro por campanha
    // perdia números que estão em mais de uma campanha simultaneamente).
    const matchesCampaign = !filters.campaignId || this.state.numberCampaignLinks.some((link) => link.numberId === number.id && !link.endedAt && link.campaignId === filters.campaignId);
    const matchesUtilization = !filters.utilization || this.utilizationOf(number) === filters.utilization;
    return matchesQuery && matchesCampaign && matchesUtilization && (!filters.status || number.status === filters.status) && (!filters.locationId || number.locationId === filters.locationId) && (!filters.responsibleId || number.responsibleId === filters.responsibleId) && (!filters.clientId || number.clientIds.includes(filters.clientId)) && (!filters.groupId || number.groupIds.includes(filters.groupId));
  }

  getNumbersFor(type, id) {
    if (type === "clients") return this.state.numbers.filter((number) => number.clientIds.includes(id));
    if (type === "groups") return this.state.numbers.filter((number) => number.groupIds.includes(id));
    if (type === "locations") return this.state.numbers.filter((number) => number.locationId === id);
    if (type === "responsibles") return this.state.numbers.filter((number) => number.responsibleId === id);
    return [];
  }

  getNumber(id) { return this.state.numbers.find((number) => number.id === id) ?? null; }
  getLocations() { return [...this.state.locations].filter((location) => location.isActive); }
  getResponsibles() { return [...this.state.responsibles].filter((responsible) => responsible.isActive); }
  getClients() { return [...this.state.clients].filter((client) => client.isActive); }
  getGroups() { return [...this.state.groups].filter((group) => group.isActive); }

  create(input, { historyDescription = "Número cadastrado.", historyMetadata = {} } = {}) {
    if (input.status !== undefined && !EDITABLE_NUMBER_STATUSES.includes(input.status)) {
      throw new Error("Status inválido. Um número novo nunca começa Bloqueado.");
    }
    const phone = this.validatePhone(input.phone);
    this.assertPhoneIsUnique(phone);
    const groupCount = this.validateGroupCount(input.groupCount);
    const groupIds = this.withScopeSquad(input.groupIds ?? []);
    const number = createNumber({ ...input, phone, groupCount, groupIds });
    this.state.numbers = [...this.state.numbers, number];
    this.persist();
    this.record(number.id, "NUMBER_CREATED", historyDescription, { newValue: number, ...historyMetadata });
    return number;
  }

  update(id, input) {
    const existing = this.getNumber(id);
    if (!existing) throw new Error("Número não encontrado.");
    // Só revalida o padrão do telefone (DDD/sequência/repetição) quando ele está de fato
    // mudando — evita travar a edição de outros campos (status, localização, notas...) de
    // um número legado cujo telefone já estava gravado antes desta checagem mais rigorosa
    // existir.
    const normalizedInput = normalizePhone(input.phone);
    const phone = normalizedInput === existing.phone ? existing.phone : this.validatePhone(input.phone);
    this.assertPhoneIsUnique(phone, id);
    const groupCount = this.validateGroupCount(input.groupCount ?? existing.groupCount ?? 0);
    // Bloqueado só é alcançado via archive() (sempre junto com archivedAt) — nunca por edição
    // direta de status, senão reabriria o estado contraditório "bloqueado mas não arquivado".
    if (input.status !== undefined && input.status !== existing.status && !EDITABLE_NUMBER_STATUSES.includes(input.status)) {
      throw new Error("Status inválido. Use \"Arquivar\" para marcar como Bloqueado.");
    }
    const updated = {
      ...existing,
      phone,
      identification: (input.identification ?? existing.identification ?? "").trim(),
      status: input.status ?? existing.status,
      locationId: input.locationId || null,
      responsibleId: input.responsibleId || null,
      clientIds: input.clientIds ?? existing.clientIds ?? [],
      // Número que já está no Squad do USER não sai dele por uma edição (número de "estoque",
      // sem Squad, não é puxado automaticamente — só quando a pessoa marca o Squad).
      groupIds: (existing.groupIds ?? []).includes(this.scopeSquadId) ? this.withScopeSquad(input.groupIds ?? existing.groupIds ?? []) : input.groupIds ?? existing.groupIds ?? [],
      groupCount,
      notes: (input.notes ?? existing.notes ?? "").trim(),
      updatedAt: now(),
    };
    this.state.numbers = this.state.numbers.map((number) => number.id === id ? updated : number);
    this.persist();
    this.recordChanges(existing, updated);
    return updated;
  }

  archive(id) {
    const existing = this.getNumber(id);
    if (!existing) throw new Error("Número não encontrado.");
    const endedAt = now();
    // Arquivar tira o número da operação — vínculos de campanha ativos precisam ser encerrados
    // junto, senão o número fica "arquivado" e "em uso em campanha" ao mesmo tempo (estado
    // contraditório). Mesmo padrão de CampaignsService.close().
    this.state.numberCampaignLinks.filter((link) => link.numberId === id && !link.endedAt).forEach((link) => {
      link.endedAt = endedAt;
      link.updatedAt = endedAt;
      this.record(id, "CAMPAIGN_LEFT", "Número saiu da campanha.", { previousValue: link.campaignId, newValue: null });
    });
    const archived = { ...existing, status: NUMBER_STATUSES.BLOCKED, archivedAt: endedAt, updatedAt: endedAt };
    this.state.numbers = this.state.numbers.map((number) => number.id === id ? archived : number);
    this.persist();
    this.record(id, "NUMBER_ARCHIVED", "Número arquivado.", { previousValue: { status: existing.status, archivedAt: existing.archivedAt }, newValue: { status: archived.status, archivedAt: archived.archivedAt } });
    return archived;
  }

  restore(id, status = NUMBER_STATUSES.ACTIVE) {
    const existing = this.getNumber(id);
    if (!existing) throw new Error("Número não encontrado.");
    const restored = { ...existing, status, archivedAt: null, updatedAt: now() };
    this.state.numbers = this.state.numbers.map((number) => number.id === id ? restored : number);
    this.persist();
    this.record(id, "NUMBER_RESTORED", "Número desarquivado.", { previousValue: { status: existing.status, archivedAt: existing.archivedAt }, newValue: { status: restored.status, archivedAt: restored.archivedAt } });
    return restored;
  }

  markUnderReview(id) {
    const existing = this.getNumber(id);
    if (!existing) throw new Error("Número não encontrado.");
    if (existing.status === NUMBER_STATUSES.UNDER_REVIEW) return existing;
    return this.update(id, { ...existing, status: NUMBER_STATUSES.UNDER_REVIEW });
  }

  /** Contrapartida de markUnderReview() — tira o número de "Em análise" de volta pra ativo. */
  endReview(id) {
    const existing = this.getNumber(id);
    if (!existing) throw new Error("Número não encontrado.");
    if (existing.status !== NUMBER_STATUSES.UNDER_REVIEW) return existing;
    return this.update(id, { ...existing, status: NUMBER_STATUSES.ACTIVE });
  }

  registerRestriction(id, input) {
    const existing = this.getNumber(id);
    if (!existing) throw new Error("Número não encontrado.");
    const kind = String(input.kind ?? "");
    const descriptions = { GROUP_CREATION: "Não consegue criar squads", SEND_LIMIT: "Limitação no envio", NO_AREA: "Sem área — número não pode ser utilizado", OTHER: "Outra restrição" };
    if (!descriptions[kind]) throw new Error("Selecione o tipo de restrição.");
    const description = String(input.description ?? "").trim();
    if (kind === "OTHER" && !description) throw new Error("Descreva a outra restrição.");
    const restriction = { kind, description: kind === "OTHER" ? description : descriptions[kind], recordedAt: now() };
    const updated = { ...existing, restriction, updatedAt: now() };
    this.state.numbers = this.state.numbers.map((number) => number.id === id ? updated : number);
    this.persist();
    this.record(id, "NUMBER_RESTRICTION_RECORDED", "Restrição operacional registrada.", { previousValue: existing.restriction ?? null, newValue: restriction });
    return updated;
  }

  removeRestriction(id) {
    const existing = this.getNumber(id);
    if (!existing) throw new Error("Número não encontrado.");
    if (!existing.restriction) return existing;
    const updated = { ...existing, restriction: null, updatedAt: now() };
    this.state.numbers = this.state.numbers.map((number) => number.id === id ? updated : number);
    this.persist();
    this.record(id, "NUMBER_RESTRICTION_REMOVED", "Restrição operacional removida.", { previousValue: existing.restriction, newValue: null });
    return updated;
  }

  /** Deriva cliente/squad da campanha vinculada, sem remover associações existentes nem duplicar IDs. */
  deriveClientAndSquad(numberId, { clientId = null, squadId = null } = {}) {
    const existing = this.getNumber(numberId);
    if (!existing) return existing;
    const clientIds = clientId && !existing.clientIds.includes(clientId) ? [...existing.clientIds, clientId] : existing.clientIds;
    const groupIds = squadId && !existing.groupIds.includes(squadId) ? [...existing.groupIds, squadId] : existing.groupIds;
    if (clientIds === existing.clientIds && groupIds === existing.groupIds) return existing;
    const updated = { ...existing, clientIds, groupIds, updatedAt: now() };
    this.state.numbers = this.state.numbers.map((number) => number.id === numberId ? updated : number);
    this.persist();
    if (clientIds !== existing.clientIds) this.record(numberId, "CLIENT_ASSOCIATED", "Cliente associado automaticamente pela campanha.", { newValue: clientId });
    if (groupIds !== existing.groupIds) this.record(numberId, "GROUP_ASSOCIATED", "Squad associado automaticamente pela campanha.", { newValue: squadId });
    return updated;
  }

  /** Exclusão definitiva (MASTER). Bloqueia se houver referências; remove no banco antes do estado local. */
  async hardDelete(id) {
    const existing = this.getNumber(id);
    if (!existing) throw new Error("Número não encontrado.");
    assertHardDeletable(this.state, "numbers", id);
    if (this.hardDeletePort?.numbers) await this.hardDeletePort.numbers.remove(id);
    applyLocalHardDelete(this.state, "numbers", id);
    this.persist();
    return existing;
  }

  withScopeSquad(groupIds) {
    return this.scopeSquadId && !groupIds.includes(this.scopeSquadId) ? [...groupIds, this.scopeSquadId] : groupIds;
  }

  /**
   * Desfaz no estado local um número recém-criado que o banco recusou (ex.: telefone já
   * cadastrado em outro Squad, invisível para este usuário). Sem isso o número e seu evento
   * de histórico ficariam no estado e TODO save seguinte tentaria reenviá-los e falharia.
   */
  discardUnsyncedNumber(id) {
    this.state.numbers = this.state.numbers.filter((number) => number.id !== id);
    this.state.historyEvents = this.state.historyEvents.filter((event) => event.numberId !== id);
  }

  persist() { return this.repository.save(this.state); }
  flush() { return this.repository.flush?.() ?? Promise.resolve(); }

  replaceState(state) { this.state = state; return this.persist(); }

  record(numberId, type, description, metadata) { this.history.add({ numberId, type, description, metadata }); }

  recordChanges(previous, next) {
    const fields = [["status", "NUMBER_STATUS_CHANGED", "Status alterado."], ["locationId", "NUMBER_LOCATION_CHANGED", "Localização alterada."], ["responsibleId", "NUMBER_RESPONSIBLE_CHANGED", "Responsável alterado."], ["groupCount", "GROUP_COUNT_CHANGED", "Quantidade de grupos alterada."]];
    fields.forEach(([field, type, description]) => { if (previous[field] !== next[field]) this.record(next.id, type, description, { previousValue: previous[field], newValue: next[field] }); });
    [["clientIds", "CLIENT", "Cliente"], ["groupIds", "GROUP", "Squad"]].forEach(([field, key, label]) => { const oldIds = previous[field] ?? [], newIds = next[field] ?? []; newIds.filter((id) => !oldIds.includes(id)).forEach((id) => this.record(next.id, `${key}_ASSOCIATED`, `${label} associado.`, { newValue: id })); oldIds.filter((id) => !newIds.includes(id)).forEach((id) => this.record(next.id, `${key}_REMOVED`, `${label} removido.`, { previousValue: id })); });
  }

  validatePhone(phone) {
    const normalized = normalizePhone(phone);
    const error = describeBrazilianPhoneError(normalized);
    if (error) throw new Error(error);
    return normalized;
  }

  validateGroupCount(value) {
    const normalized = value === "" || value === undefined || value === null ? 0 : Number(value);
    if (!Number.isInteger(normalized) || normalized < 0) throw new Error("A quantidade de grupos deve ser um número inteiro maior ou igual a zero.");
    return normalized;
  }

  assertPhoneIsUnique(phone, excludedId = null) {
    const duplicate = this.state.numbers.some((number) => number.phone === phone && number.id !== excludedId);
    if (duplicate) throw new Error("Este telefone já está cadastrado.");
  }
}
