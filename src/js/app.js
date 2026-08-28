import { AppRepository } from "./repositories/app-repository.js";
import { getViewTitle, renderView } from "./ui/views.js";

const repository = new AppRepository();
repository.initialize();

const content = document.querySelector("#page-content");
const title = document.querySelector("#page-title");
const navigationLinks = document.querySelectorAll("[data-view]");

function showView(viewName) {
  content.innerHTML = renderView(viewName);
  title.textContent = getViewTitle(viewName);
  navigationLinks.forEach((link) => link.classList.toggle("is-active", link.dataset.view === viewName));
}

function currentView() { return window.location.hash.slice(1) || "dashboard"; }

window.addEventListener("hashchange", () => showView(currentView()));
showView(currentView());
