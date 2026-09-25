import { renderDashboard } from '../ui/dashboard-view.js';
import { setPendingListFilter } from '../models/pending-list-filter.js';
export class DashboardController {
  constructor({ service, content }) { this.service = service; this.content = content; }
  render() {
    this.content.innerHTML = renderDashboard(this.service.getData());
    // Card de KPI que já vem com filtro (ver ui/dashboard-view.js) deixa o filtro pronto pra
    // Números/Ocorrências consumirem no próximo render — nunca navega pra lista genérica quando
    // já sabemos exatamente o que a pessoa quer ver.
    this.content.querySelectorAll('[data-target]').forEach((card) => card.addEventListener('click', () => {
      if (card.dataset.filter) setPendingListFilter(card.dataset.target, JSON.parse(card.dataset.filter));
      window.location.hash = card.dataset.target;
    }));
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const counters = this.content.querySelectorAll('[data-kpi-value]');
    const reveal = () => this.content.querySelector('.dashboard-polished')?.classList.add('is-loaded');
    if (reduceMotion) { counters.forEach((counter) => { counter.textContent = counter.dataset.kpiValue; }); reveal(); return; }
    const start = performance.now(), duration = 480;
    const tick = (now) => { const progress = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - progress, 3); counters.forEach((counter) => { counter.textContent = String(Math.round(Number(counter.dataset.kpiValue) * eased)); }); if (progress < 1) requestAnimationFrame(tick); else reveal(); };
    requestAnimationFrame(tick);
  }
}
