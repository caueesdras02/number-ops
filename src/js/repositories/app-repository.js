import { APP_STORAGE_KEY, SCHEMA_VERSION } from "../config/constants.js";
import { createInitialState } from "../data/initial-state.js";
import { LocalStorageRepository } from "./local-storage-repository.js";
export class AppRepository {
  constructor(storage = new LocalStorageRepository(APP_STORAGE_KEY)) { this.storage = storage; }
  initialize() { const initialState = createInitialState(); const state = this.storage.read(initialState); return state.schemaVersion === SCHEMA_VERSION ? state : initialState; }
  save(state) { this.storage.save({ ...state, schemaVersion: SCHEMA_VERSION }); }
  saveRecoveryBackup(name, backup) { if (!globalThis.localStorage) return false; new LocalStorageRepository(`${APP_STORAGE_KEY}:recovery:${name}`).save(backup); return true; }
  readRecoveryBackup(name) { if (!globalThis.localStorage) return null; return new LocalStorageRepository(`${APP_STORAGE_KEY}:recovery:${name}`).read(null); }
}
