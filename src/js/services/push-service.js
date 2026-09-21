// Inscrição/desinscrição de notificação push ("número caiu"), testável sem
// navegador real — depende só do que é injetado (pushManager, permissão,
// repository, profileId, chave pública VAPID). A parte de DOM/ícone do
// botão fica em ui/push-toggle.js.
//
// Preferência pessoal por dispositivo, não dado operacional — disponível
// pra qualquer cargo (inclusive VIEWER); RBAC não se aplica aqui.

/** Converte a chave pública VAPID (base64url) pro formato exigido por PushManager.subscribe(). */
export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export class PushService {
  constructor({ pushManager = null, requestPermission = null, repository = null, profileId = null, vapidPublicKey = "", userAgent = "" } = {}) {
    this.pushManager = pushManager;
    this.requestPermission = requestPermission;
    this.repository = repository;
    this.profileId = profileId;
    this.vapidPublicKey = vapidPublicKey;
    this.userAgent = userAgent;
  }

  /** false no modo local/offline (sem Supabase), sem service worker, ou sem usuário autenticado. */
  get available() {
    return Boolean(this.pushManager && this.requestPermission && this.repository && this.profileId && this.vapidPublicKey);
  }

  async status() {
    if (!this.pushManager) return "unsupported";
    const existing = await this.pushManager.getSubscription();
    return existing ? "subscribed" : "unsubscribed";
  }

  async subscribe() {
    if (!this.available) throw new Error("Notificações não estão disponíveis neste modo.");
    const permission = await this.requestPermission();
    if (permission !== "granted") throw new Error("Permissão de notificação não concedida.");

    const subscription = await this.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(this.vapidPublicKey),
    });
    const json = subscription.toJSON();
    const record = {
      profile_id: this.profileId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth_key: json.keys.auth,
      user_agent: this.userAgent,
      last_seen_at: new Date().toISOString(),
    };

    // Reassinar no mesmo aparelho não deve duplicar a linha (endpoint é único no banco) —
    // atualiza a existente em vez de inserir de novo.
    const rows = await this.repository.list();
    const existing = rows.find((row) => row.endpoint === json.endpoint);
    if (existing) await this.repository.update(existing.id, record);
    else await this.repository.upsert(record);

    return subscription;
  }

  async unsubscribe() {
    if (!this.pushManager) return;
    const existing = await this.pushManager.getSubscription();
    if (!existing) return;
    const endpoint = existing.endpoint;
    await existing.unsubscribe();
    if (!this.repository) return;
    const rows = await this.repository.list();
    const match = rows.find((row) => row.endpoint === endpoint);
    if (match) await this.repository.remove(match.id);
  }
}
