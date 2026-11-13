
/** "Move to": each section, Unassigned, then Create section. */
function moveToItems(bot, sections, command) {
  return [
    ...sections.map((section) => ({
      title: section.name,
      checked: bot.sectionId === section.id,
      run: () => command("moveBot", { botId: bot.id, sectionId: section.id })
    })),
    { title: "Unassigned", checked: !bot.sectionId, run: () => command("moveBot", { botId: bot.id, sectionId: null }) },
    { divider: true },
    { title: "Create section", icon: "$createNewFolder", run: () => command("createSection", { botId: bot.id }) }
  ];
}

// The main bot can't be renamed from here or deleted; instead another bot can take its place.
function replaceItems(bot, model, command) {
  const others = [...model.tiles, ...model.groups.flatMap((entry) => entry.bots), ...model.hidden]
    .filter((entry) => entry.id !== bot.id && entry.kind !== "group");
  if (!others.length) return [{ title: "No other bots yet", disabled: true, run: () => {} }];
  return others.map((entry) => ({ title: entry.name, run: () => command("makeMain", { botId: entry.id }) }));
}

/**
 * A bot's context menu in the bot list: on a pinned tile, a hidden row or a sidebar row.
 * Each item's `run` emits a command for the shell, or starts a rename or the delete question here.
 * @param {{
 *   bot: import("../../types.js").Bot,
 *   place: "tile" | "hidden" | "row",
 *   sections: Array<import("../../types.js").BotSection>,
 *   model: import("../../types.js").SidebarModel,
 *   command: (name: string, args?: Record<string, any>) => void,
 *   startRename: (bot: import("../../types.js").Bot) => void,
 *   askDelete: () => void
 * }} menu
 */
export function botMenuItems({ bot, place, sections, model, command, startRename, askDelete }) {
  const unread = bot.unread
    ? { title: "Mark as read", icon: "$drafts", run: () => command("markRead", { botId: bot.id }) }
    : { title: "Mark as unread", icon: "$markEmailUnread", run: () => command("markUnread", { botId: bot.id }) };
  const group = bot.kind === "group";
  const rename = { title: group ? "Rename chat" : "Rename bot", icon: "$edit", run: () => startRename(bot) };
  const copy = { title: "Copy conversation ID", icon: "$contentCopy", run: () => command("copyId", { botId: bot.id }) };
  const remove = bot.isMain
    ? { title: "Replace with a different bot", icon: "$swapHoriz", submenu: replaceItems(bot, model, command) }
    : { title: "Delete", icon: "$delete", danger: true, run: askDelete };
  const hide = { title: "Hide from sidebar", icon: "$visibilityOff", run: () => command("hide", { botId: bot.id }) };
  if (place === "tile") {
    return [
      { title: "Unpin", icon: "$keepOff", run: () => command("unpin", { botId: bot.id }) },
      unread,
      { divider: true },
      copy,
      { divider: true },
      hide,
      remove
    ];
  }
  if (place === "hidden") {
    return [
      unread,
      ...(bot.isMain ? [] : [{ divider: true }, rename]),
      { divider: true },
      copy,
      { divider: true },
      { title: "Show in sidebar", icon: "$visibility", run: () => command("show", { botId: bot.id }) },
      remove
    ];
  }
  return [
    { title: "Pin", icon: "$keepFilled", run: () => command("pin", { botId: bot.id }) },
    sections.length
      ? { title: "Move to", icon: "$driveFileMove", submenu: moveToItems(bot, sections, command) }
      : { title: "Move to new section", icon: "$driveFileMove", run: () => command("createSection", { botId: bot.id }) },
    unread,
    ...(bot.isMain ? [] : [{ divider: true }, rename]),
    { divider: true },
    copy,
    { divider: true },
    hide,
    remove
  ];
}

/**
 * A section heading's context menu: Rename, Move up, Move down, Delete.
 * @param {{
 *   section: import("../../types.js").BotSection,
 *   index: number,
 *   count: number,
 *   command: (name: string, args?: Record<string, any>) => void,
 *   startRename: (section: import("../../types.js").BotSection) => void
 * }} menu `index` is the section's place among `count` sections.
 */
export function sectionMenuItems({ section, index, count, command, startRename }) {
  return [
    { title: "Rename", icon: "$edit", run: () => startRename(section) },
    { title: "Move up", icon: "$arrowup", disabled: index === 0, run: () => command("moveSection", { sectionId: section.id, direction: "up" }) },
    {
      title: "Move down",
      icon: "$arrowdown",
      disabled: index === count - 1,
      run: () => command("moveSection", { sectionId: section.id, direction: "down" })
    },
    { divider: true },
    { title: "Delete", icon: "$delete", danger: true, run: () => command("deleteSection", { sectionId: section.id }) }
  ];
}
