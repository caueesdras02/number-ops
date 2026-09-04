export class SupabaseAuthRepository {
  constructor(client) { this.client = client; }
  async getSession() { const { data, error } = await this.client.auth.getSession(); if (error) throw error; return data.session ?? null; }
  async getProfile(userId) { const { data, error } = await this.client.from("profiles").select("*").eq("id", userId).single(); if (error) throw error; return data; }
  async signIn(credentials) { const { data, error } = await this.client.auth.signInWithPassword(credentials); if (error) throw error; return data; }
  async signUp(payload) { const { data, error } = await this.client.auth.signUp(payload); if (error) throw error; return data; }
  async signOut() { const { error } = await this.client.auth.signOut(); if (error) throw error; }
  async requestPasswordReset(email) { const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname }); if (error) throw error; }
  async updatePassword(password) { const { error } = await this.client.auth.updateUser({ password }); if (error) throw error; }
  async listRegistrationSquads() { const { data, error } = await this.client.rpc("registration_squads"); if (error) throw error; return data; }
  onAuthStateChange(callback) { return this.client.auth.onAuthStateChange(callback); }
}
