export const SUPABASE_CONFIG = Object.freeze({
  url: "https://puidjdezfyxjornmdzvp.supabase.co",
  publishableKey: "sb_publishable_07ZxxIxIxjYHjAo2O597YA_vZcJZ3UZ",
});

// Chave PÚBLICA do par VAPID (gerada com `npx web-push generate-vapid-keys`) — não é
// segredo, é enviada ao navegador de propósito (applicationServerKey do PushManager).
// A chave PRIVADA fica só como secret da Edge Function send-push-notifications.
// Vazia até o par ser gerado e configurado — nesse estado, PushService.available fica false.
export const VAPID_PUBLIC_KEY = "BF6s7nuwMH7RN7Gv3vw9vacLPiMK8yKQ7F6XaFbWde1QsKsuUr9kQtD6p_dbPDjv4S6255ogHW2dk0G2IR5pOmE";
