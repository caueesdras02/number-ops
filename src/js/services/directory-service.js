import { createClient, createGroup, createResponsible, createLocation } from "../models/entities.js";
import { now } from "../models/helpers.js";

const creators = { clients: createClient, groups: createGroup, responsibles: createResponsible, locations: createLocation };

export class DirectoryService {
  constructor(numbersService) { this.numbersService = numbersService; }
  list(type, includeInactive = false) { return this.numbersService.state[type].filter((item) => includeInactive || item.isActive); }
  get(type, id) { return this.numbersService.state[type].find((item) => item.id === id) ?? null; }
  create(type, input) { const name = String(input.name ?? "").trim(); if (!name) throw new Error("Informe o nome."); const item = creators[type]({ ...input, name }); this.numbersService.state[type].push(item); this.numbersService.persist(); return item; }
  update(type, id, input) { const item = this.numbersService.state[type].find((entry) => entry.id === id); if (!item) throw new Error("Registro não encontrado."); Object.assign(item, { name: String(input.name ?? "").trim(), ...(type === "responsibles" ? { team: String(input.team ?? "").trim() } : {}), updatedAt: now() }); this.numbersService.persist(); return item; }
  archive(type, id) { const item = this.numbersService.state[type].find((entry) => entry.id === id); if (!item) throw new Error("Registro não encontrado."); item.isActive = false; item.updatedAt = now(); this.numbersService.persist(); }
  restore(type, id) { const item = this.get(type, id); if (!item) throw new Error("Registro não encontrado."); item.isActive = true; item.updatedAt = now(); this.numbersService.persist(); }
  flush() { return this.numbersService.flush(); }
}
