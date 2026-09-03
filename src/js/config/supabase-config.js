import { SUPABASE_CONFIG } from "./supabase-runtime.js";

export function getSupabaseConfig() {
  const config = SUPABASE_CONFIG;
  const url = String(config.url ?? "").trim();
  const publishableKey = String(config.publishableKey ?? "").trim();
  return url && publishableKey ? Object.freeze({ url, publishableKey }) : null;
}
