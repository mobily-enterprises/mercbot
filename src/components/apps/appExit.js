// Leaving an app or the Apps page (D-106, D-123). Moving between an app's own places replaces the open history entry
// (AppFrame.vue), so an app never stacks entries. One close leaves the whole apps area (/w/<home>/apps and everything
// under it) for the place it was entered from: the nearest step of JSKIT's trail outside the area.

const pathOf = (location) => String(location || "").split(/[?#]/u)[0];

/** Whether `location` (a path with its query) is at `base` or under it: in an app, or in the apps area. */
export function insideApp(location, base) {
  const path = pathOf(location);
  return path === base || path.startsWith(`${base}/`);
}

/**
 * The place the apps area was entered from: the nearest step of JSKIT's trail (`{ path }`, oldest first) that isn't in
 * the area (Apps, an app, a table), with its query, or null when the area was entered directly (a link opened in a new
 * tab, a pasted address).
 * @param {ReadonlyArray<{ path: string }>} trail
 * @param {string} base The apps area's address in the home (`appsAreaOf`).
 * @returns {string | null}
 */
export function openerOf(trail, base) {
  return [...(trail || [])].reverse().find((step) => !insideApp(step.path, base))?.path ?? null;
}

/** The apps area's address in a home: the Apps page, every app and every table are under it. */
export const appsAreaOf = (homeBase) => `${String(homeBase || "").replace(/\/+$/u, "")}/apps`;

/**
 * Where leaving lands: a chat (`chatId`), Apps, Files, or Mercbot (the home's own address, or any other Mercbot place).
 * @param {string | null} from The place the app was opened from.
 * @param {string} homeBase The home's own address.
 * @returns {{ place: "chat" | "apps" | "files" | "mercbot", chatId?: string }}
 */
export function exitPlace(from, homeBase) {
  if (!from) return { place: "mercbot" };
  const address = new URL(from, "http://mercbot.invalid");
  const bare = (path) => path.replace(/\/+$/u, "") || "/";
  const path = bare(address.pathname);
  const home = bare(homeBase);
  const chat = address.searchParams.get("chat");
  if (path === home && chat) return { place: "chat", chatId: chat };
  if (path === `${home}/apps`) return { place: "apps" };
  if (path === `${home}/files`) return { place: "files" };
  return { place: "mercbot" };
}

/**
 * The words of the app's way out: where it goes. A chat says its name once it's known.
 * @param {{ place: string }} place
 * @param {string} [chatName]
 */
export function exitLabel(place, chatName = "") {
  if (place.place === "chat") return chatName ? `Back to ${chatName}` : "Back to chat";
  if (place.place === "apps") return "Back to Apps";
  if (place.place === "files") return "Back to Files";
  return "Back to Mercbot";
}
