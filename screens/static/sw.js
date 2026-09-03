/* Версия поднята 22.07.2026: в кэше не было `design-system.css`, поэтому после
   установки приложения интерфейс получал старый CSS — без Inter и без токенов
   дизайн-системы. Смена имени кэша обязательна, иначе прежний список остаётся
   у уже установленных клиентов. Устаревшие адреса с версиями 20260629/20260703
   удалены: шелл их больше не запрашивает.

   01.09.2026 → v18 (П0 плана D-399): вся палитра переехала в `design-system.css`,
   а `style.css` лишился своего `:root`. Стратегия на `/static/` — cacheFirst и
   без версии в адресе, поэтому у установленного клиента остался бы СТАРЫЙ
   `style.css` со своей палитрой и НОВЫЙ шелл без неё — интерфейс без цвета.
   Имя кэша менять при каждой правке статики, иначе изменения не доедут.

   02.09.2026 → v19 (П1 плана D-399): стили шелла и библиотека компонентов
   уехали из `<style>` шаблонов в `crm2-shell.css` и `crm2-components.css`.
   У установленного клиента без смены имени кэша осталась бы старая разметка
   без единого правила оформления — интерфейс без вёрстки. */
const APP_CACHE = "zamery-app-v20";
const OFFLINE_CACHE = "zamery-offline-v8";
const PRECACHE_URLS = [
  "/static/offline.html",
  "/static/design-system.css",
  "/static/crm2-shell.css",
  "/static/crm2-components.css",
  "/static/crm2-deal-card.css",
  "/static/style.css",
  "/static/fonts/inter-400-cyrillic.woff2",
  "/static/fonts/inter-400-latin.woff2",
  "/static/fonts/inter-500-cyrillic.woff2",
  "/static/fonts/inter-500-latin.woff2",
  "/static/fonts/inter-600-cyrillic.woff2",
  "/static/fonts/inter-600-latin.woff2",
  "/static/manifest.webmanifest",
  "/static/assets/favicon-v2.svg",
  "/static/assets/favicon-32-v2.png",
  "/static/assets/app-v2.ico",
  "/static/assets/apple-touch-icon-v2.png",
  "/static/assets/logo-color.png",
  "/static/assets/pwa-icon-192-v2.png",
  "/static/assets/pwa-icon-512-v2.png",
  "/static/offline.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => ![APP_CACHE, OFFLINE_CACHE].includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function sameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(APP_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function navigationResponse(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cache = await caches.open(OFFLINE_CACHE);
    const url = new URL(request.url);
    return (
      await cache.match(url.pathname + url.search) ||
      await cache.match(url.pathname) ||
      await caches.match("/static/offline.html")
    );
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !sameOrigin(request)) return;

  const url = new URL(request.url);
  // Навигацию входа/выхода НЕ перехватываем: пусть браузер сам отработает
  // нативный редирект 303 и заголовок Clear-Site-Data (выход с первого клика).
  if (url.pathname === "/logout" || url.pathname === "/login") {
    return;
  }

  if (url.pathname.startsWith("/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
  }
});

async function cacheUrls(urls) {
  const cache = await caches.open(OFFLINE_CACHE);
  let saved = 0;
  const errors = [];

  for (const rawUrl of urls) {
    const url = new URL(rawUrl, self.location.origin);
    try {
      const request = new Request(url.toString(), {
        credentials: "include",
        cache: "reload"
      });
      const response = await fetch(request);
      if (!response.ok) {
        errors.push({ url: url.pathname + url.search, status: response.status });
        continue;
      }
      await cache.put(url.pathname + url.search, response.clone());
      saved += 1;
    } catch (error) {
      errors.push({ url: url.pathname + url.search, error: String(error) });
    }
  }

  return { saved, errors };
}

async function refreshApp(urls) {
  await caches.delete(APP_CACHE);
  const appCache = await caches.open(APP_CACHE);
  for (const rawUrl of PRECACHE_URLS) {
    const url = new URL(rawUrl, self.location.origin);
    const request = new Request(url.toString(), {
      credentials: "include",
      cache: "reload"
    });
    const response = await fetch(request);
    if (response.ok) {
      await appCache.put(url.pathname + url.search, response.clone());
    }
  }
  return cacheUrls(urls);
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];

  if (data.type === "CACHE_URLS") {
    event.waitUntil(
      cacheUrls(Array.isArray(data.urls) ? data.urls : [])
        .then((result) => {
          if (port) port.postMessage({ ok: true, ...result });
        })
        .catch((error) => {
          if (port) port.postMessage({ ok: false, error: String(error) });
        })
    );
  }

  if (data.type === "REFRESH_APP") {
    event.waitUntil(
      refreshApp(Array.isArray(data.urls) ? data.urls : [])
        .then((result) => {
          if (port) port.postMessage({ ok: true, ...result });
        })
        .catch((error) => {
          if (port) port.postMessage({ ok: false, error: String(error) });
        })
    );
  }

  if (data.type === "CLEAR_OFFLINE") {
    event.waitUntil(
      caches.delete(OFFLINE_CACHE).then(() => {
        if (port) port.postMessage({ ok: true, cleared: true });
      })
    );
  }
});
