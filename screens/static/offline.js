(function () {
  const button = document.getElementById("offline-sync");
  const status = document.getElementById("offline-status");

  function setStatus(text, kind) {
    if (!status) return;
    status.textContent = text || "";
    status.dataset.kind = kind || "";
  }

  function formatLastSync(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `сохранено ${date.toLocaleDateString("ru-RU")} ${date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit"
    })}`;
  }

  function forceOnlineRefresh() {
    const url = new URL(window.location.href);
    url.searchParams.set("_refresh", Date.now().toString());
    window.location.replace(url.toString());
  }

  function postToWorker(worker, message) {
    return new Promise((resolve, reject) => {
      if (!worker) {
        reject(new Error("service worker недоступен"));
        return;
      }
      const channel = new MessageChannel();
      const timer = window.setTimeout(() => reject(new Error("таймаут обновления")), 60000);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timer);
        resolve(event.data || {});
      };
      worker.postMessage(message, [channel.port2]);
    });
  }

  async function activeWorker() {
    const registration = await navigator.serviceWorker.ready;
    return registration.active || registration.waiting || registration.installing;
  }

  async function clearOfflineCache() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const worker = await activeWorker();
      await postToWorker(worker, { type: "CLEAR_OFFLINE" });
    } catch (error) {
      // Выход всё равно должен продолжиться; серверная сессия важнее локального кэша.
    }
    window.localStorage.removeItem("zameryOfflineLastSync");
  }

  async function syncOffline() {
    if (!button) return;
    if (!("serviceWorker" in navigator)) {
      setStatus("обновляю страницу...", "busy");
      forceOnlineRefresh();
      return;
    }

    button.disabled = true;
    setStatus("обновляю...", "busy");

    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.update().catch(() => {});
      const response = await fetch("/offline/manifest", {
        cache: "reload",
        credentials: "include",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("не удалось получить список обновлений");

      const manifest = await response.json();
      const urls = Array.isArray(manifest.urls) ? manifest.urls : [];
      const worker = await activeWorker();
      const result = await postToWorker(worker, { type: "REFRESH_APP", urls });
      if (!result.ok) throw new Error(result.error || "кэш не обновился");

      const now = new Date().toISOString();
      window.localStorage.setItem("zameryOfflineLastSync", now);
      const failed = Array.isArray(result.errors) ? result.errors.length : 0;
      setStatus(
        failed ? `обновлено: ${result.saved}, ошибок: ${failed}` : `обновлено: ${result.saved}`,
        failed ? "warn" : "ok"
      );
    } catch (error) {
      setStatus("обновляю страницу...", "busy");
      forceOnlineRefresh();
    } finally {
      button.disabled = false;
    }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      setStatus("офлайн-режим недоступен", "error");
    });
  }

  if (status) {
    setStatus(formatLastSync(window.localStorage.getItem("zameryOfflineLastSync")), "ok");
  }

  if (button) {
    button.addEventListener("click", syncOffline);
    if (!("serviceWorker" in navigator)) {
      setStatus("онлайн-обновление", "warn");
    }
  }

  document.querySelectorAll("a.logout").forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href") || "/logout";
      event.preventDefault();
      if (link.dataset.busy === "1") return;

      link.dataset.busy = "1";
      link.setAttribute("aria-disabled", "true");
      link.textContent = "Выход...";
      clearOfflineCache().finally(() => {
        window.location.assign(href);
      });
    });
  });
})();
