export class AuthService {
  constructor(authRepository) { this.authRepository = authRepository; }

  async getSession() {
    return this.authRepository.getSession();
  }

  async getProfile(userId) {
    return this.authRepository.getProfile(userId);
  }

  async getActiveSession() {
    const session = await this.getSession();
    if (!session) return null;
    const profile = await this.getProfile(session.user.id);
    if (profile.status !== "ACTIVE") {
      await this.signOut();
      throw new Error("Este usuário está inativo. Procure um administrador.");
    }
    return { session, profile };
  }

  async signIn(email, password) {
    const data = await this.authRepository.signIn({ email: String(email).trim(), password });
    const profile = await this.getProfile(data.user.id);
    if (profile.status !== "ACTIVE") {
      await this.signOut();
      throw new Error("Este usuário está inativo. Procure um administrador.");
    }
    return { session: data.session, profile };
  }

  async register({ name, email, password, jobTitle, squadId }) {
    return this.authRepository.signUp({
      email: String(email).trim(),
      password,
      options: { data: { name: String(name).trim(), job_title: jobTitle, squad_id: squadId || null } },
    });
  }

  async signOut() {
    return this.authRepository.signOut();
  }

  async listActiveSquads() { return this.authRepository.listRegistrationSquads(); }
  onAuthStateChange(callback) { return this.authRepository.onAuthStateChange(callback); }
}
