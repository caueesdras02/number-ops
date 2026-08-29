import { NUMBER_STATUSES } from "../config/constants.js";
import { createSeedState } from "../data/seed-data.js";
import { createNumber } from "../models/number.js";
import { normalizePhone, now } from "../models/helpers.js";
import { HistoryService } from "./history-service.js";

export class NumbersService {
  constructor(repository) {
    this.repository = repository;
    this.state = repository.initialize();
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

  getNumbers(query = "", filters = {}) {
    const normalizedQuery = normalizePhone(query);
    return this.state.numbers.filter((number) => {
      const matchesQuery = !normalizedQuery || number.phone.includes(normalizedQuery);
      const archiveFilter = filters.archiveFilter ?? "ALL";
      const matchesArchive = archiveFilter === "ARCHIVED" ? Boolean(number.archivedAt) : archiveFilter === "ACTIVE" ? !number.archivedAt : true;
      return matchesQuery && matchesArchive && (!filters.status || number.status === filters.status) && (!filters.locationId || number.locationId === filters.locationId) && (!filters.responsibleId || number.responsibleId === filters.responsibleId) && (!filters.clientId || number.clientIds.includes(filters.clientId)) && (!filters.groupId || number.groupIds.includes(filters.groupId));
    });
  }

  getNumbersFor(type, id) { const field = type === "clients" ? "clientIds" : "groupIds"; return this.state.numbers.filter((number) => number[field].includes(id)); }

  getNumber(id) { return this.state.numbers.find((number) => number.id === id) ?? null; }
  getLocations() { return [...this.state.locations].filter((location) => location.isActive); }
  getResponsibles() { return [...this.state.responsibles].filter((responsible) => responsible.isActive); }
  getClients() { return [...this.state.clients].filter((client) => client.isActive); }
  getGroups() { return [...this.state.groups].filter((group) => group.isActive); }

  create(input, { historyDescription = "Número cadastrado.", historyMetadata = {} } = {}) {
    const phone = this.validatePhone(input.phone);
    this.assertPhoneIsUnique(phone);
    const number = createNumber({ ...input, phone });
    this.state.numbers = [...this.state.numbers, number];
    this.persist();
    this.record(number.id, "NUMBER_CREATED", historyDescription, { newValue: number, ...historyMetadata });
    return number;
  }

  update(id, input) {
    const existing = this.getNumber(id);
    if (!existing) throw new Error("Número não encontrado.");
    const phone = this.validatePhone(input.phone);
    this.assertPhoneIsUnique(phone, id);
    const updated = {
      ...existing,
      phone,
      identification: input.identification.trim(),
      status: input.status ?? existing.status,
      locationId: input.locationId || null,
      responsibleId: input.responsibleId || null,
      clientIds: input.clientIds ?? existing.clientIds ?? [],
      groupIds: input.groupIds ?? existing.groupIds ?? [],
      notes: input.notes.trim(),
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
    const archived = { ...existing, status: NUMBER_STATUSES.INACTIVE, archivedAt: now(), updatedAt: now() };
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

  persist() { this.repository.save(this.state); }

  replaceState(state) { this.state = state; this.persist(); }

  record(numberId, type, description, metadata) { this.history.add({ numberId, type, description, metadata }); }

  recordChanges(previous, next) {
    const fields = [["status", "NUMBER_STATUS_CHANGED", "Status alterado."], ["locationId", "NUMBER_LOCATION_CHANGED", "Localização alterada."], ["responsibleId", "NUMBER_RESPONSIBLE_CHANGED", "Responsável alterado."]];
    fields.forEach(([field, type, description]) => { if (previous[field] !== next[field]) this.record(next.id, type, description, { previousValue: previous[field], newValue: next[field] }); });
    [["clientIds", "CLIENT", "Cliente"], ["groupIds", "GROUP", "Grupo"]].forEach(([field, key, label]) => { const oldIds = previous[field] ?? [], newIds = next[field] ?? []; newIds.filter((id) => !oldIds.includes(id)).forEach((id) => this.record(next.id, `${key}_ASSOCIATED`, `${label} associado.`, { newValue: id })); oldIds.filter((id) => !newIds.includes(id)).forEach((id) => this.record(next.id, `${key}_REMOVED`, `${label} removido.`, { previousValue: id })); });
  }

  validatePhone(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error("Informe o número de telefone.");
    if (!normalized.startsWith("55") || (normalized.length !== 12 && normalized.length !== 13)) throw new Error("Informe um telefone brasileiro com 55, DDD e 8 ou 9 dígitos.");
    return normalized;
  }

  assertPhoneIsUnique(phone, excludedId = null) {
    const duplicate = this.state.numbers.some((number) => number.phone === phone && number.id !== excludedId);
    if (duplicate) throw new Error("Este telefone já está cadastrado.");
  }
}
