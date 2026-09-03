import { NUMBER_STATUSES, SCHEMA_VERSION } from "../config/constants.js";

const timestamp = "2026-08-01T09:00:00.000Z";

export function createSeedState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { seedApplied: true },
    locations: [
      { id: "location_mobile_01", name: "Celular 01", isActive: true, createdAt: timestamp, updatedAt: timestamp },
      { id: "location_stock", name: "Estoque", isActive: true, createdAt: timestamp, updatedAt: timestamp },
      { id: "location_maintenance", name: "Em manutenção", isActive: true, createdAt: timestamp, updatedAt: timestamp },
    ],
    responsibles: [
      { id: "responsible_ana", name: "Ana Lima", isActive: true, createdAt: timestamp, updatedAt: timestamp },
      { id: "responsible_bruno", name: "Bruno Santos", isActive: true, createdAt: timestamp, updatedAt: timestamp },
      { id: "responsible_camila", name: "Camila Rocha", isActive: true, createdAt: timestamp, updatedAt: timestamp },
    ],
    numbers: [
      { id: "number_demo_01", phone: "5511999990101", identification: "Operação comercial", status: NUMBER_STATUSES.ACTIVE, locationId: "location_mobile_01", responsibleId: "responsible_ana", clientIds: [], groupIds: [], notes: "Dado fictício para demonstração.", archivedAt: null, createdAt: timestamp, updatedAt: timestamp },
      { id: "number_demo_02", phone: "5511988880202", identification: "Prospecção", status: NUMBER_STATUSES.WARMING, locationId: "location_stock", responsibleId: "responsible_bruno", clientIds: [], groupIds: [], notes: "Dado fictício para demonstração.", archivedAt: null, createdAt: timestamp, updatedAt: timestamp },
      { id: "number_demo_03", phone: "5521997770303", identification: "Suporte", status: NUMBER_STATUSES.UNDER_REVIEW, locationId: "location_mobile_01", responsibleId: "responsible_camila", clientIds: [], groupIds: [], notes: "Dado fictício para demonstração.", archivedAt: null, createdAt: timestamp, updatedAt: timestamp },
      { id: "number_demo_04", phone: "5531996660404", identification: "Número anterior", status: NUMBER_STATUSES.INACTIVE, locationId: "location_maintenance", responsibleId: null, clientIds: [], groupIds: [], notes: "Dado fictício arquivado.", archivedAt: "2026-08-05T14:30:00.000Z", createdAt: timestamp, updatedAt: "2026-08-05T14:30:00.000Z" },
    ],
    clients: [],
    groups: [],
    incidents: [],
    historyEvents: [],
  };
}
