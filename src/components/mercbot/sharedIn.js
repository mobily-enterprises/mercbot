// What another app shares into the installed app (D-133): the service worker keeps its words and files under a
// one-time key for an hour (src/public/sw.js), the shell reads them once a chat is chosen, and they go into that chat's
// message box only once it's the chat open.
// The service worker keeps shares in this cache (src/public/sw.js): the two names stay alike.
const SHARED_CACHE = "mercbot-shared";
const CHAT_OPENS_MS = 2000;
const CHECK_EVERY_MS = 50;

/**
 * The share kept under `key`, read once and then forgotten: `{ text, files }`, or `{ gone: true }` when it's no longer
 * kept (past its hour, opened already, or a browser that keeps none).
 * @param {string} key
 * @param {CacheStorage | undefined} [storage]
 */
export async function readShare(key, storage = globalThis.caches) {
  if (!storage) return { gone: true };
  const cache = await storage.open(SHARED_CACHE);
  const meta = await (await cache.match(`/shared/${key}/meta`))?.json();
  if (!meta) return { gone: true };
  const files = [];
  for (const [index, file] of (meta.files || []).entries()) {
    const kept = await cache.match(`/shared/${key}/${index}`);
    if (kept) files.push(new File([await kept.blob()], file.name || `Shared ${index + 1}`, { type: file.type || "" }));
  }
  for (const request of await cache.keys()) {
    if (request.url.includes(`/shared/${key}/`)) await cache.delete(request);
  }
  const words = [meta.title, meta.text, meta.url].map((part) => String(part || "").trim()).filter(Boolean);
  // A link often comes in its text as well: it's said once.
  const text = [...new Set(words)].filter((part, _index, all) => !all.some((other) => other !== part && other.includes(part))).join("\n");
  return text || files.length ? { text, files } : { gone: true };
}

/**
 * Waits for `chatId` to be the chat open, a little while: true once it is, false if it never opens.
 * @param {() => string} openChatId
 * @param {string} chatId
 */
export async function waitForChat(openChatId, chatId) {
  for (let waited = 0; waited <= CHAT_OPENS_MS; waited += CHECK_EVERY_MS) {
    if (openChatId() === chatId) return true;
    await new Promise((resolve) => setTimeout(resolve, CHECK_EVERY_MS));
  }
  return false;
}
