/* Klip Studio — service worker AN TOÀN (safe-level PWA).
 *
 * Phạm vi cố ý hẹp:
 * - Chỉ cache-first cho asset build có hash dưới "/assets/" (nội dung bất biến
 *   theo tên file, nên cache cũ không bao giờ phục vụ code mới sai).
 * - MỌI request khác (kể cả index.html) KHÔNG respondWith — đi mạng như bình
 *   thường, để trang luôn tươi và bản deploy mới có hiệu lực ngay.
 * - Mọi bước đều bọc try/catch: SW lỗi thì app vẫn chạy như không có SW.
 */
const CACHE_NAME = "klip-shell-v1";

self.addEventListener("install", () => {
  try {
    self.skipWaiting();
  } catch {
    /* bỏ qua — không để SW phá app */
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        );
      } catch {
        /* bỏ qua */
      }
      try {
        await self.clients.claim();
      } catch {
        /* bỏ qua */
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  try {
    const req = event.request;
    if (!req || req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    if (!url.pathname.includes("/assets/")) return;
    event.respondWith(
      (async () => {
        try {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(req);
          if (cached) return cached;
          const res = await fetch(req);
          if (res && res.ok) {
            try {
              await cache.put(req, res.clone());
            } catch {
              /* bỏ qua lỗi ghi cache */
            }
          }
          return res;
        } catch {
          return fetch(req);
        }
      })(),
    );
  } catch {
    /* bỏ qua — request đi mạng như bình thường */
  }
});
