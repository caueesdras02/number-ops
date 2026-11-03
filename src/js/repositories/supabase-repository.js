export class SupabaseRepository {
  constructor(client, table) { this.client = client; this.table = table; }
  async list() { const { data, error } = await this.client.from(this.table).select("*"); if (error) throw error; return data; }
  async get(id) { const { data, error } = await this.client.from(this.table).select("*").eq("id", id).maybeSingle(); if (error) throw error; return data; }
  async upsert(record) { const { data, error } = await this.client.from(this.table).upsert(record).select().single(); if (error) throw error; return data; }
  async update(id, changes) { const { data, error } = await this.client.from(this.table).update(changes).eq("id", id).select().single(); if (error) throw error; return data; }
  /** Só a contagem (head: true — nenhuma linha trafega), já respeitando o RLS de quem está logado. */
  async count(equals = {}) { let query = this.client.from(this.table).select("id", { count: "exact", head: true }); for (const [column, value] of Object.entries(equals)) query = query.eq(column, value); const { count, error } = await query; if (error) throw error; return count ?? 0; }
  async remove(id) { const { error } = await this.client.from(this.table).delete().eq("id", id); if (error) throw error; }
}

export const createSupabaseRepositories = (client) => Object.freeze({
  profiles: new SupabaseRepository(client, "profiles"),
  numbers: new SupabaseRepository(client, "numbers"),
  clients: new SupabaseRepository(client, "clients"),
  squads: new SupabaseRepository(client, "squads"),
  campaigns: new SupabaseRepository(client, "campaigns"),
  numberCampaignLinks: new SupabaseRepository(client, "number_campaign_links"),
  responsibles: new SupabaseRepository(client, "responsibles"),
  locations: new SupabaseRepository(client, "locations"),
  incidents: new SupabaseRepository(client, "incidents"),
  restrictions: new SupabaseRepository(client, "restrictions"),
  historyEvents: new SupabaseRepository(client, "history_events"),
  auditLogs: new SupabaseRepository(client, "audit_logs"),
  integrationEvents: new SupabaseRepository(client, "integration_events"),
  externalNumbers: new SupabaseRepository(client, "external_numbers"),
  externalNumberCampaignLinks: new SupabaseRepository(client, "external_number_campaign_links"),
  pushSubscriptions: new SupabaseRepository(client, "push_subscriptions"),
  pushSubscriptionSquads: new SupabaseRepository(client, "push_subscription_squads"),
  signupAuthorizations: new SupabaseRepository(client, "signup_authorizations"),
});
