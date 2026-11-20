// What the bot template gallery shows (D-43, D-98), for the gallery page and the template pickers alike
// (TemplateBrowser.vue): chips for All, the Mercbot team and each job area that has templates; with a search, the
// templates whose bot, tag, creator or description has it; otherwise, under All, four featured templates and then a few
// of each area's, or the team's or one area's in full. A picker gives the home's own templates too, which come first.
export const SECTION_SIZE = 6;
const FEATURED_SIZE = 4;

/**
 * The chips: All, Mercbot team, then each job area that has a template.
 * @param {{ categories?: Array<{ id: string, name: string }>, templates?: Array<{ category: string }> } | null} gallery
 */
export function galleryChips(gallery) {
  const templates = gallery?.templates || [];
  return [
    { id: "all", name: "All" },
    { id: "team", name: "Mercbot team" },
    ...(gallery?.categories || []).filter((category) => templates.some((entry) => entry.category === category.id))
  ];
}

/**
 * What the gallery shows for a chip and a search, in reading order. Every entry carries a `key` of its own, since a
 * featured template is also in its area: `order` lists them all as they read, the home's first, then featured, for the
 * keyboard. The home's own templates (`home`: id, tag, description) show under All and in a search, never in an area.
 * @param {{ categories?: Array<{ id: string, name: string }>, templates?: Array<Record<string, any>> } | null} gallery
 * @param {{ chip: string, query: string, home?: Array<{ id: string, tag: string, description: string }> | null }} choice
 */
export function galleryView(gallery, { chip, query, home = null }) {
  const templates = gallery?.templates || [];
  const keyed = (prefix, rows) => rows.map((template) => ({ key: `${prefix}:${template.slug}`, template }));
  const homeRows = (rows) => rows.map((template) => ({ key: `home:${template.id}`, template: { ...template, home: true } }));
  const words = String(query || "").trim().toLowerCase();
  if (words) {
    const ours = homeRows((home || []).filter((entry) => `${entry.tag} ${entry.description}`.toLowerCase().includes(words)));
    const found = [
      ...ours,
      ...keyed("found", templates.filter((entry) => `${entry.name} ${entry.tag || ""} ${entry.creator} ${entry.description}`.toLowerCase().includes(words)))
    ];
    return { found, home: [], featured: [], sections: [], order: found };
  }
  const ours = chip === "all" ? homeRows(home || []) : [];
  const featured = chip === "all"
    ? keyed("featured", [...templates.filter((entry) => entry.featured), ...templates.filter((entry) => !entry.featured)].slice(0, FEATURED_SIZE))
    : [];
  const areas = (gallery?.categories || []).map((category) => ({ ...category, rows: templates.filter((entry) => entry.category === category.id) }));
  const sections = (chip === "all"
    ? areas.filter((area) => area.rows.length).map((area) => ({ ...area, more: area.rows.length > SECTION_SIZE, rows: area.rows.slice(0, SECTION_SIZE) }))
    : chip === "team"
      ? [{ id: "team", name: "From the Mercbot team", rows: templates.filter((entry) => entry.team) }]
      : areas.filter((area) => area.id === chip)
  ).map((section) => ({ ...section, rows: keyed(section.id, section.rows) }));
  return { found: null, home: ours, featured, sections, order: [...ours, ...featured, ...sections.flatMap((section) => section.rows)] };
}
