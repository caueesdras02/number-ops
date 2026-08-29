import { NUMBER_STATUSES, INCIDENT_TYPES } from '../config/constants.js';
import { DirectoryService } from './directory-service.js';
import { HistoryService } from './history-service.js';
import { IncidentsService } from './incidents-service.js';
import { BackupService } from './backup-service.js';

const MIGRATION_KEY = 'approvedSpreadsheetMigration20260829';
const BACKUP_KEY = 'before-approved-spreadsheet-migration';
const CLIENTS = ['Lupo', 'Lupo Sport', 'First Class', 'Scala', 'Piñata'];
const records = [
  ['558131960366','BR DID','CELULAR 01','WhatsApp Business',['First Class','Scala','Lupo Sport'],'ACTIVE'],
  ['558138420251','BR DID','CELULAR 01','WhatsApp Business',['Lupo Sport','First Class','Scala','Lupo'],'ACTIVE'],
  ['5581994873880','CHIP CLARO',null,'',[],'UNDER_REVIEW','ERRO Chip não dá área','',true],
  ['5581999491914','CHIP 02','CELULAR 02','WhatsApp GB',[],'WARMING','','PRECISA AQUECER ANTES DE USAR'],
  ['5581994468820','CHIP 4','CELULAR 01','',['Lupo Sport','First Class','Piñata'],'ACTIVE'],
  ['5581994302764','CHIP 8','CELULAR LUIZA','',['Piñata','Lupo Sport','Scala'],'UNDER_REVIEW'],
  ['5581994114811','CHIP 12','CELULAR 01','WhatsApp',['Scala'],'ACTIVE'],
  ['5581994157537','CHIP 14','CELULAR LUIZA','',['Lupo Sport','First Class','Piñata','Lupo'],'ACTIVE'],
  ['5581920052119','CHIP 15','CELULAR 01','WhatsApp',[],'ACTIVE'],
  ['5581920052117','CHIP 16','CELULAR 03','WhatsApp Business',['Piñata','Lupo'],'ACTIVE'],
  ['5581920052113','CHIP 17','CELULAR 01','',[],'ACTIVE'],
  ['5581920052109','CHIP 18','CELULAR 01','',[],'ACTIVE'],
  ['5581920039975','CHIP 19',null,'',[],'UNDER_REVIEW','ERRO Chip não dá área','',true],
  ['5581920039972','CHIP 20',null,'',[],'UNDER_REVIEW','ERRO Chip não dá área','',true],
  ['5581920039942','CHIP 21','CELULAR 01','WhatsApp',['Lupo'],'ACTIVE','','Aquecidos (Adicionar contatos 21/08)'],
  ['5581920039930','CHIP 22','CELULAR 01','WhatsApp Business',['Lupo Sport'],'WARMING','','PRECISA AQUECER ANTES DE USAR'],
  ['5581920039968','CHIP 23','CELULAR 03','WhatsApp',['Lupo'],'ACTIVE','','Aquecidos (Adicionar contatos 21/08)'],
  ['5581920039951','CHIP 24',null,'',[],'UNDER_REVIEW','ERRO Chip não dá área','',true],
  ['5581920039943','CHIP 25','CELULAR 03','WhatsApp',['Lupo'],'ACTIVE'],
  ['5581920039925','CHIP 26','CELULAR 03','WhatsApp',['Lupo'],'ACTIVE','','Aquecidos (Adicionar contatos 21/08)'],
  ['5581920039928','CHIP 27',null,'',[],'UNDER_REVIEW','ERRO Chip não dá área','',true],
  ['5581920039980','CHIP 28','CELULAR 02','WhatsApp GB',['Lupo'],'ACTIVE','','Aquecidos (Adicionar contatos 21/08)'],
].map(([phone, identification, location, whatsapp, clients, status, obs = '', extra = '', incident = false]) => ({ phone, identification, location, whatsapp, clients, status, obs, extra, incident }));

const normalizedName = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
const notesFor = (record) => [
  'Importação inicial aprovada da planilha ORGANIZAÇÃO DOS NÚMEROS | LIVE SHOP TURBO.',
  record.whatsapp && `Tipo do WhatsApp: ${record.whatsapp}.`,
  record.whatsapp === 'WhatsApp GB' && 'Alerta de revisão: WhatsApp GB.',
  record.obs && `Observação original: ${record.obs}.`,
  record.extra && `Informação complementar original: ${record.extra}.`,
].filter(Boolean).join('\n');

export class ApprovedSpreadsheetMigrationService {
  constructor(numbersService) {
    this.numbers = numbersService;
    this.directory = new DirectoryService(numbersService);
    this.incidents = new IncidentsService(numbersService, new HistoryService(numbersService));
    this.backup = new BackupService(numbersService);
  }
  run() {
    const completed = this.numbers.state.meta?.[MIGRATION_KEY];
    if (completed) return { ...completed, alreadyCompleted: true };
    const report = { created: 0, reused: 0, ignored: 3, review: 3, clientsCreated: 0, clientsReused: 0, locationsCreated: 0, locationsReused: 0, incidentsCreated: 0, conflicts: [], skipped: ['CHIP TIM — DDD 60', 'CHIP 1 — telefone móvel aparente com 8 dígitos', 'CHIP 13 — telefone móvel aparente com 8 dígitos'], backupKey: BACKUP_KEY, completedAt: null };
    this.backup.createRecoverySnapshot(BACKUP_KEY);
    const clientIds = new Map();
    try { CLIENTS.forEach((name) => clientIds.set(name, this.ensure('clients', name, report))); } catch (error) { report.conflicts.push(`Clientes: ${error.message}`); }
    for (const record of records) {
      if (this.numbers.getNumbers(record.phone).length) { report.reused += 1; report.conflicts.push(`${record.identification}: telefone já existe; não foi sobrescrito.`); continue; }
      try {
        const locationId = record.location ? this.ensure('locations', record.location, report) : null;
        const ids = record.clients.map((name) => clientIds.get(name) || this.ensure('clients', name, report));
        const number = this.numbers.create({ phone: record.phone, identification: record.identification, status: record.status, locationId, responsibleId: null, clientIds: ids, groupIds: [], notes: notesFor(record) }, { historyDescription: 'Número importado da planilha aprovada.', historyMetadata: { source: 'ORGANIZAÇÃO DOS NÚMEROS | LIVE SHOP TURBO', identification: record.identification } });
        report.created += 1;
        if (record.incident) { this.incidents.create({ numberId: number.id, type: INCIDENT_TYPES.CHIP_ISSUE, title: 'Chip sem área', description: `Importado da planilha: ${record.obs}.` }); report.incidentsCreated += 1; }
      } catch (error) { report.conflicts.push(`${record.identification}: ${error.message}`); }
    }
    report.completedAt = new Date().toISOString();
    this.numbers.state.meta = { ...this.numbers.state.meta, [MIGRATION_KEY]: report };
    this.numbers.persist();
    return report;
  }
  ensure(type, name, report) {
    const matches = this.numbers.state[type].filter((item) => normalizedName(item.name) === normalizedName(name));
    if (matches.length > 1) throw new Error(`${type === 'clients' ? 'Cliente' : 'Localização'} duplicado(a) para “${name}”.`);
    if (matches.length === 1) { report[type === 'clients' ? 'clientsReused' : 'locationsReused'] += 1; return matches[0].id; }
    const item = this.directory.create(type, { name });
    report[type === 'clients' ? 'clientsCreated' : 'locationsCreated'] += 1;
    return item.id;
  }
}
