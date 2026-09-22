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

  /**
   * Acesso e Squad não fazem mais parte do cadastro: quem define isso é a
   * autorização prévia do MASTER (handle_new_user ignora squad_id do
   * metadata e nunca aceita access_level vindo do cliente — só a que está
   * associada ao e-mail em signup_authorizations).
   */
  async register({ name, email, password, jobTitle }) {
    return this.authRepository.signUp({
      email: String(email).trim(),
      password,
      options: { data: { name: String(name).trim(), job_title: jobTitle } },
    });
  }

  /** Verificação antecipada de UX — o cadastro em si é bloqueado no backend mesmo sem isso. */
  async isEmailAuthorized(email) {
    const value = String(email ?? "").trim();
    if (!value) return false;
    return this.authRepository.checkSignupAuthorization(value);
  }

  async signOut() {
    return this.authRepository.signOut();
  }

  async requestPasswordReset(email) {
    return this.authRepository.requestPasswordReset(String(email).trim());
  }

  async updatePassword(password) {
    if (String(password ?? "").length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres.");
    return this.authRepository.updatePassword(password);
  }

  onAuthStateChange(callback) { return this.authRepository.onAuthStateChange(callback); }
}
