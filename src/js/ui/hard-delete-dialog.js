import { describeReferences } from "../models/hard-delete.js";
import { escapeHtml } from "./number-presentation.js";

/**
 * Confirmação forte de exclusão definitiva. Resolve `true` se o usuário confirmar no
 * pop-up (e não houver bloqueios), `false` ao cancelar. Sem digitação de palavra — só
 * um aviso claro de que o registro sai dos registros/histórico pra sempre.
 */
export function confirmHardDelete(root, { entity, state, id, name, typeLabel }) {
  const { blockers, effects } = describeReferences(state, entity, id);
  const blocked = blockers.length > 0;
  const list = (items) => `<ul class="hard-delete-list">${items.map((item) => `<li>${item.count} ${escapeHtml(item.label)}</li>`).join("")}</ul>`;

  const html = `<div class="modal-backdrop hard-delete-backdrop" data-hard-delete>
    <section class="modal-card hard-delete-card" role="alertdialog" aria-modal="true" aria-labelledby="hard-delete-title">
      <div class="modal-header"><div><p class="eyebrow">Ação irreversível</p><h2 id="hard-delete-title">Excluir ${escapeHtml(typeLabel)} definitivamente</h2></div>
      <button class="icon-button" type="button" data-hd-cancel aria-label="Fechar">×</button></div>
      <p class="hard-delete-target"><strong>${escapeHtml(name)}</strong></p>
      ${blocked
        ? `<div class="hard-delete-blockers"><strong>Não é possível excluir agora.</strong><p>Existem referências que impedem a exclusão:</p>${list(blockers)}<p>Arquive o registro ou remova essas referências antes.</p></div>`
        : `<div class="hard-delete-warning"><strong>Tem certeza que deseja excluir definitivamente?</strong> O registro será retirado dos registros e do histórico, apagado permanentemente do banco compartilhado. Esta ação não pode ser desfeita.</div>
           ${effects.length ? `<p>Também serão removidos junto:</p>${list(effects)}` : ""}`}
      <div class="form-actions">
        <button class="button button-quiet" type="button" data-hd-cancel>Cancelar</button>
        ${blocked ? "" : `<button class="button button-danger" type="button" data-hd-confirm>Sim, excluir definitivamente</button>`}
      </div>
    </section></div>`;

  root.insertAdjacentHTML("beforeend", html);
  const modal = root.querySelector("[data-hard-delete]");

  return new Promise((resolve) => {
    const done = (value) => { modal.remove(); document.removeEventListener("keydown", onKey); resolve(value); };
    const onKey = (event) => { if (event.key === "Escape") done(false); };
    document.addEventListener("keydown", onKey);
    modal.addEventListener("click", (event) => { if (event.target === modal) done(false); });
    modal.querySelectorAll("[data-hd-cancel]").forEach((button) => button.addEventListener("click", () => done(false)));
    const confirm = modal.querySelector("[data-hd-confirm]");
    // Desabilita no primeiro clique — impede duplo clique disparar a exclusão duas vezes.
    confirm?.addEventListener("click", () => { if (confirm.disabled) return; confirm.disabled = true; done(true); });
    modal.querySelector("[data-hd-cancel]")?.focus();
  });
}
