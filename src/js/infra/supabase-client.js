import { getSupabaseConfig } from "../config/supabase-config.js";

const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export async function createConfiguredSupabaseClient(importSdk = (url) => import(url)) {
  const config = getSupabaseConfig();
  if (!config) return null;
  const { createClient } = await importSdk(SDK_URL);
  return createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
