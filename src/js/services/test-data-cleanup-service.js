import { BackupService } from './backup-service.js';

const CLEANUP_KEY = 'testDataCleanup20260829';
const BACKUP_KEY = 'before-test-data-cleanup';
const TEST_PHONES = new Set(['5511999990101', '5511988880202', '5521997770303', '5531996660404', '5581992132272']);

export class TestDataCleanupService {
  constructor(numbersService) { this.numbers = numbersService; this.backup = new BackupService(numbersService); }
  run() {
    if (this.numbers.state.meta?.[CLEANUP_KEY]) return { ...this.numbers.state.meta[CLEANUP_KEY], alreadyCompleted: true };
    const targets = this.numbers.state.numbers.filter((number) => TEST_PHONES.has(number.phone));
    this.backup.createRecoverySnapshot(BACKUP_KEY);
    const targetIds = new Set(targets.map((number) => number.id));
    const incidentsRemoved = this.numbers.state.incidents.filter((incident) => targetIds.has(incident.numberId)).length;
    const historyEventsRemoved = this.numbers.state.historyEvents.filter((event) => targetIds.has(event.numberId)).length;
    this.numbers.state.numbers = this.numbers.state.numbers.filter((number) => !targetIds.has(number.id));
    this.numbers.state.incidents = this.numbers.state.incidents.filter((incident) => !targetIds.has(incident.numberId));
    this.numbers.state.historyEvents = this.numbers.state.historyEvents.filter((event) => !targetIds.has(event.numberId));
    const report = { removedNumbers: targets.map((number) => ({ id: number.id, phone: number.phone, identification: number.identification })), incidentsRemoved, historyEventsRemoved, backupKey: BACKUP_KEY, completedAt: new Date().toISOString() };
    this.numbers.state.meta = { ...this.numbers.state.meta, [CLEANUP_KEY]: report };
    this.numbers.persist();
    return report;
  }
}
