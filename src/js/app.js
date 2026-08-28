import { AppRepository } from "./repositories/app-repository.js";
import { NumbersService } from "./services/numbers-service.js";
import { NumbersController } from "./controllers/numbers-controller.js";
import { getViewTitle, renderView } from "./ui/views.js";

const repository = new AppRepository();
const numbersService = new NumbersService(repository);

const content = document.querySelector("#page-content");
const title = document.querySelector("#page-title");
const navigationLinks = document.querySelectorAll("[data-view]");
const numbersController = new NumbersController({ service: numbersService, content });

function showView(viewName) {
  if (viewName === "numbers") numbersController.render();
  else content.innerHTML = renderView(viewName);
  title.textContent = getViewTitle(viewName);
  navigationLinks.forEach((link) => link.classList.toggle("is-active", link.dataset.view === viewName));
}

function currentView() { return window.location.hash.slice(1) || "dashboard"; }

window.addEventListener("hashchange", () => showView(currentView()));
showView(currentView());
