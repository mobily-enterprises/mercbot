import { AI_KINDS, WORK, aiReady, settingOf } from "./providers/index.js";
import { serverRoleOf } from "./serverRole.js";

/**
 * One key or account a copy of Mercbot can be given: what it's for, the settings that give it (an optional one doesn't
 * decide whether it's on), what's off without it, and, where its settings alone don't say, whether it's on (`ready`).
 * Mercbot starts without any of them: each turns its feature on when it's there, and the server says at start what's
 * off (missingKeyLines). `computers` is what's off without it on a computers server (D-131), for the keys that role
 * uses; a key without it is a web server's only.
 * @typedef {{ name: string, purpose: string, settings: ReadonlyArray<{ name: string, optional?: boolean }>, missing: string,
 *   computers?: string, ready?: (env: import("@jskit-ai/kernel/server/types").RuntimeEnv) => boolean }} KeyEntry
 */

// What bots can't do without the premium or the economy AI (providers/index.js, botsAiOff).
const BOTS_OFF = "Bots start no work: each says this copy's AI isn't set up, and which settings to add.";

/** @type {ReadonlyArray<KeyEntry>} */
const AI_ENTRIES = Object.values(AI_KINDS).map((kind) => ({
  name: kind.name,
  purpose: `${Object.values(WORK).filter((work) => work.kind === kind.id).map((work) => work.what).join(". ")}.`,
  settings: [{ name: kind.providerSetting }, { name: kind.keySetting }],
  missing: kind.id === "images"
    ? "Bots can't make or edit pictures, and say pictures aren't set up on this copy. The Vault can't read contact details from photos."
    : BOTS_OFF,
  // A computers server runs its computers' browser steps (stagehandModel.js), on the kind WORK.browser names.
  ...(kind.id === WORK.browser.kind ? { computers: "The bots' browser steps on this server's computers can't run." } : {}),
  // On the stand-in model (D-83) a kind needs no key.
  ready: (env) => aiReady(env, kind.id)
}));

/** @type {ReadonlyArray<KeyEntry>} */
const OTHER_ENTRIES = [
  {
    name: "Public address",
    purpose: "Every link Mercbot sends or shows: connected apps' return address and websites.",
    settings: [{ name: "APP_PUBLIC_URL" }],
    missing: "Links point at http://localhost, so they only work on this computer."
  },
  {
    name: "Vault key",
    purpose: "Seals Vault passwords and cards, connected accounts' tokens, scripts' secret web headers, a home's own storage details and bots' saved browsers.",
    settings: [{ name: "MERCBOT_VAULT_KEY" }],
    missing: "The Vault takes no logins or cards, apps can't be connected, and bots' browser sign-ins don't outlive their machine.",
    computers: "Bots' browser sign-ins on this server's computers don't outlive their machine."
  },
  {
    name: "Notifications key",
    purpose: "Signs the notifications Mercbot sends to people's phones and browsers (D-133): any long random value.",
    settings: [{ name: "MERCBOT_PUSH_SECRET" }],
    missing: "Nobody can turn notifications on: Settings says they aren't set up on this copy."
  },
  {
    name: "Google app",
    purpose: "Lets people connect Gmail, Google Calendar, Google Contacts and Google Drive.",
    settings: [{ name: "GOOGLE_CLIENT_ID" }, { name: "GOOGLE_CLIENT_SECRET" }],
    missing: "Google's apps can't be connected.",
    // A home's files kept in Google Drive are mounted on the server that runs its computer, which renews the Drive's
    // key itself (D-80, its drive-token route).
    computers: "A home's files kept in Google Drive can't be opened on this server's computers once the Drive's key runs out."
  },
  {
    name: "Microsoft app",
    purpose: "Lets people connect Outlook mail, calendar and contacts, and OneDrive.",
    settings: [{ name: "MICROSOFT_CLIENT_ID" }, { name: "MICROSOFT_CLIENT_SECRET" }],
    missing: "Microsoft's apps can't be connected."
  },
  {
    name: "GitHub app",
    purpose: "Lets people connect GitHub.",
    settings: [{ name: "GITHUB_CLIENT_ID" }, { name: "GITHUB_CLIENT_SECRET" }],
    missing: "GitHub can't be connected."
  },
  {
    name: "GitHub App",
    purpose: "Lets bots' commands push to the GitHub repositories each person allows, through the copy's GitHub App (whose client is the GitHub app's).",
    settings: [{ name: "GITHUB_APP_ID" }, { name: "GITHUB_APP_SLUG" }, { name: "GITHUB_APP_PRIVATE_KEY" }],
    missing: "Bots' commands can't sign in to GitHub, so they can't push; GitHub connects for reading only."
  },
  {
    name: "Bots' file storage",
    purpose: "The S3 bucket every server keeps bots' files in, each file sealed with the passphrase (any store speaking the S3 API, at its endpoint).",
    settings: [
      { name: "MERCBOT_FILES_S3_BUCKET" },
      { name: "MERCBOT_FILES_S3_REGION" },
      { name: "MERCBOT_FILES_S3_ACCESS_KEY_ID" },
      { name: "MERCBOT_FILES_S3_SECRET_ACCESS_KEY" },
      { name: "MERCBOT_FILES_PASSPHRASE" },
      { name: "MERCBOT_FILES_S3_ENDPOINT", optional: true },
      { name: "MERCBOT_FILES_S3_PREFIX", optional: true },
      { name: "MERCBOT_FILES_DIR", optional: true }
    ],
    missing: "Files stay in a folder on this machine, which only suits a single server.",
    computers: "Its computers' files stay in a folder on this machine, where no other server finds them."
  },
  {
    name: "Another Mercbot to link to",
    purpose: "Lets a copy without its own apps link to another Mercbot and use its connections.",
    settings: [{ name: "MERCBOT_HUB_URL" }],
    missing: "Linking to another Mercbot is off."
  }
];

