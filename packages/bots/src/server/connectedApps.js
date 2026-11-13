// The person's connected accounts as bot tools use them (D-31): which accounts a
// request means, how they're named, a key for each, and what a test copy sends instead (D-69).
// Shared by Google, Microsoft and GitHub.
import { logSimulatedSideEffect } from "@jskit-ai/kernel/server/runtime/sideEffects";
import { sideEffectsAreLive } from "@jskit-ai/kernel/shared/support/sideEffects";

export class ConnectedAppError extends Error {}

/**
 * Something a connected account sends to other people (an email, a calendar invitation, update,
 * cancellation or answer, a comment or review): `act` sends it when this copy's SIDE_EFFECTS is
 * `live`. A test copy logs `effect` instead and answers as if it went out: `simulated()`, marked
 * `simulated: true` (D-69). A change with no `effect` reaches nobody, such as an event without
 * guests, so it always runs.
 * @template T
 * @param {{ env: import("@jskit-ai/kernel/server/types").RuntimeEnv }} context the action's
 * @param {{ kind: string, summary: string, details?: Record<string, unknown> } | null} effect
 * @param {() => Promise<T>} act
 * @param {() => object | Promise<object>} [simulated]
 * @returns {Promise<T | object>}
 */
export async function sendOrSimulate({ env }, effect, act, simulated = () => ({})) {
  if (!effect || sideEffectsAreLive(env)) return act();
  logSimulatedSideEffect(console, effect);
  return { ...(await simulated()), simulated: true };
}

/**
 * How an account is called: its label and address ("work · pat@example.com"), or just the address.
 * A home's account says so (D-37). Accounts are integrations.reachableAccounts records.
 */
export function accountTitle(account) {
  return `${[account.name, account.label].filter(Boolean).join(" · ")}${account.home ? " (the home's)" : ""}`;
}

// The apps' own names, so an account can be named by its app ("the Google one").
const APP_NAMES = {
  gmail: "Gmail",
  "google-calendar": "Google Calendar",
  "google-contacts": "Google Contacts",
  "google-drive": "Google Drive",
  outlook: "Outlook",
  onedrive: "OneDrive",
  github: "GitHub"
};
const appName = (account) => APP_NAMES[account.pluginId] || account.pluginId;

/**
 * An account the bot named: by its exact label, address or title, or by its app's name with or
 * without the address ("Google", "the Outlook calendar", "Google sam@example.com"), since
 * one address can be connected in two apps.
 */
function named(entry, wanted) {
  const exact = [entry.label, entry.name, accountTitle(entry), `${appName(entry)}: ${accountTitle(entry)}`]
    .some((value) => String(value || "").toLowerCase() === wanted);
  if (exact) return true;
  const words = appName(entry).toLowerCase().split(" ");
  const address = wanted.match(/[^\s<>,;"]+@[^\s<>,;"]+/u)?.[0];
  // The app is named outside the address: "sam@gmail.com" doesn't say Gmail.
  const said = address ? wanted.replace(address, " ") : wanted;
  const saysApp =
    said.includes(appName(entry).toLowerCase()) ||
    words.some((word) => word.length > 3 && said.includes(word) && !["calendar", "contacts", "drive"].includes(word));
  return saysApp && (!address || String(entry.label || "").toLowerCase() === address);
}

/**
 * The connected accounts a tool should use, from one or more plugins (Gmail and Outlook for mail):
 * the one the bot named, by address or label, or else all of them, each with its id and title.
 * `reach` says whose: the person's own and the home's, or only the home's (D-37).
 * `skip` lists apps the person has switched this action off for in Connect apps.
 * An action the person switched off for an app is never blamed on the account.
 * `own` leaves the home's accounts out: only the person's own are used.
 */
const switchedOff = (apps) =>
  new ConnectedAppError(
    `The person has switched this action off for ${apps.join(" and ")} in Connect apps, so don't do it there, nor on its ` +
      `website. Say so plainly in one line and that they can switch it back on in Connect apps (the app's Tools). Don't blame the ` +
      `account and don't ask which account.`
  );

