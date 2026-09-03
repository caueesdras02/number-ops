import { APP_STORAGE_KEY, SCHEMA_VERSION } from "../config/constants.js";
import { createInitialState } from "../data/initial-state.js";
import { LocalStorageRepository } from "./local-storage-repository.js";
export class AppRepository {
  constructor(storage = new LocalStorageRepository(APP_STORAGE_KEY)) { this.storage = storage; }
  initialize() {
    const initialState = createInitialState();
    const stored = this.storage.read(initialState);
    const state = { ...initialState, ...stored, meta: { ...initialState.meta, ...(stored.meta ?? {}) } };
    for (const key of ["numbers", "clients", "groups", "responsibles", "locations", "incidents", "historyEvents", "campaigns", "numberCampaignLinks"]) if (!Array.isArray(state[key])) state[key] = [];
    state.numbers = state.numbers.map((number) => ({ groupCount: 0, clientIds: [], groupIds: [], restriction: null, ...number }));
    state.clients = state.clients.map((client) => ({ squadId: null, ...client }));
    state.schemaVersion = SCHEMA_VERSION;
    return state;
  }
  save(state) { this.storage.save({ ...state, schemaVersion: SCHEMA_VERSION }); }
  saveRecoveryBackup(name, backup) { if (!globalThis.localStorage) return false; new LocalStorageRepository(`${APP_STORAGE_KEY}:recovery:${name}`).save(backup); return true; }
  readRecoveryBackup(name) { if (!globalThis.localStorage) return null; return new LocalStorageRepository(`${APP_STORAGE_KEY}:recovery:${name}`).read(null); }
}
