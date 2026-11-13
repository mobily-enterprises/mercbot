import { fileKind } from "./filesApi.js";
import extensions from "./extensions.js";

// What Settings: General is found by, with the buttons a copy built on Mercbot adds there (extensions.js).
const GENERAL_KEYWORDS = ["theme appearance accent language spell microphone timezone", ...extensions.generalActions.map((action) => action.title.toLowerCase())].join(" ");

/**
 * The search palette's commands: new bot and group, shortcuts, the open group's members,
 * each settings section, Connect Apps and the three themes, the current one checked.
 * @param {{
 *   currentBot: import("../../types.js").Bot | null,
 *   settingsSections: Array<{ value: string, title: string }>,
 *   theme: string
 * }} state
 */
export function paletteCommands({ currentBot, settingsSections, theme: currentTheme }) {
  return [
    { id: "newBot", title: "New Bot", icon: "$editSquare" },
    { id: "newGroup", title: "New group chat", icon: "$group" },
    { id: "shortcuts", title: "Keyboard shortcuts", category: "Help", icon: "$keyboard" },
    ...(currentBot?.kind === "group" ? [{ id: "members", title: "Members", category: "Current chat", icon: "$group" }] : []),
    ...settingsSections.map((section) => ({
      id: `settings:${section.value}`,
      title: `Settings: ${section.title}`,
      category: "Settings",
      icon: "$settings",
      keywords: section.value === "general" ? GENERAL_KEYWORDS : ""
    })),
    { id: "connectApps", title: "Connect Apps", category: "Search across apps and skills", icon: "$extension" },
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

function conversationRow(bot) {
  return {
    key: `bot-${bot.id}`,
    kind: "conversation",
    bot,
    title: bot.name,
    secondary: bot.kind === "group" ? (bot.members || []).map((member) => member.name).join(", ") : "",
    chip: bot.kind === "group" ? "" : bot.label || "",
    tag: bot.hidden ? "hidden" : "",
    unread: bot.unread
  };
}

// Before typing: unread first, then pinned in tile order, then by latest activity. Hidden bots
// aren't listed until you search.
function emptyOrder(bots) {
  const rank = (bot) => (bot.unread ? 0 : bot.pinPosition !== null && bot.pinPosition !== undefined ? 1 : 2);
  return bots.filter((bot) => !bot.hidden).sort((a, b) => rank(a) - rank(b) ||
    (rank(a) === 1 ? a.pinPosition - b.pinPosition : new Date(b.lastActivityAt) - new Date(a.lastActivityAt)));
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

function whereAndWhen(message) {
  if (message.conversationKind === "group") return `${message.conversationName} · ${ago(message.createdAt)}`;
  const who = message.role === "user" ? `You to ${message.conversationName}` : `${message.conversationName} to you`;
  return `${who} · ${ago(message.createdAt)}`;
}

/**
 * The palette's rows. Before typing: bots and groups, then commands. While
 * typing: bots and groups, apps, hidden bots, commands, routines, made files and messages, each
 * matched loosely and the earliest first letter first.
 * @param {{
 *   needle: string,
 *   bots: Array<import("../../types.js").Bot>,
 *   commands: ReturnType<typeof paletteCommands>,
 *   apps: Array<import("../../types.js").Plugin>,
 *   routines: Array<Record<string, any>>,
 *   files: Array<Record<string, any>>,
 *   messages: Array<Record<string, any>>
 * }} state `needle` is the typed text, trimmed and lower case.
 */
export function paletteEntries({ needle, bots: allBots, commands: allCommands, apps, routines, files, messages }) {
  const commands = allCommands.map((command) => ({ key: command.id, kind: "command", ...command }));
  if (!needle) return [...emptyOrder(allBots).map(conversationRow), ...commands];
  // A bot's label is searched too; its contiguous match counts from where it starts.
  const matched = byScore(allBots.map((bot) => ({
    ...conversationRow(bot),
    score: best(score(bot.name, needle), bot.label && bot.label.toLowerCase().includes(needle) ? bot.label.toLowerCase().indexOf(needle) + 100 : null)
  })));
  const bots = matched.filter((entry) => !entry.bot.hidden);
  const hidden = matched.filter((entry) => entry.bot.hidden);
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
    secondary: `${routine.schedule} · ${routine.botName}`,
    score: score(routine.name, needle)
  })));
  const fileRows = files.map((file) => ({
    key: `file-${file.botId ?? "home"}-${file.path}`,
    kind: "file",
    file,
    title: file.name,
    secondary: file.kind === "view" ? "View" : `${{ page: "Page", chart: "Chart", picture: "Picture" }[file.kind] || fileKind(file.name).label} · ${file.botName}`,
    icon: file.kind === "view" ? "$dashboard" : file.kind === "page" ? "$book2" : file.kind === "chart" ? "$barChart" : fileKind(file.name).icon
  }));
  const messageRows = messages.map((message) => ({ key: `message-${message.id}`, kind: "message", message, ...snippet(message.text, needle), secondary: whereAndWhen(message) }));
  return [...bots, ...appRows, ...hidden, ...commandRows, ...routineRows, ...fileRows, ...messageRows];
}
