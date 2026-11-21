// Connect apps' catalogue: how apps are grouped, searched, labelled and summed up.
// Pure, so the modal only holds state and the rules stay testable.

export const MAIN_CATEGORIES = ["Password Managers", "Productivity", "Communication", "Design", "Code"];
export const MORE_CATEGORIES = ["Data", "Sales", "Marketing", "Finance", "Research", "Support"];
const SECTION_LIMIT = 4;

const inCategory = (plugins, name) => plugins.filter((plugin) => (plugin.categories || [plugin.category]).includes(name));

/** The catalogue's sections: one category, or the recommended apps then every category's first few. */
export function catalogueSections(plugins, category) {
  if (category !== "All") return [{ title: category, plugins: inCategory(plugins, category), viewAll: false }];
  return [
    // The owner's order (D-33): the catalogue arrives sorted by it, tier 1 first.
    { title: "Recommended for you", plugins: plugins.slice(0, 6), viewAll: false },
    ...[...MAIN_CATEGORIES, ...MORE_CATEGORIES].map((name) => ({
      title: name,
      plugins: inCategory(plugins, name).slice(0, SECTION_LIMIT),
      viewAll: inCategory(plugins, name).length > 0
    })).filter((section) => section.plugins.length)
  ];
}

/** Search: up to eight apps whose name, description or skills match. */
export function searchApps(plugins, query) {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  return plugins.filter((plugin) =>
    plugin.name.toLowerCase().includes(text) ||
    plugin.description.toLowerCase().includes(text) ||
    plugin.skills.some((entry) => entry.name.includes(text) || entry.description.toLowerCase().includes(text))
  ).slice(0, 8);
}

/** The categories whose names match the search. */
export function searchCategories(query) {
  const text = query.trim().toLowerCase();
  return text ? [...MAIN_CATEGORIES, ...MORE_CATEGORIES].filter((name) => name.toLowerCase().includes(text)) : [];
}

// The owner's badges (D-33), and apps whose connection isn't built yet: listed, but not addable.
export const BADGES = { b: "Beta: built, not yet tested by hand", "✓": "Tested", "★": "Works well" };

// Catalogue rows show the logo, the name and one pill: Add (which never signs in, D-110), or Request for an
// app that's coming.
export const actionLabel = (plugin) => (plugin.soon ? (plugin.wanted ? "Requested" : "Request") : plugin.installed ? "Added" : "Add");

// Where an account's sign-in stands: the words and the button for each state.
// "more-access": connected, but the app now asks for more than it was given (D-42).
export const NEEDS = { "needs-auth": "Sign in", started: "Reconnect", failed: "Retry", "more-access": "Sign in again" };
const WORST = ["failed", "started", "needs-auth", "more-access", "connected"];
// An account the bots can use: connected, even when it needs signing in again for more access.
export const working = (account) => account.status === "connected" || account.status === "more-access";
export const worstState = (plugin) => WORST.find((state) => plugin.accounts.some((account) => account.status === state)) || "needs-auth";

// The installed overview shows six apps, then "Show all N plugins".
export const OVERVIEW_LIMIT = 6;
export const parts = (plugin) => [
  `${plugin.connectors.length} connector${plugin.connectors.length === 1 ? "" : "s"}`,
  ...(plugin.skills?.length ? [`${plugin.skills.length} skill${plugin.skills.length === 1 ? "" : "s"}`] : [])
].join(", ");

/** How many of an app's tools the bot may use. */
export const enabledCount = (plugin) => plugin.actions.filter((action) => action.enabled).length;

/**
 * Whether people connect the app: by signing in through Google, Microsoft or GitHub, or the app's own connection point
 * (D-34), or with API credentials an owner or admin enters (D-93).
 */
export const signsIn = (plugin) => Boolean(plugin.oauth || plugin.mcp || plugin.credentials);

