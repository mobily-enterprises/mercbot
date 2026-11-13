import extensions from "./extensions.js";
import WEBSITE_PARTS from "./websiteParts.js";

// The Settings sections, in order.
// A section with its own `component` (Website, D-84) is shown by it, so leaving that part out leaves its section out.
export const SETTINGS_SECTIONS = [
  { value: "general", title: "General", icon: "$settings" },
  { value: "computer", title: "Computer", icon: "$desktopWindows" },
  { value: "permissions", title: "Permissions", icon: "$verifiedUser" },
  { value: "files", title: "Files", icon: "$folder" },
  ...WEBSITE_PARTS.settingsSections,
  { value: "memory", title: "Memory", icon: "$psychology" },
  { value: "vault", title: "Vault", icon: "$encrypted" },
  { value: "usage", title: "Spending", icon: "$speed" },
  { value: "link", title: "Mercbot account", icon: "$link" },
  { value: "about", title: "About", icon: "$info" }
];

/**
 * The sections Settings lists: Mercbot's own, each in its place or, when an added one (extensions.js) has its `value`
 * and is for everyone or its `visible` answered yes, that one in its place; then the other added ones that are for
 * everyone or whose `visible` answered yes, each right after the section its `after` names, else at the end.
 * @param {ReadonlyArray<{ value: string, after?: string, visible?: () => Promise<boolean> }>} added
 * @param {ReadonlySet<string>} shown the added sections whose `visible` answered yes
 */
export function listedSections(added, shown) {
  const listed = [...SETTINGS_SECTIONS];
  for (const entry of added) {
    if (entry.visible && !shown.has(entry.value)) continue;
    const own = listed.findIndex((section) => section.value === entry.value);
    if (own >= 0) {
      listed[own] = entry;
      continue;
    }
    const before = listed.findIndex((section) => section.value === entry.after);
    listed.splice(before < 0 ? listed.length : before + 1, 0, entry);
  }
  return listed;
}

/** The sections listed for everyone: the ones the search palette offers and a link (?settings=) opens. */
export const EVERYONE_SECTIONS = listedSections(extensions.settingsSections, new Set());
