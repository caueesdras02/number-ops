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
  constructor({ pushManager = null, requestPermission = null, getPermission = null, repository = null, squadsRepository = null, profileId = null, vapidPublicKey = "", userAgent = "" } = {}) {
    this.pushManager = pushManager;
    this.requestPermission = requestPermission;
    // Opcional: lê o estado ATUAL da permissão (Notification.permission) sem precisar pedir de
    // novo — distingue "nunca perguntou" (default) de "usuário bloqueou" (denied), que exigem
    // tratamentos de UI bem diferentes (ver push-toggle.js). Sem isso injetado, status() só
    // enxerga unsupported/subscribed/unsubscribed, como antes.
    this.getPermission = getPermission;
    this.repository = repository;
    // Preferência de Squad por inscrição (push_subscription_squads) — opcional: sem repository
    // (modo local/offline, ou navegador sem push) o picker de squads simplesmente não aparece,
    // igual o resto do recurso de push já se comporta sem repository nenhum.
    this.squadsRepository = squadsRepository;
    this.profileId = profileId;
    this.vapidPublicKey = vapidPublicKey;
    this.userAgent = userAgent;
  }

  /** false no modo local/offline (sem Supabase), sem service worker, ou sem usuário autenticado. */
  get available() {
    return Boolean(this.pushManager && this.requestPermission && this.repository && this.profileId && this.vapidPublicKey);
  }

  /** "unsupported" | "denied" | "subscribed" | "unsubscribed" (cobre tanto "default", nunca
   * perguntado, quanto "granted" sem inscrição ativa — os dois são igualmente acionáveis: um
   * clique chama subscribe() e funciona sem reabrir o prompt nativo). */
  async status() {
    if (!this.pushManager) return "unsupported";
    if (this.getPermission?.() === "denied") return "denied";
    const existing = await this.pushManager.getSubscription();
    return existing ? "subscribed" : "unsubscribed";
  }

  async subscribe() {
    if (!this.available) throw new Error("Notificações não estão disponíveis neste modo.");
    const permission = await this.requestPermission();
    if (permission === "denied") throw new Error("As notificações estão bloqueadas nas configurações do navegador para este site. Permita notificações no navegador e tente novamente.");
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

  /** A linha de push_subscriptions do dispositivo ATUAL (pelo endpoint da inscrição do
   * navegador) — base pra ler/gravar a preferência de Squad deste dispositivo específico. null
   * quando não há inscrição ativa aqui (nada pra preferir ainda). */
  async currentSubscriptionRow() {
    if (!this.pushManager || !this.repository) return null;
    const existing = await this.pushManager.getSubscription();
    if (!existing) return null;
    const rows = await this.repository.list();
    return rows.find((row) => row.endpoint === existing.endpoint) ?? null;
  }

  /** true só quando o dispositivo atual tem inscrição ativa E a preferência de Squad está
   * disponível (Supabase configurado) — controla se o botão de preferência aparece. */
  get squadPreferenceAvailable() { return Boolean(this.squadsRepository); }

  /** Squads escolhidos pra este dispositivo — array VAZIO significa "sem filtro, notifica de
   * tudo" (o padrão, preservando o comportamento de hoje pra quem nunca configurou nada). */
  async getSquadPreference() {
    if (!this.squadsRepository) return [];
    const subscription = await this.currentSubscriptionRow();
    if (!subscription) return [];
    const rows = await this.squadsRepository.list();
    return rows.filter((row) => row.subscription_id === subscription.id).map((row) => row.squad_id);
  }

  /** Substitui a preferência inteira do dispositivo atual pelos squadIds informados (array vazio
   * = voltar a notificar de tudo). Sempre um replace completo (remove tudo, grava de novo) — o
   * volume é sempre pequeno (poucos Squads), não precisa de diff. */
  async setSquadPreference(squadIds) {
    if (!this.squadsRepository) throw new Error("Preferência de Squad não disponível neste modo.");
    const subscription = await this.currentSubscriptionRow();
    if (!subscription) throw new Error("Ative as notificações neste dispositivo antes de escolher os Squads.");
    const rows = await this.squadsRepository.list();
    const existing = rows.filter((row) => row.subscription_id === subscription.id);
    for (const row of existing) await this.squadsRepository.remove(row.id);
    for (const squadId of squadIds) await this.squadsRepository.upsert({ subscription_id: subscription.id, squad_id: squadId });
  }
}
