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
 * Who may change a chat (D-112): its maker and the home's owners and admins rename, archive and delete it. A direct
 * chat, with a bot or between two people, takes no title, no one else and no archive. Only a public room is archived,
 * for everyone; a private one is hidden by each person for themselves (plan 5.1), though one archived before still
 * unarchives. Bots come into a room and go: anyone in the home for a public room, its people for a private one. The
 * home's everyone chat has everyone in it, pinned for all (O9): no one leaves it, unpins, archives or deletes it.
 * @param {import("../../types.js").Chat} chat
 * @param {{ me: string, manages: boolean }} who
 */
export function chatRights(chat, { me, manages }) {
  const manager = manages || (Boolean(chat.madeBy) && String(chat.madeBy) === String(me));
  const direct = Boolean(chat.directBotId) || Boolean(chat.directPerson);
  const inIt = !chat.visiting;
  return {
    // Take people out of it (no one leaves the everyone chat but by leaving the home).
    removeMembers: manager && !direct,
    // Invite (a private room: people and bots) or Invite a bot (a public room), and take a bot out again.
    addPeople: !direct && chat.kind === "private" && inIt && !chat.everyone,
    addBots: !direct && (chat.kind !== "private" || inIt),
    removeBots: !direct && (chat.kind !== "private" || inIt),
    rename: manager && !direct,
    // Whether its bots join in when useful (D-115); a direct chat has one person, so its bot always answers.
    joinIn: manager && !direct,
    archive: manager && !chat.everyone && !direct && chat.kind !== "private",
    unarchive: manager && !chat.everyone,
    remove: manager && !chat.everyone,
    leave: !chat.everyone && !chat.directBotId && inIt,
    unpin: !chat.everyone
  };
}

/**
 * A chat's context menu in the sidebar: on a pinned tile, a hidden row, a room's row, an archived row, or a person's or
 * a bot's row in People or Bots (its direct chat). Each item's
 * `run` emits a command for the shell, or starts a rename or the delete, leave or archive question here. What the
 * person may do (chatRights) decides which are offered; the server refuses the rest anyway.
 * @param {{
 *   chat: import("../../types.js").Chat,
 *   place: "tile" | "hidden" | "row" | "archived" | "direct",
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
  // A direct chat isn't hidden: People and Bots list everyone, its person or bot with it.
  const direct = Boolean(chat.directBotId) || Boolean(chat.directPerson);
  const hide = direct ? [] : [{ title: "Hide from sidebar", icon: "$visibilityOff", run: () => command("hide", { chatId: chat.id }) }];
  if (place === "archived") {
    return [
      ...(may.unarchive ? [{ title: "Unarchive", icon: "$unarchive", run: () => command("unarchiveChat", { chatId: chat.id }) }, { divider: true }] : []),
      copy,
      ...(leave.length || remove.length ? [{ divider: true }, ...leave, ...remove] : [])
    ];
  }
  if (place === "direct") {
    return [
      chat.pinned
        ? { title: "Unpin", icon: "$keepOff", run: () => command("unpin", { chatId: chat.id }) }
        : { title: "Pin", icon: "$keepFilled", run: () => command("pin", { chatId: chat.id }) },
      unread,
      { divider: true },
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
      ...(hide.length || leave.length || archive.length || remove.length ? [{ divider: true }] : []),
      ...hide,
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
    ...(hide.length || leave.length || archive.length || remove.length ? [{ divider: true }] : []),
    ...hide,
    ...leave,
    ...archive,
    ...remove
  ];
}

/**
 * What Archive, Leave and Delete ask first: Archive keeps the room readable for everyone in it; Leave takes a private
 * chat off the person's list (the last person leaving deletes it) and leaves a public room faded in Rooms; Delete takes
 * it from everyone, with its files and its bots' computers in it.
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
      ? "It's public, so it stays in Rooms, faded, and writing there again brings you back."
      : alone
        ? `You're the last one here, so this ${chat.directPerson ? "chat" : "room"} and everything in it will be deleted.`
        : "It's private, so you can't open it again unless someone adds you back.";
    return { title: `Leave “${title}”?`, text, confirmLabel: "Leave", danger: alone };
  }
  return {
    title: `Delete “${title}”?`,
    text: "This chat goes for everyone in it, with its whole history, its files and its bots' computers. Its bots stay in " +
      "the home. This can't be undone.",
    confirmLabel: "Delete",
    danger: true
  };
}

/**
 * Who Invite offers for a room (plan 4.6): in a private room, the home's people and active bots not in it yet; in a
 * public room, which everyone in the home can open already, its active bots not in it. People first, then bots, each by
 * name, from the lists the shell has already loaded (useTeam), which hold the whole home.
 * @param {import("../../types.js").Chat} chat
 * @param {{ people: Array<{ id: string, name: string }>, bots: Array<{ id: string, name: string, archivedAt?: string | null }>, me: string }} home
 */
export function inviteChoices(chat, { people, bots, me }) {
  const peopleIn = new Set((chat.people || []).map((person) => String(person.userId)));
  const botsIn = new Set((chat.bots || []).map((bot) => String(bot.botId)));
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const persons = chat.kind === "private"
    ? people.filter((person) => String(person.id) !== String(me) && !peopleIn.has(String(person.id))).sort(byName)
    : [];
  const robots = bots.filter((bot) => !bot.archivedAt && !botsIn.has(String(bot.id))).sort(byName);
  return [
    ...persons.map((person) => ({ value: `person:${person.id}`, kind: "person", id: String(person.id), title: person.name })),
    ...robots.map((bot) => ({ value: `bot:${bot.id}`, kind: "bot", id: String(bot.id), title: bot.name, bot }))
  ];
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
