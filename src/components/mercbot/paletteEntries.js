import { fileKind } from "./filesApi.js";
import extensions from "./extensions.js";
import { chatTitle, memberNames, joinNames } from "./chatView.js";
import { itemIcon } from "./useBotLibrary.js";

// What Settings: General is found by, with the buttons a copy built on Mercbot adds there (extensions.js).
const GENERAL_KEYWORDS = ["theme appearance accent language spell microphone timezone", ...extensions.generalActions.map((action) => action.title.toLowerCase())].join(" ");
// What a section is also found by, beside its title.
const SECTION_KEYWORDS = Object.freeze({ "recurring-tasks": "routines watches jobs schedules automations scheduled costs" });

/**
 * The search palette's commands: Add bots, New room, shortcuts, each settings section, Connect Apps, Skills and the
 * three themes, the current one checked.
 * @param {{
 *   settingsSections: Array<{ value: string, title: string }>,
 *   theme: string
 * }} state
 */
export function paletteCommands({ settingsSections, theme: currentTheme }) {
  return [
    // Add bots (D-109), which was New bot: found by either.
    { id: "newBot", title: "Add bots", icon: "$editSquare", keywords: "new bot set" },
    { id: "newChat", title: "New room", icon: "$chat", keywords: "new chat start public private" },
    { id: "shortcuts", title: "Keyboard shortcuts", category: "Help", icon: "$keyboard" },
    ...settingsSections.map((section) => ({
      id: `settings:${section.value}`,
      title: `Settings: ${section.title}`,
      category: "Settings",
      icon: "$settings",
      keywords: section.value === "general" ? GENERAL_KEYWORDS : SECTION_KEYWORDS[section.value] || ""
    })),
    { id: "connectApps", title: "Connect Apps", category: "Search across apps and skills", icon: "$extension" },
    { id: "skills", title: "Skills", category: "Your private skills", icon: "$menuBook" },
    ...["system", "light", "dark"].map((theme) => ({
      id: `theme:${theme}`,
      title: `Theme: ${theme[0].toUpperCase()}${theme.slice(1)}`,
      category: "Settings · Appearance",
      icon: "$contrast",
      checked: currentTheme === theme
    }))
  ];
}

// A loose match (the letters in order). Its score is where its first letter falls, so earlier
// wins whether or not the letters are together; ties go alphabetically.
function score(text, needle) {
  const haystack = String(text || "").toLowerCase();
  if (!needle) return 0;
  for (let start = haystack.indexOf(needle[0]); start !== -1; start = haystack.indexOf(needle[0], start + 1)) {
    let from = start + 1;
    let found = true;
    for (const char of needle.slice(1)) {
      from = haystack.indexOf(char, from);
      if (from === -1) {
        found = false;
        break;
      }
      from += 1;
    }
    if (found) return start;
  }
  return null;
}

function best(...scores) {
  const found = scores.filter((value) => value !== null);
  return found.length ? Math.min(...found) : null;
}

const byScore = (entries) => entries
  .filter((entry) => entry.score !== null)
  .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));

function chatRow(chat, me) {
  const title = chatTitle(chat, me);
  const names = memberNames(chat, me).filter((name) => name !== "you");
  return {
    key: `chat-${chat.id}`,
    kind: "chat",
    chat,
    title,
    secondary: chat.title && names.length ? joinNames(names) : "",
    tag: chat.archivedAt ? "archived" : chat.hidden ? "hidden" : "",
    unread: chat.unread && !chat.archivedAt
  };
}

// The home's people and bots (D3), as People and Bots have them: a bot opens the person's direct chat with it, a person their card.
const botRow = (bot) => ({ key: `bot-${bot.id}`, kind: "bot", bot, title: bot.name, secondary: "Bot" });
const personRow = (person) => ({ key: `person-${person.id}`, kind: "person", person, title: person.name, secondary: person.roleLabel || "Person" });

// Before typing: unread first, then pinned in tile order (the everyone chat first), then by latest activity. Hidden
// and archived chats aren't listed until you search.
function emptyOrder(chats) {
  const rank = (chat) => (chat.unread ? 0 : chat.pinned ? 1 : 2);
  const pin = (chat) => (chat.everyone ? -1 : chat.pinPosition ?? 0);
  return chats.filter((chat) => !chat.hidden && !chat.archivedAt).sort((a, b) => rank(a) - rank(b) ||
    (rank(a) === 1 ? pin(a) - pin(b) : new Date(b.lastActivityAt) - new Date(a.lastActivityAt)));
}

