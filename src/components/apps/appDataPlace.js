// Where an app keeps its data (D-141), in plain words for its details: its own tables, a copy's that started fresh
// (named "…_copy_2"), or tables it shares with other apps, from each table's `usedBy` (the apps that use it).

/** A list of names as words: "Study", "Study and Reading list", "Study, Pantry and Reading list". */
const inWords = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] || "");

/** An app as these words name it: its name, and its address too when another app here has the same name. */
const nameOf = (entry, app, all) =>
  (entry.name === app.name || all.some((other) => other.id !== entry.id && other.name === entry.name) ? `${entry.name} (${entry.slug})` : entry.name);

/** The other apps using one of the app's tables, by name. */
export function otherApps(app, table) {
  const all = table.usedBy || [];
  return all.filter((entry) => entry.id !== app.id).map((entry) => nameOf(entry, app, all));
}

/**
 * The sentence, or "" for an app with no tables.
 * @param {{ id: string, name: string, templateCopy?: number | null }} app
 * @param {Array<{ usedBy?: Array<{ id: string, name: string, slug: string }> }>} tables the tables the app uses
 */
export function dataPlace(app, tables) {
  if (!tables.length) return "";
  if (app.templateCopy) return `Its own data, separate from the other apps: its tables end in “copy ${app.templateCopy}”.`;
  const others = [...new Set(tables.flatMap((table) => otherApps(app, table)))];
  return others.length ? `Shares its data with ${inWords(others)}.` : "Its own data: no other app uses its tables.";
}
