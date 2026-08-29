import { renderBackup } from '../ui/backup-view.js';
export class BackupController {
  constructor({ service, content }) { this.service = service; this.content = content; this.preview = null; this.message = ''; }
  render() {
    this.recovery = this.service.getRecoverySnapshot('before-test-data-cleanup') || this.service.getRecoverySnapshot('before-approved-spreadsheet-migration');
    this.content.innerHTML = renderBackup(this.preview, this.message, this.recovery, this.service.getMigrationReport());
    this.content.querySelector('[data-backup-export]')?.addEventListener('click', () => this.export());
    this.content.querySelector('[data-backup-recovery]')?.addEventListener('click', () => this.download(this.recovery));
    this.content.querySelector('[data-backup-file]')?.addEventListener('change', (event) => this.read(event.target.files[0]));
    this.content.querySelector('[data-backup-confirm]')?.addEventListener('click', () => this.restore());
    this.content.querySelector('[data-backup-cancel]')?.addEventListener('click', () => { this.preview = null; this.message = ''; this.render(); });
  }
  export() { this.download(this.service.createExport()); }
  download({ filename, json }) { const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = Object.assign(document.createElement('a'), { href: url, download: filename }); link.click(); URL.revokeObjectURL(url); }
  read(file) { if (!file) return; const reader = new FileReader(); reader.onload = () => { try { this.preview = this.service.inspect(reader.result); this.message = ''; } catch (error) { this.preview = null; this.message = error.message; } this.render(); }; reader.onerror = () => { this.preview = null; this.message = 'Não foi possível ler o arquivo selecionado.'; this.render(); }; reader.readAsText(file); }
  restore() { try { this.service.restore(this.preview); window.location.hash = '#dashboard'; window.location.reload(); } catch (error) { this.message = error.message; this.render(); } }
}
