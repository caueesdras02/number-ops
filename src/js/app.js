import { AppRepository } from "./repositories/app-repository.js";
import { NumbersService } from "./services/numbers-service.js";
import { NumbersController } from "./controllers/numbers-controller.js";
import { DirectoryController } from "./controllers/directory-controller.js";
import { DirectoryService } from "./services/directory-service.js";
import { HistoryService } from "./services/history-service.js";
import { IncidentsService } from "./services/incidents-service.js";
import { IncidentsController } from "./controllers/incidents-controller.js";
import { HistoryController } from "./controllers/history-controller.js";
import { DashboardService } from "./services/dashboard-service.js";
import { DashboardController } from "./controllers/dashboard-controller.js";
import { GuideController } from "./controllers/guide-controller.js";
import { BackupService } from "./services/backup-service.js";
import { BackupController } from "./controllers/backup-controller.js";
import { CampaignsService } from "./services/campaigns-service.js";
import { CampaignsController } from "./controllers/campaigns-controller.js";
import { ApprovedSpreadsheetMigrationService } from "./services/approved-spreadsheet-migration-service.js";
import { TestDataCleanupService } from "./services/test-data-cleanup-service.js";
import { getViewTitle, renderView } from "./ui/views.js";

const repository = new AppRepository();
const numbersService = new NumbersService(repository);
const spreadsheetMigrationReport = new ApprovedSpreadsheetMigrationService(numbersService).run();
if (spreadsheetMigrationReport.created || spreadsheetMigrationReport.alreadyCompleted) console.info('Migração inicial aprovada:', spreadsheetMigrationReport);
const testDataCleanupReport = new TestDataCleanupService(numbersService).run();
if (testDataCleanupReport.removedNumbers?.length || testDataCleanupReport.alreadyCompleted) console.info('Limpeza de dados de teste:', testDataCleanupReport);

const content = document.querySelector("#page-content");
const title = document.querySelector("#page-title");
const navigationLinks = document.querySelectorAll("[data-view]");
const appShell = document.querySelector(".app-shell");
const topbar = document.querySelector(".topbar");
const menuToggle = document.querySelector("[data-mobile-nav-toggle]");
const mobileNavClose = document.querySelector("[data-mobile-nav-close]");
const numbersController = new NumbersController({ service: numbersService, content });
const directoryService = new DirectoryService(numbersService);
const campaignsService = new CampaignsService(numbersService);
const directoryControllers = Object.fromEntries(["clients", "groups", "responsibles"].map((type) => [type, new DirectoryController({ service: directoryService, campaignsService, content, type })]));
const incidentsController = new IncidentsController({ service: new IncidentsService(numbersService, new HistoryService(numbersService)), numbers: numbersService, content });
const historyController = new HistoryController({ service: new HistoryService(numbersService), numbers: numbersService, content });
const dashboardController = new DashboardController({ service: new DashboardService(numbersService), content });
const guideController = new GuideController({ content });
const backupController = new BackupController({ service: new BackupService(numbersService), content });
const campaignsController = new CampaignsController({ service: campaignsService, content });

function showView(viewName) {
  const [view, resourceId] = viewName.split("/");
  if (view === "dashboard") dashboardController.render();
  else if (view === "numbers") resourceId ? numbersController.showDetail(resourceId) : numbersController.render();
  else if (view === "campaigns") resourceId ? campaignsController.detail(resourceId) : campaignsController.render();
  else if (directoryControllers[view]) directoryControllers[view].render();
  else if (view === "incidents") incidentsController.render();
  else if (view === "history") historyController.render();
  else if (view === "guide") guideController.render();
  else if (view === "backup") backupController.render();
  else content.innerHTML = renderView(view);
  title.textContent = getViewTitle(view);
  navigationLinks.forEach((link) => link.classList.toggle("is-active", link.dataset.view === view));
  setMobileNavigation(false);
}

function currentView() { return window.location.hash.slice(1) || "dashboard"; }
function setMobileNavigation(open) { appShell.classList.toggle("is-nav-open", open); menuToggle.setAttribute("aria-expanded", String(open)); menuToggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu"); }
function updateStickyHeader() { const compact = window.scrollY > 12; topbar.classList.toggle("is-compact", compact); appShell.classList.toggle("has-compact-header", compact); }

window.addEventListener("hashchange", () => showView(currentView()));
window.addEventListener("scroll", updateStickyHeader, { passive: true });
menuToggle.addEventListener("click", () => setMobileNavigation(!appShell.classList.contains("is-nav-open")));
mobileNavClose.addEventListener("click", () => setMobileNavigation(false));
navigationLinks.forEach((link) => link.addEventListener("click", () => setMobileNavigation(false)));
window.addEventListener("keydown", (event) => { if (event.key === "Escape") { content.querySelector(".modal-backdrop")?.remove(); setMobileNavigation(false); } });
window.matchMedia("(min-width: 861px)").addEventListener("change", (event) => { if (event.matches) setMobileNavigation(false); });
showView(currentView());
updateStickyHeader();
