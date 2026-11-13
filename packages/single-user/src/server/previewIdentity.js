import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { SINGLE_USER_EMAIL } from "@local/account/this-copy";
import { KEY_COOKIE } from "./gate.js";
import { loadKey } from "./key.js";

/**
 * How a managed Preview (tools/preview-identity, JSKIT's managed preview identity `exchange`) signs its browser in to a
 * person's own copy and out again: in, as `mercbot open` does, by opening /open with the copy's key and handing the
 * browser the cookies it set; out, by taking the key's cookie away, so the gate turns the browser back. The copy has
 * one person, so only they can be signed in.
 * @param {{ MERCBOT_DATA_DIR?: string }} env where the copy keeps its key
 */
export function openWithKey(env) {
  return async ({ operation, identity, targetOrigin, fetchImpl }) => {
    if (operation === "logout") {
      // readable-check: allow setter-seam - not a slot: setCookie is the preview identity protocol's list of Set-Cookie headers
      return { setCookie: [`${KEY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`] };
    }
    if (String(identity?.email || "").toLowerCase() !== SINGLE_USER_EMAIL) {
      throw new AppError(404, `This copy of Mercbot has one person, ${SINGLE_USER_EMAIL}.`, { code: "mercbot_one_person" });
    }
    const opened = await fetchImpl(`${targetOrigin}/open?key=${loadKey(env)}`, { redirect: "manual" });
    if (opened.status !== 200) {
      throw new AppError(502, `Mercbot didn't open with its key (HTTP ${opened.status}).`, { code: "mercbot_not_opened" });
    }
    // readable-check: allow setter-seam - not a slot: setCookie is the preview identity protocol's list of Set-Cookie headers
    return { setCookie: opened.headers.getSetCookie() };
  };
}
