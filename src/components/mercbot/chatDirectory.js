// The sidebar's arrangement of chats (D-112: rows are the person's chats, plan 4.1). Pure, so the layout rules are
// testable.
const byActivity = (a, b) => (b.lastActivityAt || "").localeCompare(a.lastActivityAt || "") || Number(b.id) - Number(a.id);

/**
 * A chat as the server answers it (ChatView), with the person's own place in it brought up to the row, and the
 * latest message's preview, as the sidebar reads them. A public chat the person reads without being in it has no place:
 * it's `visiting`, shown while open and never listed. The home's everyone chat is pinned for everyone in it, with no pin
 * position of its own (O9): `pinned` says so for every pinned chat.
 * @param {object} view
 */
export function toChatRow(view) {
  const place = view.place || {};
  return {
    ...view,
    visiting: !view.place,
    pinPosition: place.pinPosition ?? null,
    pinned: Boolean(view.everyone) || (place.pinPosition ?? null) !== null,
    sectionId: place.sectionId ?? null,
    hidden: Boolean(place.hidden),
    unread: Boolean(place.unread),
    muted: Boolean(place.muted),
    readUpTo: place.readUpTo ?? null,
    preview: view.latest?.preview || ""
  };
}

/**
 * The sidebar's layout: pinned tiles, rows grouped by section, hidden chats, archived chats, and their visual order. An
 * archived chat is in Archived chats alone, newest archived first, whatever its pin, section or hidden state, which
 * come back when it's unarchived. A chat the person only visits isn't listed. The everyone chat is the first tile.
 * @param {{ chats: Array<import("../../types.js").Chat>, sections: Array<import("../../types.js").ChatSection>, hiddenExpanded?: boolean, archivedExpanded?: boolean }} options
 */
export function buildSidebarModel({ chats: listed, sections, hiddenExpanded = false, archivedExpanded = false }) {
  const all = listed.filter((chat) => !chat.visiting);
  const chats = all.filter((chat) => !chat.archivedAt);
  const archived = all.filter((chat) => chat.archivedAt).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt) || Number(b.id) - Number(a.id));
  const visible = chats.filter((chat) => !chat.hidden);
  const tiles = visible.filter((chat) => chat.pinned)
    .sort((a, b) => Number(Boolean(b.everyone)) - Number(Boolean(a.everyone)) || a.pinPosition - b.pinPosition);
  const unpinned = visible.filter((chat) => !chat.pinned).sort(byActivity);
  const sectionIds = new Set(sections.map((section) => section.id));
  const groups = sections.length
    ? [
      ...sections.map((section) => ({
        key: `section-${section.id}`,
        kind: "section",
        section,
        chats: unpinned.filter((chat) => chat.sectionId === section.id)
      })),
      { key: "unassigned", kind: "unassigned", chats: unpinned.filter((chat) => !sectionIds.has(chat.sectionId)) }
    ]
    : [{ key: "flat", kind: "flat", chats: unpinned }];
  const hidden = chats.filter((chat) => chat.hidden).sort(byActivity);
  const visualOrder = [
    ...tiles,
    ...groups.flatMap((group) => (group.section?.collapsed ? [] : group.chats)),
    ...(hiddenExpanded ? hidden : []),
    ...(archivedExpanded ? archived : [])
  ].map((chat) => chat.id);
  return { tiles, groups, hidden, archived, visualOrder };
}

// The compact rail: pinned chats, then each group's, with a divider between non-empty groups and no headers.
export function buildRailModel(model) {
  return [model.tiles, ...model.groups.map((group) => group.chats)].filter((chats) => chats.length);
}

export function railOrder(model) {
  return buildRailModel(model).flat().map((chat) => chat.id);
}

// Tile grid geometry: one or two tiles centred, otherwise three columns.
export function tileLayout(count) {
  if (count === 1) return "single";
  if (count === 2) return "pair";
  return "grid";
}
