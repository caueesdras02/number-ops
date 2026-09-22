import { ACCESS_LEVELS, isMaster } from "../models/access.js";
import { createId, now } from "../models/helpers.js";

const LEVELS = new Set(ACCESS_LEVELS);

/**
 * Autorizações de cadastro (convite por e-mail). Só MASTER cria/lê/revoga —
 * RLS (019) reforça isso independentemente do que este serviço faz aqui.
 * Nunca faz parte do `state` local sincronizado por DirectoryService/
 * NumbersService: manter fora desse blob evita que a lista de e-mails
 * autorizados circule pela memória/estado de clientes sem privilégio.
 */
export class SignupAuthorizationsService {
  constructor(repository) { this.repository = repository; }

  async list() {
    const rows = await this.repository.list();
    return rows.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }

  async create({ email, accessLevel, squadId }, currentProfile) {
    if (!isMaster(currentProfile)) throw new Error("Somente MASTER pode autorizar novos cadastros.");
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("Informe um e-mail válido.");
    if (!LEVELS.has(accessLevel)) throw new Error("Selecione um nível de acesso válido.");

    const existing = await this.repository.list();
    if (existing.some((row) => row.email === normalizedEmail && row.status === "PENDING")) {
      throw new Error("Já existe uma autorização pendente para este e-mail.");
    }

    const timestamp = now();
    return this.repository.upsert({
      id: createId("signup_auth"),
      email: normalizedEmail,
      access_level: accessLevel,
      squad_id: squadId || null,
      status: "PENDING",
      created_by: currentProfile.id,
      used_by: null,
      used_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  async revoke(id, currentProfile) {
    if (!isMaster(currentProfile)) throw new Error("Somente MASTER pode revogar autorizações.");
    const rows = await this.repository.list();
    const target = rows.find((row) => row.id === id);
    if (!target) throw new Error("Autorização não encontrada.");
    if (target.status !== "PENDING") throw new Error("Só é possível revogar autorizações pendentes.");
    return this.repository.update(id, { status: "REVOKED", updated_at: now() });
  }
}