export async function connectedAccounts({ integrations, reach, skip = [], call, own = false }, pluginIds, name, wanted = "") {
  const all = [].concat(pluginIds);
  const allowed = all.filter((id) => !skip.includes(id));
  const skipped = all.filter((id) => skip.includes(id));
  const offApps = () => skipped.map((id) => APP_NAMES[id] || id);
  if (!allowed.length) throw switchedOff(offApps());
  // The connected accounts of these apps the call reaches, in id order, read once.
  const connected = (await integrations.reachableAccounts(reach, call, { status: "connected", pluginIds: all }))
    .filter((account) => !(own && account.home));
  /** In the apps' own order (Google first, then Microsoft), so "my calendar" picks the same one each time. */
  const accounts = connected.filter((account) => allowed.includes(account.pluginId))
    .sort((a, b) => allowed.indexOf(a.pluginId) - allowed.indexOf(b.pluginId));
  const several = allowed.length > 1;
  const titled = (entry) => (several ? `${appName(entry)}: ${accountTitle(entry)}` : accountTitle(entry));
  /** The accounts of the apps it's switched off for, to tell that apart from a wrong name. */
  const offAccounts = connected.filter((account) => skipped.includes(account.pluginId));
  if (!accounts.length) {
    if (offAccounts.length) throw switchedOff(offApps());
    throw new ConnectedAppError(
      `${name} isn't connected. Offer to connect it in Connect apps, or use the website in your browser instead.`
    );
  }
  const match = String(wanted || "").trim().toLowerCase();
  const chosen = match ? accounts.filter((entry) => named(entry, match)) : accounts;
  if (!chosen.length) {
    if (offAccounts.some((entry) => named(entry, match))) throw switchedOff(offApps());
    throw new ConnectedAppError(
      `There's no connected ${name} account called ${wanted}. Connected: ${accounts.map(titled).join("; ")}. Don't guess: ask ` +
        `which with ask_with_options (a card), listing these.`
    );
  }
  return chosen.map((account) => ({
    id: account.id,
    pluginId: account.pluginId,
    app: appName(account),
    account: titled(account),
    address: account.label
  }));
}

/** The accounts connectedAccounts picks, each with a key for calling its app. */
export async function connectedKeys(access, pluginIds, name, wanted = "") {
  const chosen = await connectedAccounts(access, pluginIds, name, wanted);
  const { integrations, reach, call } = access;
  return Promise.all(chosen.map(async (entry) => ({
    ...entry,
    key: (await integrations.connections.accessToken(reach, entry.id, call)).accessToken
  })));
}

/**
 * One account, for something done in a single place (reading one email, adding one event). With
 * several connected and none named, the bot has to say which.
 */
export async function connectedKey(app, pluginIds, name, wanted = "") {
  const keys = await connectedKeys(app, pluginIds, name, wanted);
  if (keys.length > 1) {
    throw new ConnectedAppError(
      `Several ${name} accounts are connected (${keys.map((entry) => entry.account).join("; ")}). Say which one by its address; ` +
        `if the person didn't say, ask them with ask_with_options.`
    );
  }
  return keys[0];
}

/** A local time such as "2026-10-28T13:00" in a time zone, with its offset, e.g. 2026-10-28T13:00:00+11:00. */
export function zoned(local, timeZone) {
  const plain = String(local).length === 10 ? `${local}T00:00:00` : String(local).length === 16 ? `${local}:00` : String(local);
  if (/(Z|[+-]\d\d:\d\d)$/u.test(plain)) return plain;
  const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date(`${plain}Z`))
    .find((part) => part.type === "timeZoneName").value.replace("GMT", "");
  return `${plain}${offset || "+00:00"}`;
}

/** A moment as local time in a time zone, with its offset, e.g. 2026-11-03T13:00+11:00. */
export function localTime(moment, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset"
    })
      .formatToParts(new Date(moment))
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}${parts.timeZoneName.replace("GMT", "") || "+00:00"}`;
}
