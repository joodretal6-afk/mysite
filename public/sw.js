// Service Worker — منصة الأجبان (PWA)
const CACHE = "cheese-v3";
const SHELL = ["/admin", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// شبكة أولاً للطلبات (البيانات دايماً محدّثة)، مع كاش احتياطي عند انقطاع النت
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // لا نتدخّل في نداءات الـ API — لازم تكون حيّة دائماً
  // 🔴 وحدات الميزات مركّبة على /admin/f-api — كانت تُخزّن بالكاش
  // فيشوف التاجر أرقام أمس على إنها اليوم. أي بيانات حيّة ممنوع تخزينها.
  if (url.pathname.startsWith("/admin/api") ||
      url.pathname.startsWith("/admin/f-api") ||
      url.pathname.startsWith("/webhook") ||
      url.pathname.startsWith("/whatsapp")) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && url.origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match("/admin")))
  );
});

// إشعارات: من رسالة الصفحة (postMessage) أو من Web Push إن توفّر
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "notify") {
    self.registration.showNotification(d.title || "منصة الأجبان", {
      body: d.body || "", icon: "/icon.svg", badge: "/icon.svg", tag: d.tag || "order", dir: "rtl", lang: "ar"
    });
  }
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || "🧀 طلب جديد", {
    body: data.body || "وصلك طلب جديد!", icon: "/icon.svg", badge: "/icon.svg", tag: "order", dir: "rtl", lang: "ar"
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window" }).then(list => {
    for (const c of list) { if (c.url.includes("/admin") && "focus" in c) return c.focus(); }
    return clients.openWindow("/admin");
  }));
});
