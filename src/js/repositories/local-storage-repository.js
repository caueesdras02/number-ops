/** Adapter local; uma API futura pode implementar a mesma interface. */
export class LocalStorageRepository {
  constructor(storageKey, storage = globalThis.localStorage) { this.storageKey = storageKey; this.storage = storage; }
  read(fallback) { const serialized = this.storage.getItem(this.storageKey); if (!serialized) return fallback; try { return JSON.parse(serialized); } catch { return fallback; } }
  save(state) { this.storage.setItem(this.storageKey, JSON.stringify(state)); }
  clear() { this.storage.removeItem(this.storageKey); }
}
