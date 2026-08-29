import { renderNumberForm, renderNumbersView } from "../ui/numbers-view.js";
import { renderNumberDetailView } from "../ui/number-detail-view.js";

export class NumbersController {
  constructor({ service, content }) {
    this.service = service;
    this.content = content;
    this.query = "";
    this.archiveFilter = "ALL";
    this.filters = {};
  }

  render() {
    this.content.innerHTML = renderNumbersView(this.service.getNumbers(this.query, { ...this.filters, archiveFilter: this.archiveFilter }), this.service.getLocations(), this.service.getResponsibles(), this.query, this.archiveFilter, this.filters, this.service.getClients(), this.service.getGroups());
    this.bindPageEvents();
  }

  bindPageEvents() {
    this.content.querySelector("#number-search")?.addEventListener("input", (event) => {
      this.query = event.target.value;
      const cursorPosition = event.target.selectionStart;
      this.render();
      const searchInput = this.content.querySelector("#number-search");
      searchInput?.focus();
      searchInput?.setSelectionRange(cursorPosition, cursorPosition);
    });
    this.content.querySelector('[data-action="add"]')?.addEventListener("click", () => this.openForm());
    this.content.querySelectorAll('[data-action="view"]').forEach((button) => button.addEventListener("click", () => this.showDetail(button.dataset.id)));
    this.content.querySelectorAll('[data-action="edit"]').forEach((button) => button.addEventListener("click", () => this.openForm(button.dataset.id)));
    this.content.querySelectorAll('[data-action="archive"]').forEach((button) => button.addEventListener("click", () => this.archive(button.dataset.id)));
    this.content.querySelectorAll('[data-action="restore"]').forEach((button) => button.addEventListener("click", () => { this.service.restore(button.dataset.id); this.render(); }));
    this.content.querySelector("#archive-filter")?.addEventListener("change", (event) => { this.archiveFilter = event.target.value; this.render(); });
    this.content.querySelectorAll("[data-filter]").forEach((input) => input.addEventListener("change", () => { this.filters[input.dataset.filter] = input.value; this.render(); }));
  }

  showDetail(id) {
    const number = this.service.getNumber(id);
    if (!number) return this.render();
    this.content.innerHTML = renderNumberDetailView({ number, locations: this.service.getLocations(), responsibles: this.service.getResponsibles(), clients: this.service.getClients(), groups: this.service.getGroups() });
    this.content.querySelector('[data-action="back-to-list"]')?.addEventListener("click", () => this.render());
  }

  openForm(id = null, message = "") {
    const number = id ? this.service.getNumber(id) : null;
    this.content.insertAdjacentHTML("beforeend", renderNumberForm({ number, locations: this.service.getLocations(), responsibles: this.service.getResponsibles(), clients: this.service.getClients(), groups: this.service.getGroups(), message }));
    const form = this.content.querySelector("#number-form");
    form.querySelector('[name="phone"]')?.addEventListener("input", (event) => { event.target.value = event.target.value.replace(/\D/g, "").slice(0, 13); });
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button) => button.addEventListener("click", () => this.closeForm()));
    form.addEventListener("submit", (event) => this.submitForm(event));
  }

  closeForm() { this.content.querySelector(".modal-backdrop")?.remove(); }

  submitForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const values = { ...Object.fromEntries(formData), clientIds: formData.getAll("clientIds"), groupIds: formData.getAll("groupIds") };
    try {
      if (form.dataset.id) this.service.update(form.dataset.id, values);
      else this.service.create(values);
      this.closeForm();
      this.render();
    } catch (error) {
      this.closeForm();
      this.openForm(form.dataset.id || null, error.message);
    }
  }

  archive(id) {
    const number = this.service.getNumber(id);
    if (!number || !window.confirm(`Arquivar ${number.phone}? O número ficará inativo e indisponível.`)) return;
    this.service.archive(id);
    this.render();
  }
}
