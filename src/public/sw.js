// Mercbot's service worker (D-133): what makes Mercbot an app people install from the website. It keeps the offline
// page and the built files Vite names by their content, so the app starts at once and an outage shows a page of its
// own; it never keeps a page, the API, an event stream or an upload. It shows the notifications the server pushes and
// opens their chat, and receives what another app shares into Mercbot. A new release takes over as soon as it loads.

const OFFLINE_CACHE = "mercbot-offline-v1";
const ASSETS_CACHE = "mercbot-assets";
const SHARED_CACHE = "mercbot-shared";
const OFFLINE_PAGE = "/offline.html";
// The offline page and what it shows, kept when the worker installs.
const OFFLINE_FILES = [OFFLINE_PAGE, "/offline.js", "/app-icons/icon-192.png"];
// Shared files wait this long for a chat to be chosen.
const SHARED_FOR_MS = 60 * 60 * 1000;

// readable-check: allow released-listeners - shared resource: the service worker's install events, for its whole life
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE)
    .then((cache) => cache.addAll(OFFLINE_FILES.map((file) => new Request(file, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

// readable-check: allow released-listeners - shared resource: the service worker's activate events, for its whole life
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([OFFLINE_CACHE, ASSETS_CACHE, SHARED_CACHE]);
    for (const name of await caches.keys()) {
      if (!keep.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

/** Whether a path is the app's own page, which may fall back to the offline page: never the API or a public page. */
const isAppPage = (url) => !/^\/(api|a|p|console)(\/|$)/u.test(url.pathname);

// readable-check: allow released-listeners - shared resource: the service worker's fetch events, for its whole life
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === "POST" && url.pathname === "/share") {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== "GET") return;
  if (request.mode === "navigate" && isAppPage(url)) {
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE_PAGE)) || Response.error()));
    return;
  }
  // The offline page's own script and icon, from the worker's copy when the network can't give them: the browser's
  // cache asks the server again before using them, so offline the page would stand without its Try again.
  if (OFFLINE_FILES.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(async () => (await caches.match(url.pathname)) || Response.error()));
    return;
  }
  // Vite names each built file by its content, so one kept is right for good.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS_CACHE);
      const kept = await cache.match(request);
      if (kept) return kept;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    })());
  }
});

/**
 * What another app shares into Mercbot: its title, text, link and files are kept under a one-time key, and the app
 * opens to choose the chat they go to (the shell's share picker, which reads and deletes them).
 */
async function receiveShare(request) {
  const form = await request.formData();
  const key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const cache = await caches.open(SHARED_CACHE);
  const files = form.getAll("files").filter((file) => file && typeof file === "object" && file.size >= 0);
  const text = { title: String(form.get("title") || ""), text: String(form.get("text") || ""), url: String(form.get("url") || "") };
  await cache.put(`/shared/${key}/meta`, new Response(JSON.stringify({ ...text, files: files.map((file) => ({ name: file.name, type: file.type })), at: Date.now() })));
  await Promise.all(files.map((file, index) => cache.put(`/shared/${key}/${index}`, new Response(file, { headers: { "content-type": file.type || "application/octet-stream" } }))));
  await dropOldShares(cache);
  return Response.redirect(new URL(`/?go=share&key=${key}`, self.location.origin).href, 303);
}

async function dropOldShares(cache) {
  for (const request of await cache.keys()) {
    if (!request.url.endsWith("/meta")) continue;
    const meta = await (await cache.match(request))?.json().catch(() => null);
    if (meta && Date.now() - meta.at > SHARED_FOR_MS) {
      const prefix = request.url.slice(0, -"meta".length);
      for (const entry of await cache.keys()) if (entry.url.startsWith(prefix)) await cache.delete(entry);
    }
  }
}

// A notification the server pushes: one per chat (its tag), replacing the one before, with the unread count on the
// app's icon where the device shows one.
// readable-check: allow released-listeners - shared resource: the service worker's push events, for its whole life
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Mercbot", body: event.data?.text() || "" };
  }
  event.waitUntil((async () => {
    await self.registration.showNotification(payload.title || "Mercbot", {
      body: payload.body || "",
      tag: payload.tag || "mercbot",
      renotify: true,
      icon: "/app-icons/icon-192.png",
      badge: "/app-icons/badge-96.png",
      data: { url: payload.url || "/" }
    });
    if (Number.isFinite(payload.unread) && self.navigator.setAppBadge) {
      await (payload.unread > 0 ? self.navigator.setAppBadge(payload.unread) : self.navigator.clearAppBadge()).catch(() => {});
    }
  })());
});

// Opening a notification goes to its chat: in a Mercbot window already open, else in a new one.
// readable-check: allow released-listeners - shared resource: the service worker's notificationclick events, for its whole life
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      // Focusing is the device's to allow: a window that can't be focused still goes to the chat.
      await open.focus().catch(() => {});
      return open.navigate(url).catch(() => self.clients.openWindow(url));
    }
    return self.clients.openWindow(url);
  })());
});
