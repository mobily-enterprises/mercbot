// Leaving an app (D-106). An app's own navigation adds a history entry and a step of JSKIT's navigation trail for each
// place opened in it, as before; leaving goes at once to the Mercbot place the app was opened from: the nearest step of
// the trail outside the app.

const pathOf = (location) => String(location || "").split(/[?#]/u)[0];

/** Whether `location` (a path with its query) is in the app whose address is `base`. */
export function insideApp(location, base) {
  const path = pathOf(location);
  return path === base || path.startsWith(`${base}/`);
}

/**
 * The Mercbot place the app was opened from: the nearest step of JSKIT's trail (`{ path }`, oldest first) that isn't in
 * the app, with its query, or null when the app was entered directly (a link opened in a new tab, a pasted address).
 * @param {ReadonlyArray<{ path: string }>} trail
 * @param {string} base The app's address in the home.
 * @returns {string | null}
 */
export function openerOf(trail, base) {
  return [...(trail || [])].reverse().find((step) => !insideApp(step.path, base))?.path ?? null;
}

/**
 * Where leaving lands: a bot's chat (`botId`), Apps, Files, or Mercbot (the home's chat, or any other Mercbot place).
 * @param {string | null} from The place the app was opened from.
 * @param {string} homeBase The home's own address, its chat.
 * @returns {{ place: "bot" | "apps" | "files" | "mercbot", botId?: string }}
 */
export function exitPlace(from, homeBase) {
  if (!from) return { place: "mercbot" };
  const address = new URL(from, "http://mercbot.invalid");
  const bare = (path) => path.replace(/\/+$/u, "") || "/";
  const path = bare(address.pathname);
  const home = bare(homeBase);
  const bot = address.searchParams.get("bot");
  if (path === home && bot) return { place: "bot", botId: bot };
  if (path === `${home}/apps`) return { place: "apps" };
  if (path === `${home}/files`) return { place: "files" };
  return { place: "mercbot" };
}

/**
 * The words of the app's way out: where it goes. A bot's chat says the bot's name once it's known.
 * @param {{ place: string }} place
 * @param {string} [botName]
 */
export function exitLabel(place, botName = "") {
  if (place.place === "bot") return botName ? `Back to ${botName}` : "Back to chat";
  if (place.place === "apps") return "Back to Apps";
  if (place.place === "files") return "Back to Files";
  return "Back to Mercbot";
}
