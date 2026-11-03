export const APP_STORAGE_KEY = "number-ops:state";
export const SCHEMA_VERSION = 2;
export const NUMBER_STATUSES = Object.freeze({ ACTIVE: "ACTIVE", WARMING: "WARMING", UNDER_REVIEW: "UNDER_REVIEW", BLOCKED: "BLOCKED" });
// Status selecionáveis livremente no formulário de edição. BLOCKED fica de fora de
// propósito: só é alcançado via "Arquivar" (MASTER), que sempre o acompanha de
// archivedAt — BLOCKED e arquivado são a mesma coisa agora, nunca um sem o outro.
export const EDITABLE_NUMBER_STATUSES = Object.freeze([NUMBER_STATUSES.ACTIVE, NUMBER_STATUSES.WARMING, NUMBER_STATUSES.UNDER_REVIEW]);
export const INCIDENT_STATUSES = Object.freeze({ OPEN: "OPEN", RESOLVED: "RESOLVED" });
export const INCIDENT_TYPES = Object.freeze({ RESTRICTION: "RESTRICTION", FALL: "FALL", BLOCK: "BLOCK", CHIP_ISSUE: "CHIP_ISSUE", DEVICE_ISSUE: "DEVICE_ISSUE", OTHER: "OTHER" });
