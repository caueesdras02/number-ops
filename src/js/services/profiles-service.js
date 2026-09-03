const JOB_TITLES = new Set(["ANALYST", "ACCOUNT_MANAGER"]);
const STATUSES = new Set(["ACTIVE", "INACTIVE"]);
const ACCESS_LEVELS = new Set(["ADMIN", "USER", "VIEWER"]);

export class ProfilesService {
  constructor(profilesRepository, squadsRepository) { this.profilesRepository = profilesRepository; this.squadsRepository = squadsRepository; }

  async list() {
    const [profiles, squads] = await Promise.all([this.profilesRepository.list(), this.squadsRepository.list()]);
    return { profiles: profiles.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), squads };
  }

  async update(id, input, currentProfile) {
    if (currentProfile.access_level !== "ADMIN") throw new Error("Somente administradores podem alterar usuários.");
    const name = String(input.name ?? "").trim();
    if (!name) throw new Error("Informe o nome.");
    if (!JOB_TITLES.has(input.job_title)) throw new Error("Selecione um cargo válido.");
    if (!STATUSES.has(input.status)) throw new Error("Selecione um status válido.");
    if (!ACCESS_LEVELS.has(input.access_level)) throw new Error("Selecione um nível de acesso válido.");
    if (id === currentProfile.id && (input.status !== "ACTIVE" || input.access_level !== "ADMIN")) throw new Error("O administrador atual não pode desativar ou remover o próprio acesso Admin.");
    return this.profilesRepository.update(id, {
      name, job_title: input.job_title, squad_id: input.squad_id || null,
      status: input.status, access_level: input.access_level, updated_at: new Date().toISOString(),
    });
  }
}
