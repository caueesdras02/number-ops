import { INCIDENT_STATUSES } from "../config/constants.js";
import { createId, now } from "./helpers.js";
function createNamedEntity(prefix, { name, isActive = true } = {}) { const timestamp = now(); return { id: createId(prefix), name: String(name ?? "").trim(), isActive, createdAt: timestamp, updatedAt: timestamp }; }
export const createClient = (data) => createNamedEntity("client", data);
export const createGroup = (data) => createNamedEntity("group", data);
export const createResponsible = (data) => createNamedEntity("responsible", data);
export const createLocation = (data) => createNamedEntity("location", data);
export function createIncident({ numberId, type, responsibleId = null, description = "" } = {}) { const timestamp = now(); return { id: createId("incident"), numberId, type, responsibleId, description, status: INCIDENT_STATUSES.OPEN, resolvedAt: null, resolutionNotes: "", resolvedById: null, createdAt: timestamp, updatedAt: timestamp }; }
export function createHistoryEvent({ numberId, type, description, previousValue = null, newValue = null } = {}) { return Object.freeze({ id: createId("history"), numberId, type, description, previousValue, newValue, occurredAt: now() }); }
