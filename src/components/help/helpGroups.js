/**
 * @typedef {{ slug: string, title: string, words?: number }} HelpPage
 * @typedef {{ name: string, pages: HelpPage[] }} HelpGroup
 */

/**
 * The help centre's groups of pages: Mercbot's own (help/index.json), then what a copy built on Mercbot adds
 * (help/extensions.json, `{ "groups": [] }` here). An added group named like one of Mercbot's adds its pages at the end
 * of that group; any other comes after Mercbot's groups, in its order. A page is listed once: an addition naming a page
 * already listed is refused, since it would move or rename it.
 * @param {{ groups: HelpGroup[] }} own
 * @param {{ groups: HelpGroup[] }} added
 * @returns {HelpGroup[]}
 */
export function helpGroups(own, added) {
  const groups = own.groups.map((group) => ({ ...group, pages: [...group.pages] }));
  const listed = new Set(groups.flatMap((group) => group.pages.map((page) => page.slug)));
  for (const group of added.groups) {
    for (const page of group.pages) {
      if (listed.has(page.slug)) throw new Error(`help/extensions.json lists the help page "${page.slug}" a second time.`);
      listed.add(page.slug);
    }
    const same = groups.find((entry) => entry.name === group.name);
    if (same) same.pages.push(...group.pages);
    else groups.push({ ...group, pages: [...group.pages] });
  }
  return groups;
}
