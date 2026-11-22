/** "Move to": each section, Unassigned, then Create section. */
function moveToItems(chat, sections, command) {
  return [
    ...sections.map((section) => ({
      title: section.name,
      checked: chat.sectionId === section.id,
      run: () => command("moveChat", { chatId: chat.id, sectionId: section.id })
    })),
    { title: "Unassigned", checked: !chat.sectionId, run: () => command("moveChat", { chatId: chat.id, sectionId: null }) },
    { divider: true },
    { title: "Create section", icon: "$createNewFolder", run: () => command("createSection", { chatId: chat.id }) }
  ];
}

/**
 * Who may change a chat (D-112): its maker and the home's owners and admins rename, archive and delete it (a direct
 * chat takes no title). Only a public chat is archived, for everyone; a private one is hidden by each person for
 * themselves (plan 5.1), though one archived before still unarchives. The home's everyone chat has everyone in it,
 * pinned for all (O9): no one leaves it, unpins, archives or deletes it.
 * @param {import("../../types.js").Chat} chat
 * @param {{ me: string, manages: boolean }} who
 */
export function chatRights(chat, { me, manages }) {
  const manager = manages || (Boolean(chat.madeBy) && String(chat.madeBy) === String(me));
  return {
    // Take people and bots out of it (no one leaves the everyone chat but by leaving the home).
    removeMembers: manager,
    rename: manager && !chat.directBotId,
    // Whether its bots join in when useful (D-115); a direct chat has one person, so its bot always answers.
    joinIn: manager && !chat.directBotId,
    archive: manager && !chat.everyone && chat.kind !== "private",
    unarchive: manager && !chat.everyone,
    remove: manager && !chat.everyone,
    leave: !chat.everyone && !chat.directBotId && !chat.visiting,
    unpin: !chat.everyone
  };
}

/**
 * A chat's context menu in the chat list: on a pinned tile, a hidden row, a sidebar row or an archived row. Each item's
 * `run` emits a command for the shell, or starts a rename or the delete, leave or archive question here. What the
 * person may do (chatRights) decides which are offered; the server refuses the rest anyway.
 * @param {{
 *   chat: import("../../types.js").Chat,
 *   place: "tile" | "hidden" | "row" | "archived",
 *   sections: Array<import("../../types.js").ChatSection>,
 *   me: string,
 *   manages: boolean,
 *   command: (name: string, args?: Record<string, any>) => void,
 *   startRename: (chat: import("../../types.js").Chat) => void,
 *   askDelete: () => void,
 *   askLeave: () => void,
 *   askArchive: () => void
 * }} menu
 */
export function chatMenuItems({ chat, place, sections, me, manages, command, startRename, askDelete, askLeave, askArchive }) {
  const may = chatRights(chat, { me, manages });
  const unread = chat.unread
    ? { title: "Mark as read", icon: "$drafts", run: () => command("markRead", { chatId: chat.id }) }
    : { title: "Mark as unread", icon: "$markEmailUnread", run: () => command("markUnread", { chatId: chat.id }) };
  const rename = may.rename ? [{ divider: true }, { title: "Rename chat", icon: "$edit", run: () => startRename(chat) }] : [];
  const copy = { title: "Copy chat ID", icon: "$contentCopy", run: () => command("copyId", { chatId: chat.id }) };
  const leave = may.leave ? [{ title: "Leave chat", icon: "$logout", run: askLeave }] : [];
  const archive = may.archive ? [{ title: "Archive", icon: "$archive", run: askArchive }] : [];
  const remove = may.remove ? [{ title: "Delete", icon: "$delete", danger: true, run: askDelete }] : [];
  const hide = { title: "Hide from sidebar", icon: "$visibilityOff", run: () => command("hide", { chatId: chat.id }) };
  if (place === "archived") {
    return [
      ...(may.unarchive ? [{ title: "Unarchive", icon: "$unarchive", run: () => command("unarchiveChat", { chatId: chat.id }) }, { divider: true }] : []),
      copy,
      ...(leave.length || remove.length ? [{ divider: true }, ...leave, ...remove] : [])
    ];
  }
  if (place === "tile") {
    return [
      ...(may.unpin ? [{ title: "Unpin", icon: "$keepOff", run: () => command("unpin", { chatId: chat.id }) }] : []),
      unread,
      ...rename,
      { divider: true },
      copy,
      { divider: true },
      hide,
      ...leave,
      ...archive,
      ...remove
    ];
  }
  if (place === "hidden") {
    return [
      unread,
      ...rename,
      { divider: true },
      copy,
      { divider: true },
      { title: "Show in sidebar", icon: "$visibility", run: () => command("show", { chatId: chat.id }) },
      ...leave,
      ...archive,
      ...remove
    ];
  }
  return [
    { title: "Pin", icon: "$keepFilled", run: () => command("pin", { chatId: chat.id }) },
    sections.length
      ? { title: "Move to", icon: "$driveFileMove", submenu: moveToItems(chat, sections, command) }
      : { title: "Move to new section", icon: "$driveFileMove", run: () => command("createSection", { chatId: chat.id }) },
    unread,
    ...rename,
    { divider: true },
    copy,
    { divider: true },
    hide,
    ...leave,
    ...archive,
    ...remove
  ];
}

/**
 * What Archive, Leave and Delete ask first: Archive keeps the chat readable for everyone in it; Leave takes a private
 * chat off the person's list (the last person leaving deletes it); Delete takes it from everyone, with its files and
 * its bots' computers in it.
 * @param {"archive" | "leave" | "remove"} action
 * @param {import("../../types.js").Chat} chat
 * @param {string} title the chat's name as the list shows it
 */
export function chatQuestion(action, chat, title) {
  if (action === "archive") {
    return {
      title: `Archive “${title}”?`,
      text: "It stays readable for everyone in it, and no one can write in it until it's unarchived.",
      confirmLabel: "Archive",
      danger: false
    };
  }
  if (action === "leave") {
    const alone = chat.kind === "private" && (chat.people || []).length <= 1;
    const text = chat.kind !== "private"
      ? "It's public, so you can still open it from New chat and join it again."
      : alone
        ? "You're the last person in it, so leaving deletes it, with its files and its bots' computers."
        : "It's private, so you can't open it again unless someone adds you back.";
    return { title: `Leave “${title}”?`, text, confirmLabel: "Leave", danger: alone };
  }
  return {
    title: `Delete “${title}”?`,
    text: "This chat goes for everyone in it, with its whole history, its files and its bots' computers. Its bots stay on " +
      "your team. This can't be undone.",
    confirmLabel: "Delete",
    danger: true
  };
}

/**
 * Adding a person to a chat: a private chat asks first, since they'll read all of it; a public one, which everyone in the
 * home can open already, doesn't ask (null).
 * @param {import("../../types.js").Chat} chat
 * @param {string} title the chat's name
 * @param {string} name the person's
 */
export function addPersonQuestion(chat, title, name) {
  if (chat.kind !== "private") return null;
  return { title: `Add ${name} to “${title}”?`, text: `${name} will see everything said here.`, confirmLabel: "Add", danger: false };
}

/**
 * A section heading's context menu: Rename, Move up, Move down, Delete.
 * @param {{
 *   section: import("../../types.js").ChatSection,
 *   index: number,
 *   count: number,
 *   command: (name: string, args?: Record<string, any>) => void,
 *   startRename: (section: import("../../types.js").ChatSection) => void
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
