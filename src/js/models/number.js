import { NUMBER_STATUSES } from "../config/constants.js";
import { createId, normalizePhone, now } from "./helpers.js";

export function createNumber({ phone, identification = "", status = NUMBER_STATUSES.INACTIVE, locationId = null, responsibleId = null, clientIds = [], groupIds = [], groupCount = 0, notes = "", restriction = null } = {}) {
  const timestamp = now();
  return { id: createId("number"), phone: normalizePhone(phone), identification, status, locationId, responsibleId, clientIds, groupIds, groupCount: Number.isInteger(Number(groupCount)) && Number(groupCount) >= 0 ? Number(groupCount) : 0, notes, restriction, archivedAt: null, createdAt: timestamp, updatedAt: timestamp };
}
export function isAvailableForOperation(number) { return number.status === NUMBER_STATUSES.ACTIVE && !number.archivedAt; }