/** The Information table's availability follows the accounts once sign-in exists for the app. */
export function availability(plugin) {
  if (!signsIn(plugin)) return plugin.info.availability;
  const connected = plugin.accounts.filter(working).length;
  if (connected) return connected > 1 ? `Connected (${connected} accounts)` : "Connected";
  if (plugin.credentials) return plugin.accounts.length ? "Added; needs its API credentials" : "Not added yet";
  return plugin.installed ? "Added; needs sign-in" : "Not added yet";
}

// How an account row reads: "label · address", just the address, or the label before sign-in.
export const accountTitle = (account) => [account.name, account.label].filter(Boolean).join(" · ") || "Not signed in yet";

const PROVIDER_NAMES = { google: "Google", microsoft: "Microsoft", github: "GitHub" };

/** Whose sign-in an app's accounts use: Google's, Microsoft's, GitHub's, or the app's own (D-34); none for API credentials. */
export const signInName = (plugin) => (plugin.credentials ? "" : PROVIDER_NAMES[plugin.oauth?.provider] || plugin.name);

// The apps whose accounts are mailboxes, which bots read and send from.
const MAILBOXES = new Set(["gmail", "outlook"]);

/**
 * Who uses an app's accounts, in words (D-111): everyone in the home and their bots, from the account's address, or
 * before it's signed in "the account you connect".
 * @param {{ id: string }} plugin
 * @param {string} homeName
 * @param {string} [address]
 */
export function sharedWith(plugin, homeName, address = "") {
  const what = address || "the account you connect";
  return `Everyone in ${homeName}, and their bots, can ${MAILBOXES.has(plugin.id) ? "read and send from" : "use"} ${what}.`;
}

/**
 * One account's line in Connect apps (D-110, D-111): that everyone in the home and their bots use it, who added it,
 * and what the person looking at it may do (the server's `canChange`: the person who added it, and the home's owners
 * and admins). Every line has the same bin, the first one included.
 * @param {{ addedBy?: string, addedByYou?: boolean, canChange?: boolean, status: string, label?: string | null }} account
 * @param {{ id: string, credentials?: object }} plugin
 * @param {{ homeName: string }} where
 */
export function accountLine(account, plugin, { homeName }) {
  const canChange = Boolean(account.canChange);
  return {
    who: sharedWith(plugin, homeName, account.label || ""),
    addedBy: account.addedByYou ? "you" : account.addedBy || "",
    canChange,
    canRemove: canChange,
    removeQuestion: `Remove it for everyone in ${homeName}? Their bots stop using it.`,
    status: account.status === "connected" ? "Connected" : account.status === "more-access" ? "Needs more access" : plugin.credentials ? "Not connected" : "Needs sign-in",
    // Signing in again keeps to the address the line already has (D-110).
    signIn: working(account) && account.status !== "more-access"
      ? ""
      : plugin.credentials?.button || (account.status === "needs-auth" && account.label ? "Sign in again" : NEEDS[account.status] || "Sign in")
  };
}

/**
 * What removing an app from the home takes with it (D-111), asked before it goes.
 * @param {{ name: string, accounts: Array<object> }} plugin
 * @param {string} homeName
 */
export function removeAppQuestion(plugin, homeName) {
  const count = plugin.accounts.length;
  const going = count ? `, with its ${count === 1 ? "account" : `${count} accounts`}` : "";
  return `Remove ${plugin.name} from ${homeName}${going}? Everyone's bots stop using it.`;
}

/**
 * What the Add account step says will happen, and its button (D-110): on a computer the app's sign-in opens in a window
 * of its own, which closes once it's done; on a phone it takes this tab and comes back. API credentials are typed here.
 * @param {{ credentials?: object, oauth?: { provider: string }, name: string }} plugin
 * @param {boolean} inThisTab
 */
export function addAccountStep(plugin, inThisTab) {
  const by = signInName(plugin);
  if (!by) return { note: `You enter ${plugin.name}'s API credentials next.`, submit: "Add" };
  return {
    note: inThisTab ? `${by}'s sign-in opens here, then brings you back.` : `A ${by} window opens so you can pick the account.`,
    submit: `Sign in with ${by}`
  };
}
