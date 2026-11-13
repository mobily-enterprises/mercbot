import { screenLocation } from "@/components/apps/appRuntime.js";

// What a page's frame may tell the viewer (D-74). The page runs in a sandbox with an opaque origin,
// so its messages come from "null" and are only data: each is checked for exactly its own shape and
// anything else is dropped. Its helper sends { mercbotPage: 1, kind, ... }.
const MAX_HEIGHT = 50000;
const MAX_TICKS = 500;
const MAX_PARAMS = 10;
// An app's slug; a screen's key and a parameter's name as the helper reads them from data-*
// attributes (data-lesson-id is lessonId).
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const PARAM = /^[A-Za-z][A-Za-z0-9_]{0,39}$/u;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function readTicks(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_TICKS) return null;
  const valid = items.every((item) => isRecord(item) && Number.isInteger(item.tick) && item.tick >= 0 && item.tick < 10000 && typeof item.done === "boolean");
  return valid ? items.map(({ tick, done }) => ({ tick, done })) : null;
}

function readLink(href) {
  if (typeof href !== "string" || href.length > 2048) return null;
  try {
    const url = new URL(href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** An app's screen and its parameters: short names and up to 10 short text values. */
function readDoorway(data) {
  if (typeof data.app !== "string" || !SLUG.test(data.app)) return null;
  const screen = data.screen == null || data.screen === "" ? "" : data.screen;
  if (screen && (typeof screen !== "string" || !KEY.test(screen))) return null;
  const params = data.params == null ? {} : data.params;
  if (!isRecord(params)) return null;
  const entries = Object.entries(params);
  const valid = entries.length <= MAX_PARAMS &&
    entries.every(([name, value]) => PARAM.test(name) && typeof value === "string" && value.length <= 200);
  return valid ? { kind: "open-app", app: data.app, screen, params: Object.fromEntries(entries) } : null;
}

/**
 * The message a page's frame sent, checked and copied, or null for anything else.
 * @param {unknown} data
 * @returns {{ kind: "height", height: number } | { kind: "ticks", items: Array<{ tick: number, done: boolean }> }
 *   | { kind: "link", href: string } | { kind: "open-app", app: string, screen: string, params: Record<string, string> } | null}
 */
export function readPageMessage(data) {
  if (!isRecord(data) || data.mercbotPage !== 1) return null;
  if (data.kind === "height") {
    return Number.isFinite(data.height) && data.height >= 0 ? { kind: "height", height: Math.min(Math.ceil(data.height), MAX_HEIGHT) } : null;
  }
  if (data.kind === "ticks") {
    const items = readTicks(data.items);
    return items ? { kind: "ticks", items } : null;
  }
  if (data.kind === "link") {
    const href = readLink(data.href);
    return href ? { kind: "link", href } : null;
  }
  return data.kind === "open-app" ? readDoorway(data) : null;
}

/**
 * Where the doorway takes the person (D-40, D-74): only to an app or view on the home's list, which is
 * what everyone in the home may open (D-66), on the screen the page named if it has it, else its
 * first, with only the parameters that screen takes. Answers { location }, or { problem } to say why not.
 * @param {{ app: string, screen: string, params: Record<string, string> }} door
 * @param {{ listApps: () => Promise<{ apps: Array<{ slug: string }> }>, getApp: (slug: string) => Promise<any>,
 *   appAddress: (slug: string) => string }} home the home's apps, and an app's address in it
 * @returns {Promise<{ location: { path: string, query: Record<string, string> } } | { problem: string }>}
 */
export async function doorwayLocation({ app, screen, params }, { listApps, getApp, appAddress }) {
  const listed = (await listApps()).apps.find((entry) => entry.slug === app);
  if (!listed) return { problem: `There's no app "${app}" in this home.` };
  const found = await getApp(listed.slug);
  const screens = found?.definition?.screens;
  if (!screens) return { problem: `${found?.app?.name || "That app"} hasn't been published yet.` };
  const key = screen && Object.hasOwn(screens, screen) ? screen : found.definition.home;
  return { location: screenLocation(screens, appAddress(listed.slug), key, params) };
}