// A message cut so the match is visible, with "…" where it was cut.
function snippet(text, needle) {
  const plain = String(text || "").replace(/\s+/gu, " ").trim();
  const at = plain.toLowerCase().indexOf(needle);
  return { title: at > 24 ? `…${plain.slice(at - 18)}` : plain };
}

function ago(iso) {
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  const days = Math.round(minutes / 1440);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// Where a found message is, and when: "In Kitchen · 2 h ago".
const whereAndWhen = (message) => `In ${message.chatName || "a chat"} · ${ago(message.createdAt)}`;

/**
 * The palette's rows. Before typing: the person's chats, then commands. While typing: chats, the home's bots and people,
 * apps, hidden and archived chats, commands, routines, made files and messages, each matched loosely and the earliest
 * first letter first.
 * @param {{
 *   needle: string,
 *   me: string,
 *   chats: Array<import("../../types.js").Chat>,
 *   bots: Array<Record<string, any>>,
 *   people: Array<{ id: string, name: string, roleLabel: string }>,
 *   commands: ReturnType<typeof paletteCommands>,
 *   apps: Array<import("../../types.js").Plugin>,
 *   routines: Array<Record<string, any>>,
 *   files: Array<Record<string, any>>,
 *   messages: Array<Record<string, any>>
 * }} state `needle` is the typed text, trimmed and lower case.
 */
export function paletteEntries({ needle, me, chats: allChats, bots: allBots, people, commands: allCommands, apps, routines, files, messages }) {
  const commands = allCommands.map((command) => ({ key: command.id, kind: "command", ...command }));
  if (!needle) return [...emptyOrder(allChats).map((chat) => chatRow(chat, me)), ...commands];
  // A chat by its name or who's in it.
  const matched = byScore(allChats.map((chat) => {
    const row = chatRow(chat, me);
    const inNames = score(row.secondary, needle);
    return { ...row, score: best(score(row.title, needle), inNames === null ? null : 100 + inNames) };
  }));
  const chats = matched.filter((entry) => !entry.tag);
  const tucked = matched.filter((entry) => entry.tag);
  // A bot's template tag is searched too (D-98); its contiguous match counts from where it starts.
  const botRows = byScore(allBots.map((bot) => {
    const tag = bot.template?.tag || "";
    return { ...botRow(bot), score: best(score(bot.name, needle), tag.includes(needle) ? tag.indexOf(needle) + 100 : null) };
  }));
  const personRows = byScore(people.filter((person) => String(person.id) !== String(me))
    .map((person) => ({ ...personRow(person), score: score(person.name, needle) })));
  const appRows = byScore(apps.map((plugin) => ({
    key: `app-${plugin.id}`,
    kind: "app",
    plugin,
    title: plugin.name,
    secondary: plugin.description,
    score: best(score(plugin.name, needle), String(plugin.description || "").toLowerCase().includes(needle) ? 100 + String(plugin.description).toLowerCase().indexOf(needle) : null)
  })));
  const commandRows = byScore(commands.map((command) => ({
    ...command,
    secondary: command.category,
    score: best(score(command.title, needle), command.keywords?.includes(needle) ? 100 : null)
  })));
  const routineRows = byScore(routines.map((routine) => ({
    key: `routine-${routine.id}`,
    kind: "routine",
    routine,
    title: routine.name,
    secondary: [routine.schedule, routine.botName, routine.chatName].filter(Boolean).join(" · "),
    score: score(routine.name, needle)
  })));
  const fileRows = files.map((file) => ({
    key: `file-${file.chatId ?? "home"}-${file.botId ?? "home"}-${file.path}`,
    kind: "file",
    file,
    title: file.name,
    secondary: file.kind === "view" ? "View" : `${{ page: "Page", chart: "Chart", picture: "Picture" }[file.kind] || fileKind(file.name).label} · ${file.botName}`,
    icon: itemIcon(file)
  }));
  const messageRows = messages.map((message) => ({ key: `message-${message.id}`, kind: "message", message, ...snippet(message.text, needle), secondary: whereAndWhen(message) }));
  return [...chats, ...botRows, ...personRows, ...appRows, ...tucked, ...commandRows, ...routineRows, ...fileRows, ...messageRows];
}
