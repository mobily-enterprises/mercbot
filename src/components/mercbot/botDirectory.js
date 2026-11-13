// Sidebar arrangement of bots. Pure, so the layout rules are testable.
const byActivity = (a, b) => (b.lastActivityAt || "").localeCompare(a.lastActivityAt || "") || Number(b.id) - Number(a.id);

/**
 * The sidebar's layout: pinned tiles, rows grouped by section, hidden bots, and their visual order.
 * @param {{ bots: Array<import("../../types.js").Bot>, sections: Array<import("../../types.js").BotSection>, hiddenExpanded?: boolean }} options
 */
export function buildSidebarModel({ bots, sections, hiddenExpanded = false }) {
  const visible = bots.filter((bot) => !bot.hidden);
  const tiles = visible.filter((bot) => bot.pinPosition !== null).sort((a, b) => a.pinPosition - b.pinPosition);
  const unpinned = visible.filter((bot) => bot.pinPosition === null).sort(byActivity);
  const sectionIds = new Set(sections.map((section) => section.id));
  const groups = sections.length
    ? [
      ...sections.map((section) => ({
        key: `section-${section.id}`,
        kind: "section",
        section,
        bots: unpinned.filter((bot) => bot.sectionId === section.id)
      })),
      { key: "unassigned", kind: "unassigned", bots: unpinned.filter((bot) => !sectionIds.has(bot.sectionId)) }
    ]
    : [{ key: "flat", kind: "flat", bots: unpinned }];
  const hidden = bots.filter((bot) => bot.hidden).sort(byActivity);
  const visualOrder = [
    ...tiles,
    ...groups.flatMap((group) => (group.section?.collapsed ? [] : group.bots)),
    ...(hiddenExpanded ? hidden : [])
  ].map((bot) => bot.id);
  return { tiles, groups, hidden, visualOrder };
}

// The compact rail: pinned avatars, then each group's avatars, with a divider between
// non-empty groups and no headers.
export function buildRailModel(model) {
  return [model.tiles, ...model.groups.map((group) => group.bots)].filter((bots) => bots.length);
}

export function railOrder(model) {
  return buildRailModel(model).flat().map((bot) => bot.id);
}

// Tile grid geometry: one or two tiles centred, otherwise three columns.
export function tileLayout(count) {
  if (count === 1) return "single";
  if (count === 2) return "pair";
  return "grid";
}
