import { publicFetch } from "@local/account/public-address";

// How many redirects a guarded read-back follows, each checked like the address itself.
const REDIRECTS = 5;

/**
 * The answer at `url`. A website someone who runs the copy set up is read as fetch reads it, redirects followed. Anyone
 * else's is read through `get` (publicFetch: public internet addresses only), which follows no redirect itself, so each
 * address a redirect leads to is checked too.
 */
async function answerAt(url, { guarded, get, signal }) {
  const headers = { "cache-control": "no-cache" };
  if (!guarded) return fetch(url, { redirect: "follow", headers, signal });
  let address = url;
  for (let hop = 0; hop <= REDIRECTS; hop += 1) {
    const response = await get(address, { headers, signal });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!location) return response;
    await response.body?.cancel();
    address = new URL(location, address).href;
  }
  throw new Error(`${url} redirects too many times`);
}

/**
 * Reads a published page back at its address (D-84), to tell the person whether their website answers with the copy
 * just uploaded: the stamp the copy carries shows it is this one, not an older copy or something else. A wrong base
 * URL, or a web server that doesn't serve the place pages are uploaded to, is said plainly. A website not set up by
 * someone who runs the copy is read only at public internet addresses (`guarded`).
 * @param {string} url
 * @param {string} stamp
 * @param {{ seconds?: number, guarded?: boolean, get?: typeof fetch }} [options] `get`: how a guarded read reaches each
 *   address (tests: a stand-in for the internet that hands the rest to publicFetch)
 * @returns {Promise<{ ok: true } | { ok: false, code: string, message: string, status?: number }>}
 */
export async function checkAnswer(url, stamp, { seconds = 10, guarded = false, get = publicFetch() } = {}) {
  const advice = "Check that the website's address in Settings → Website is where its web server serves the place pages are uploaded to.";
  let response;
  try {
    response = await answerAt(url, { guarded, get, signal: AbortSignal.timeout(seconds * 1000) });
  } catch (error) {
    if (error?.code === "PRIVATE_ADDRESS") {
      return {
        ok: false,
        code: "websites_check_private",
        message: `The page was uploaded, but ${url} leads to a private network address, which Mercbot reads only for a website set up by someone who runs this copy. Check that the website's address in Settings → Website is its address on the internet.`
      };
    }
    return { ok: false, code: "websites_check_unreachable", message: `The page was uploaded, but nothing answered at ${url}. ${advice}` };
  }
  if (!response.ok) {
    await response.body?.cancel();
    const status = response.status;
    return { ok: false, code: "websites_check_status", status, message: `The page was uploaded, but ${url} answered ${status}${status === 404 ? " (not found)" : ""}. ${advice}` };
  }
  const text = await response.text().catch(() => "");
  if (!text.includes(stamp)) return { ok: false, code: "websites_check_other_page", message: `The page was uploaded, but ${url} answers with something else. ${advice}` };
  return { ok: true };
}
