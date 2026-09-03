export class SupabaseRepository {
  constructor(client, table) { this.client = client; this.table = table; }
  async list() { const { data, error } = await this.client.from(this.table).select("*"); if (error) throw error; return data; }
  async get(id) { const { data, error } = await this.client.from(this.table).select("*").eq("id", id).maybeSingle(); if (error) throw error; return data; }
  async upsert(record) { const { data, error } = await this.client.from(this.table).upsert(record).select().single(); if (error) throw error; return data; }
  async update(id, changes) { const { data, error } = await this.client.from(this.table).update(changes).eq("id", id).select().single(); if (error) throw error; return data; }
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
});
