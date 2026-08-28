import { renderNumberForm, renderNumbersView } from "../ui/numbers-view.js";

export class NumbersController {
  constructor({ service, content }) {
    this.service = service;
    this.content = content;
    this.query = "";
  }

  render() {
    this.content.innerHTML = renderNumbersView(this.service.getNumbers(this.query), this.service.getLocations(), this.service.getResponsibles(), this.query);
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
    this.content.querySelectorAll('[data-action="edit"]').forEach((button) => button.addEventListener("click", () => this.openForm(button.dataset.id)));
    this.content.querySelectorAll('[data-action="archive"]').forEach((button) => button.addEventListener("click", () => this.archive(button.dataset.id)));
  }

  openForm(id = null, message = "") {
    const number = id ? this.service.getNumber(id) : null;
    this.content.insertAdjacentHTML("beforeend", renderNumberForm({ number, locations: this.service.getLocations(), responsibles: this.service.getResponsibles(), message }));
    const form = this.content.querySelector("#number-form");
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button) => button.addEventListener("click", () => this.closeForm()));
    form.addEventListener("submit", (event) => this.submitForm(event));
  }

  closeForm() { this.content.querySelector(".modal-backdrop")?.remove(); }

  submitForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
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
