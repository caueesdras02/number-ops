import { SCHEMA_VERSION } from '../config/constants.js';

const BACKUP_FORMAT_VERSION = 1;
const COLLECTIONS = ['numbers', 'clients', 'groups', 'responsibles', 'locations', 'incidents', 'historyEvents'];
const clone = (value) => JSON.parse(JSON.stringify(value));
const uniqueIds = (items) => new Set(items.map((item) => item.id));

export class BackupService {
  constructor(numbersService) { this.numbersService = numbersService; }
  createExport() {
    const today = new Date().toISOString().slice(0, 10);
    const backup = { kind: 'number-ops-backup', formatVersion: BACKUP_FORMAT_VERSION, exportedAt: new Date().toISOString(), state: clone(this.numbersService.state) };
    return { filename: `number-ops-backup-${today}.json`, json: JSON.stringify(backup, null, 2) };
  }
  createRecoverySnapshot(name) { const exported = this.createExport(); this.numbersService.repository.saveRecoveryBackup(name, JSON.parse(exported.json)); return exported; }
  getRecoverySnapshot(name) { const backup = this.numbersService.repository.readRecoveryBackup(name); return backup ? { filename: `number-ops-${name}.json`, json: JSON.stringify(backup, null, 2) } : null; }
  getMigrationReport() { return this.numbersService.state.meta?.approvedSpreadsheetMigration20260829 ?? null; }
  getCleanupReport() { return this.numbersService.state.meta?.testDataCleanup20260829 ?? null; }
  inspect(serialized) {
    let backup;
    try { backup = JSON.parse(serialized); } catch { throw new Error('O arquivo não contém um JSON válido.'); }
    const state = this.validate(backup);
    return { state: clone(state), exportedAt: backup.exportedAt, formatVersion: backup.formatVersion, summary: Object.fromEntries(COLLECTIONS.map((name) => [name, state[name].length])) };
  }
  restore(prepared) {
    const state = this.validate({ kind: 'number-ops-backup', formatVersion: BACKUP_FORMAT_VERSION, state: prepared.state });
    this.numbersService.replaceState(clone(state));
  }
  validate(backup) {
    if (!backup || typeof backup !== 'object' || backup.kind !== 'number-ops-backup') throw new Error('Este arquivo não é um backup do Number Ops.');
    if (backup.formatVersion !== BACKUP_FORMAT_VERSION) throw new Error('A versão deste backup não é compatível com esta versão do Number Ops.');
    const state = backup.state;
    if (!state || typeof state !== 'object' || state.schemaVersion !== SCHEMA_VERSION || !state.meta || typeof state.meta !== 'object') throw new Error('O estado do backup está incompleto ou é incompatível.');
    COLLECTIONS.forEach((name) => { if (!Array.isArray(state[name])) throw new Error(`O backup não possui a coleção obrigatória: ${name}.`); });
    COLLECTIONS.forEach((name) => { const values = state[name].map((item) => item?.id); if (values.some((id) => !id || typeof id !== 'string') || new Set(values).size !== values.length) throw new Error(`Há IDs ausentes ou duplicados em ${name}.`); });
    const ids = Object.fromEntries(COLLECTIONS.map((name) => [name, uniqueIds(state[name])]));
    state.numbers.forEach((number) => {
      if (!Array.isArray(number.clientIds) || !Array.isArray(number.groupIds)) throw new Error('Um Número possui associações inválidas.');
      if (number.locationId && !ids.locations.has(number.locationId)) throw new Error('Um Número referencia uma localização inexistente.');
      if (number.responsibleId && !ids.responsibles.has(number.responsibleId)) throw new Error('Um Número referencia um colaborador inexistente.');
      if (number.clientIds.some((id) => !ids.clients.has(id)) || number.groupIds.some((id) => !ids.groups.has(id))) throw new Error('Um Número possui Cliente ou Squad inexistente.');
    });
    state.incidents.forEach((incident) => { if (!ids.numbers.has(incident.numberId)) throw new Error('Uma Ocorrência referencia um Número inexistente.'); if (incident.responsibleId && !ids.responsibles.has(incident.responsibleId)) throw new Error('Uma Ocorrência referencia um colaborador inexistente.'); });
    state.historyEvents.forEach((event) => { if (!ids.numbers.has(event.numberId)) throw new Error('Um evento de Histórico referencia um Número inexistente.'); });
    return state;
  }
}
