import { NUMBER_STATUSES } from "../config/constants.js";
import { createId, normalizePhone, now } from "./helpers.js";

export function createNumber({ phone, identification = "", status = NUMBER_STATUSES.INACTIVE, locationId = null, responsibleId = null, clientIds = [], groupIds = [], groupCount = 0, notes = "", restriction = null } = {}) {
  const timestamp = now();
  return { id: createId("number"), phone: normalizePhone(phone), identification, status, locationId, responsibleId, clientIds, groupIds, groupCount: Number.isInteger(Number(groupCount)) && Number(groupCount) >= 0 ? Number(groupCount) : 0, notes, restriction, archivedAt: null, createdAt: timestamp, updatedAt: timestamp };
}

/** Status operacional apto (independe de utilização/campanha). */
export function isAvailableForOperation(number) { return number.status === NUMBER_STATUSES.ACTIVE && !number.archivedAt; }

export const UTILIZATION = Object.freeze({ IN_USE: "IN_USE", AVAILABLE: "AVAILABLE", UNAVAILABLE: "UNAVAILABLE" });
export const UTILIZATION_LABELS = Object.freeze({ IN_USE: "Em uso", AVAILABLE: "Disponível", UNAVAILABLE: "Indisponível" });

/**
 * Utilização é DERIVADA (nunca armazenada):
 * - vínculo de campanha ativo => EM USO;
 * - sem vínculo ativo + operacionalmente apto => DISPONÍVEL;
 * - caso contrário (bloqueado/inativo/em análise/arquivado) => INDISPONÍVEL.
 */
export function getUtilization(number, hasActiveCampaignLink) {
  if (hasActiveCampaignLink) return UTILIZATION.IN_USE;
  if (isAvailableForOperation(number)) return UTILIZATION.AVAILABLE;
  return UTILIZATION.UNAVAILABLE;
}
