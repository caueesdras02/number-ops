import { AppRepository } from "./repositories/app-repository.js";
import { NumbersService } from "./services/numbers-service.js";
import { NumbersController } from "./controllers/numbers-controller.js";
import { DirectoryController } from "./controllers/directory-controller.js";
import { DirectoryService } from "./services/directory-service.js";
import { getViewTitle, renderView } from "./ui/views.js";

const repository = new AppRepository();
const numbersService = new NumbersService(repository);

const content = document.querySelector("#page-content");
const title = document.querySelector("#page-title");
const navigationLinks = document.querySelectorAll("[data-view]");
const numbersController = new NumbersController({ service: numbersService, content });
const directoryService = new DirectoryService(numbersService);
const directoryControllers = Object.fromEntries(["clients", "groups", "responsibles"].map((type) => [type, new DirectoryController({ service: directoryService, content, type })]));

function showView(viewName) {
  if (viewName === "numbers") numbersController.render();
  else if (directoryControllers[viewName]) directoryControllers[viewName].render();
  else content.innerHTML = renderView(viewName);
  title.textContent = getViewTitle(viewName);
  navigationLinks.forEach((link) => link.classList.toggle("is-active", link.dataset.view === viewName));
}

function currentView() { return window.location.hash.slice(1) || "dashboard"; }

window.addEventListener("hashchange", () => showView(currentView()));
showView(currentView());
