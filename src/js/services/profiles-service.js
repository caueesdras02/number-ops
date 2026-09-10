import { ACCESS_LEVELS, isMaster, assertLastMasterSafe } from "../models/access.js";

const JOB_TITLES = new Set(["ANALYST", "ACCOUNT_MANAGER"]);
const STATUSES = new Set(["ACTIVE", "INACTIVE"]);
const LEVELS = new Set(ACCESS_LEVELS);

export class ProfilesService {
  constructor(profilesRepository, squadsRepository) { this.profilesRepository = profilesRepository; this.squadsRepository = squadsRepository; }

  async list() {
    const [profiles, squads] = await Promise.all([this.profilesRepository.list(), this.squadsRepository.list()]);
    return { profiles: profiles.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), squads };
  }

  async update(id, input, currentProfile) {
    if (currentProfile.access_level !== "ADMIN" && currentProfile.access_level !== "MASTER") {
      throw new Error("Somente administradores podem alterar usuários.");
    }
    const profiles = await this.profilesRepository.list();
    const target = profiles.find((profile) => profile.id === id);
    if (!target) throw new Error("Usuário não encontrado.");

    const name = String(input.name ?? "").trim();
    if (!name) throw new Error("Informe o nome.");
    if (!JOB_TITLES.has(input.job_title)) throw new Error("Selecione um cargo válido.");
    if (!STATUSES.has(input.status)) throw new Error("Selecione um status válido.");

    const nextLevel = input.access_level ?? target.access_level;
    if (!LEVELS.has(nextLevel)) throw new Error("Selecione um nível de acesso válido.");

    const levelChanged = nextLevel !== target.access_level;
    if (levelChanged && !isMaster(currentProfile)) throw new Error("Somente MASTER pode alterar o nível de acesso.");
    if (target.access_level === "MASTER" && !isMaster(currentProfile)) throw new Error("Somente MASTER pode alterar um usuário MASTER.");
    if (nextLevel === "MASTER" && !isMaster(currentProfile)) throw new Error("Somente MASTER pode conceder acesso MASTER.");

    if (id === currentProfile.id && isMaster(currentProfile) && (input.status !== "ACTIVE" || nextLevel !== "MASTER")) {
      throw new Error("O MASTER atual não pode rebaixar ou desativar o próprio acesso.");
    }
    assertLastMasterSafe(profiles, id, { nextLevel, nextStatus: input.status });

    return this.profilesRepository.update(id, {
      name, job_title: input.job_title, squad_id: input.squad_id || null,
      status: input.status, access_level: nextLevel, updated_at: new Date().toISOString(),
    });
  }

  async hardDelete(id, currentProfile) {
    if (!isMaster(currentProfile)) throw new Error("Somente MASTER pode excluir usuários definitivamente.");
    if (id === currentProfile.id) throw new Error("Você não pode excluir o próprio usuário.");
    const profiles = await this.profilesRepository.list();
    if (!profiles.some((profile) => profile.id === id)) throw new Error("Usuário não encontrado.");
    assertLastMasterSafe(profiles, id, { removing: true });
    await this.profilesRepository.remove(id);
    return { removedProfileId: id };
  }
}
