/**
 * Whether a request Vite proxies to the API comes from Vite's own page: its Origin is Vite's own address. Vibe64's
 * Preview serves the page over HTTPS and hands Vite plain HTTP, so the page's Origin keeps https:// while Vite's
 * Host has no scheme of its own; either scheme counts, never another host or port.
 * @param {string | undefined} origin the request's Origin header
 * @param {string | undefined} host the Host header Vite received
 */
export function fromVitePage(origin, host) {
  return Boolean(host) && (origin === `http://${host}` || origin === `https://${host}`);
}
