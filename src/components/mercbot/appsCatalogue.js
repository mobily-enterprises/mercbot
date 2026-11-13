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

// Catalogue rows show the logo, the name and one pill: Connect, or Request for an
// app that's coming.
export const actionLabel = (plugin) => (plugin.soon ? (plugin.wanted ? "Requested" : "Request") : plugin.installed ? "Added" : "Connect");

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

/** Whether people sign in to the app: through Google, Microsoft or GitHub, or the app's own connection point (D-34). */
export const signsIn = (plugin) => Boolean(plugin.oauth || plugin.mcp);

/** The Information table's availability follows the accounts once sign-in exists for the app. */
export function availability(plugin) {
  if (!signsIn(plugin)) return plugin.info.availability;
  const connected = plugin.accounts.filter(working).length;
  if (connected) return connected > 1 ? `Connected (${connected} accounts)` : "Connected";
  return plugin.installed ? "Added; needs sign-in" : "Not added yet";
}

// How an account row reads: "label · address", just the address, or the label before sign-in.
export const accountTitle = (account) => [account.name, account.label].filter(Boolean).join(" · ") || "Not signed in yet";
