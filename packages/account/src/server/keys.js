import { AI_KINDS, WORK, aiReady, settingOf } from "./providers/index.js";

/**
 * One key or account a copy of Mercbot can be given: what it's for, the settings that give it (an optional one doesn't
 * decide whether it's on), what's off without it, and, where its settings alone don't say, whether it's on (`ready`).
 * Mercbot starts without any of them: each turns its feature on when it's there, and the server says at start what's
 * off (missingKeyLines).
 * @typedef {{ name: string, purpose: string, settings: ReadonlyArray<{ name: string, optional?: boolean }>, missing: string,
 *   ready?: (env: import("@jskit-ai/kernel/server/types").RuntimeEnv) => boolean }} KeyEntry
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
    missing: "The Vault takes no logins or cards, apps can't be connected, and bots' browser sign-ins don't outlive their machine."
  },
  {
    name: "Google app",
    purpose: "Lets people connect Gmail, Google Calendar, Google Contacts and Google Drive.",
    settings: [{ name: "GOOGLE_CLIENT_ID" }, { name: "GOOGLE_CLIENT_SECRET" }],
    missing: "Google's apps can't be connected."
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
    name: "Bots' file storage",
    purpose: "The shared, encrypted file volume bots keep their files on, and the object storage behind it.",
    settings: [
      { name: "MERCBOT_FILES_DIR" },
      { name: "MERCBOT_FILES_PASSPHRASE" },
      { name: "MERCBOT_FILES_STORAGE", optional: true },
      { name: "MERCBOT_FILES_BUCKET", optional: true },
      { name: "ACCESS_KEY", optional: true },
      { name: "SECRET_KEY", optional: true }
    ],
    missing: "Files stay in a folder on this machine, which only suits a single server."
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
 * missing key. A feature that's on (its settings, or `ready`, as on the stand-in model) has none.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {ReadonlyArray<KeyEntry>} [keys] as keysOf's
 * @returns {string[]}
 */
export function missingKeyLines(env, keys = KEYS) {
  return keys.flatMap((entry) => {
    const unset = entry.settings.filter((setting) => !setting.optional && !settingOf(env, setting.name)).map((setting) => setting.name);
    const on = entry.ready ? entry.ready(env) : !unset.length;
    return on ? [] : unset.map((name) => `${name} isn't set, so this is off: ${entry.name}. ${entry.missing}`);
  });
}