/** Every key and account a copy of Mercbot can be given, in the order they're listed. */
export const KEYS = Object.freeze([...AI_ENTRIES, ...OTHER_ENTRIES]);

/**
 * Every key and account, with whether each setting is set here (never its value) and whether the entry is `set`,
 * `partly` set or `missing`, by the settings that aren't optional. `keys` are Mercbot's own unless a copy built on it
 * lists its own keys the same way.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {ReadonlyArray<KeyEntry>} [keys]
 */
export function keysOf(env, keys = KEYS) {
  return keys.map((entry) => {
    const settings = entry.settings.map(({ name, optional = false }) => ({ name, optional, set: Boolean(settingOf(env, name)) }));
    const needed = settings.filter((setting) => !setting.optional);
    const done = needed.filter((setting) => setting.set).length;
    return {
      name: entry.name,
      purpose: entry.purpose,
      settings,
      status: done === needed.length ? "set" : done ? "partly" : "missing",
      missing: entry.missing
    };
  });
}

/**
 * The server's line at start for each setting a feature that's off here still needs, saying what's off: one line a
 * missing key. A feature that's on (its settings, or `ready`, as on the stand-in model) has none. Only the keys this
 * server's role uses are named (serverRoleOf, D-131): every key on a web server, and on a computers server those with
 * a `computers` text, which says what's off there.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {ReadonlyArray<KeyEntry>} [keys] as keysOf's
 * @returns {string[]}
 */
export function missingKeyLines(env, keys = KEYS) {
  const computers = serverRoleOf(env) === "computers";
  return keys.flatMap((entry) => {
    const missing = computers ? entry.computers : entry.missing;
    if (!missing) return [];
    const unset = entry.settings.filter((setting) => !setting.optional && !settingOf(env, setting.name)).map((setting) => setting.name);
    const on = entry.ready ? entry.ready(env) : !unset.length;
    return on ? [] : unset.map((name) => `${name} isn't set, so this is off: ${entry.name}. ${missing}`);
  });
}
