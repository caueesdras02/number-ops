// Hierarquia de acesso interno: MASTER > ADMIN > USER > VIEWER. CLIENT é um acesso EXTERNO
// (migrations 028/029): só leitura, restrito a um cliente (profiles.client_id), e só enxerga o
// Portal do cliente — nunca as telas internas.
export const ACCESS_LEVELS = Object.freeze(["MASTER", "ADMIN", "USER", "VIEWER", "CLIENT"]);
export const ACCESS_LEVEL_LABELS = Object.freeze({ MASTER: "Master", ADMIN: "Admin", USER: "User", VIEWER: "Viewer", CLIENT: "Cliente" });

const levelOf = (value) => (typeof value === "string" ? value : value?.access_level ?? "");

export function isMaster(profileOrLevel) { return levelOf(profileOrLevel) === "MASTER"; }
export function isAdminOrAbove(profileOrLevel) { const level = levelOf(profileOrLevel); return level === "MASTER" || level === "ADMIN"; }
export function isClientAccess(profileOrLevel) { return levelOf(profileOrLevel) === "CLIENT"; }
/** Qualquer nível operacional (MASTER/ADMIN/USER) — VIEWER e CLIENT não podem. Mesmo tier de
 * escrita já usado em numbers/campaigns/incidents; não inventa um cargo novo. */
export function canOperate(profileOrLevel) { const level = levelOf(profileOrLevel); return level !== "VIEWER" && level !== "CLIENT" && level !== ""; }

/** Escopo de dados por Squad (espelha public.current_has_global_scope() da migration 025):
 * MASTER/ADMIN enxergam todos os Squads; USER/VIEWER só o Squad do próprio perfil
 * (profiles.squad_id). A restrição real é o RLS — isto só ajusta a interface. */
export function hasGlobalScope(profileOrLevel) { return isAdminOrAbove(profileOrLevel); }
export function isSquadScoped(profileOrLevel) { const level = levelOf(profileOrLevel); return level === "USER" || level === "VIEWER"; }
/** Squad que restringe os dados do perfil (null = sem restrição de Squad). */
export function scopeSquadIdOf(profile) { return isSquadScoped(profile) ? profile?.squad_id ?? null : null; }

/** Nível de acesso "efetivo" de um profile só é válido se o usuário estiver ativo. */
export function activeMasters(profiles = []) {
  return profiles.filter((profile) => profile.access_level === "MASTER" && profile.status === "ACTIVE");
}

/**
 * Garante que a alteração pretendida não deixe o sistema sem nenhum MASTER ativo.
 * `nextLevel` = novo access_level pretendido (ou null para exclusão). `nextStatus` opcional.
 * Lança Error se a operação remover o último MASTER ativo.
 */
export function assertLastMasterSafe(profiles, targetId, { nextLevel = undefined, nextStatus = undefined, removing = false } = {}) {
  const target = profiles.find((profile) => profile.id === targetId);
  if (!target || target.access_level !== "MASTER" || target.status !== "ACTIVE") return;
  const stillMaster = !removing && (nextLevel ?? "MASTER") === "MASTER" && (nextStatus ?? "ACTIVE") === "ACTIVE";
  if (stillMaster) return;
  const others = activeMasters(profiles).filter((profile) => profile.id !== targetId);
  if (others.length === 0) throw new Error("O sistema precisa de pelo menos um MASTER ativo. Promova outro usuário antes.");
}
