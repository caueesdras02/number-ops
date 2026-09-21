// Service worker mínimo — existe só para viabilizar push notification no
// atalho da tela de início (Web Push exige um service worker registrado).
// Não faz cache/offline de propósito: o Number Ops depende de dados
// sempre atualizados do Supabase, então servir uma versão em cache do app
// seria pior que não ter service worker nenhum.
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "Number Ops";
  const options = {
    body: data.body || "",
    icon: "./src/assets/icons/icon-192.png",
    badge: "./src/assets/icons/icon-192.png",
    data: { url: data.url || "./" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => "focus" in client);
      if (existing) {
        existing.navigate(targetUrl).catch(() => {});
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
