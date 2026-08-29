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
import { getViewTitle, renderView } from "./ui/views.js";

const repository = new AppRepository();
const numbersService = new NumbersService(repository);

const content = document.querySelector("#page-content");
const title = document.querySelector("#page-title");
const navigationLinks = document.querySelectorAll("[data-view]");
const numbersController = new NumbersController({ service: numbersService, content });
const directoryService = new DirectoryService(numbersService);
const directoryControllers = Object.fromEntries(["clients", "groups", "responsibles"].map((type) => [type, new DirectoryController({ service: directoryService, content, type })]));
const incidentsController = new IncidentsController({ service: new IncidentsService(numbersService, new HistoryService(numbersService)), numbers: numbersService, content });
const historyController = new HistoryController({ service: new HistoryService(numbersService), numbers: numbersService, content });
const dashboardController = new DashboardController({ service: new DashboardService(numbersService), content });

function showView(viewName) {
  if (viewName === "dashboard") dashboardController.render();
  else if (viewName === "numbers") numbersController.render();
  else if (directoryControllers[viewName]) directoryControllers[viewName].render();
  else if (viewName === "incidents") incidentsController.render();
  else if (viewName === "history") historyController.render();
  else content.innerHTML = renderView(viewName);
  title.textContent = getViewTitle(viewName);
  navigationLinks.forEach((link) => link.classList.toggle("is-active", link.dataset.view === viewName));
}

function currentView() { return window.location.hash.slice(1) || "dashboard"; }

window.addEventListener("hashchange", () => showView(currentView()));
window.addEventListener("keydown", (event) => { if (event.key === "Escape") content.querySelector(".modal-backdrop")?.remove(); });
showView(currentView());
