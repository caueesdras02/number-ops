import { renderDirectory, renderDirectoryForm } from "../ui/directory-view.js";

export class DirectoryController {
  constructor({ service, content, type }) { this.service = service; this.content = content; this.type = type; }

  render() {
    this.content.innerHTML = renderDirectory(this.type, this.service.list(this.type, true));
    this.content.querySelector('[data-action="add"]')?.addEventListener("click", () => this.openForm());
    this.content.querySelectorAll('[data-action="edit"]').forEach((button) => button.addEventListener("click", () => this.openForm(button.dataset.id)));
    this.content.querySelectorAll('[data-action="archive"]').forEach((button) => button.addEventListener("click", () => { this.service.archive(this.type, button.dataset.id); this.render(); }));
    this.content.querySelectorAll('[data-action="restore"]').forEach((button) => button.addEventListener("click", () => { this.service.restore(this.type, button.dataset.id); this.render(); }));
  }

  openForm(id = null) {
    this.content.insertAdjacentHTML("beforeend", renderDirectoryForm(this.type, id ? this.service.get(this.type, id) : {}));
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button) => button.addEventListener("click", () => this.content.querySelector(".modal-backdrop")?.remove()));
    this.content.querySelector("#directory-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      if (form.dataset.id) this.service.update(this.type, form.dataset.id, values);
      else this.service.create(this.type, values);
      this.render();
    });
  }
}
