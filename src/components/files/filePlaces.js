import { computed, ref, shallowRef } from "vue";
import { isRoom } from "../mercbot/chatDirectory.js";
import { filesApi } from "../mercbot/filesApi.js";

// The places a person's files are in (D-47, D-112 R6): the home's folder, each bot's own and each chat's, as the file
// browser's places column and the place picker list them. Each place, as the server lists it (`…/files/places`),
// becomes an item:
//   key       "home", "bot:<id>" or "chat:<id>"
//   label     what the column shows ("This room", "Home files", the bot's name, the chat's title)
//   title     what a sentence names it by ("Ledger's files", "this room")
//   group     "here" (the chat it was opened from), "home", "bots" or "chats"
//   place     the place as the transfer route names it: { kind } with botId or chatId
//   botId, chat, root   the bot and chat the per-place routes name it by (filesApi), and its folder
//   archived  a chat that takes nothing new
//   locked    Database files (D-130): records' files, opened and copied out, never changed by hand

const ROOTS = Object.freeze({ home: "/files/shared", bot: "/files/bot", chat: "/files/chat", db: "/files/db" });

export const nameOf = (filePath) => String(filePath).split("/").pop();
export const parentOf = (filePath) => String(filePath).slice(0, String(filePath).lastIndexOf("/"));

const chatIcon = (place) => {
  if (place.direct === "bot") return "$smartToy";
  if (place.direct === "person") return "$person";
  return place.private ? "$lock" : "$language";
};

/**
 * The places in the order the browser shows them: the chat it was opened from first ("This room" or "This chat"), then
 * Home files, then the bots (the home's main bot first), then the rooms and chats. `chat` is the row of the chat it was
 * opened from, and `chatBotId` the bot its folder is reached through there (so the viewer can open a file on that bot's
 * computer).
 * @param {Array<Record<string, any>>} places
 * @param {{ chat?: Record<string, any> | null, chatBotId?: string | null }} [from]
 */
export function orderPlaces(places, { chat = null, chatBotId = null } = {}) {
  const hereId = chat ? String(chat.id) : null;
  const home = { key: "home", kind: "home", label: "Home files", title: "Home files", group: "home", icon: "$home", place: { kind: "home" }, botId: null, chat: null, root: ROOTS.home, archived: false };
  // The records' files, read through the home's own place.
  const database = { ...home, key: "db", label: "Database files", title: "Database files", icon: "$lock", root: ROOTS.db, locked: true };
  const bots = places
    .filter((place) => place.kind === "bot")
    .map((place, index) => ({ place, index }))
    .sort((a, b) => Number(Boolean(b.place.main)) - Number(Boolean(a.place.main)) || a.index - b.index)
    .map(({ place }) => ({
      key: `bot:${place.botId}`,
      kind: "bot",
      label: place.name,
      title: `${place.name}'s files`,
      group: "bots",
      icon: "$smartToy",
      bot: { name: place.name, color: place.color, shape: place.shape },
      place: { kind: "bot", botId: String(place.botId) },
      botId: String(place.botId),
      chat: null,
      root: ROOTS.bot,
      archived: false
    }));
  // A direct chat is named as one, so "Chat with Whiskers" never reads like Whiskers' own files.
  const chatName = (place) => (place.direct ? `Chat with ${place.title}` : place.title || "Untitled chat");
  const chatItem = (place, here) => ({
    key: `chat:${place.chatId}`,
    kind: "chat",
    label: here ? (isRoom(chat) ? "This room" : "This chat") : chatName(place),
    title: here ? (isRoom(chat) ? "this room" : "this chat") : chatName(place),
    group: here ? "here" : "chats",
    icon: chatIcon(place),
    place: { kind: "chat", chatId: String(place.chatId) },
    botId: here && chatBotId ? String(chatBotId) : null,
    chat: String(place.chatId),
    root: ROOTS.chat,
    archived: Boolean(place.archived)
  });
  const chats = places.filter((place) => place.kind === "chat");
  const listedHere = hereId ? chats.find((place) => String(place.chatId) === hereId) : null;
  // The chat it was opened from leads, even when the list doesn't have it (a public room being visited).
  const here = hereId ? [chatItem(listedHere || { chatId: hereId, archived: Boolean(chat.archivedAt) }, true)] : [];
  const others = chats.filter((place) => String(place.chatId) !== hereId).map((place) => chatItem(place, false));
  return [...here, home, database, ...bots, ...others];
}

/** The key of the place the browser opens at: the bot's whose card it's on, else the chat's it's in, else the home's. */
export const startKey = ({ botId = null, chat = null } = {}) => {
  if (botId) return `bot:${botId}`;
  return chat ? `chat:${chat.id}` : "home";
};

/** Whether this is a Mac, where ⌥ (not Ctrl) copies while dragging, as Finder does. */
export function onMac() {
  const agent = globalThis.navigator;
  return /mac/iu.test(String(agent?.userAgentData?.platform || agent?.platform || ""));
}

/**
 * What a drop does: copy while Ctrl is held (⌥ on a Mac), otherwise move.
 * @param {{ ctrlKey?: boolean, altKey?: boolean }} event
 * @param {boolean} mac
 */
export const dropMode = (event, mac) => ((mac ? event.altKey : event.ctrlKey) ? "copy" : "move");

/** What a drop target says while something is over it: "Move to Home files", "Copy to this room". */
export const dropLabel = (mode, item) => `${mode === "copy" ? "Copy" : "Move"} to ${item.title}`;

/** What the person is asked before a file leaves a private chat for a wider place. */
export const widerQuestion = (item) => `Everyone who can open ${item.title} will see this file. Continue?`;

/** What an archived chat's place says, in the picker and the browser: it takes nothing new. */
export const ARCHIVED_NOTE = "This chat is archived: nothing new can go in it.";

/** What Database files say, in the picker and the browser: they belong to their records (D-130). */
export const LOCKED_NOTE = "These files belong to their table's records: open one or copy it out, but nothing here is moved, renamed or deleted.";

/**
 * Why the place picker's folder open can't take what's being copied or moved there, or "": an archived chat, itself or
 * a folder inside it, or (a move) the folder it's already in.
 * @param {{ mode: string, item: Record<string, any>, folder: string, from: string, path: string }} where
 */
export function pickerRefusal({ mode, item, folder, from, path }) {
  if (item.archived) return ARCHIVED_NOTE;
  if (item.locked) return LOCKED_NOTE;
  if (item.key !== from) return "";
  if (folder === path || folder.startsWith(`${path}/`)) return "A folder can't go inside itself.";
  return mode === "move" && folder === parentOf(path) ? "It's already here." : "";
}

/** The place picker's button: "Copy here", "Move here", or for Add from files how many files it adds. */
export function pickerAction(mode, chosen = 0) {
  if (mode !== "add") return mode === "copy" ? "Copy here" : "Move here";
  if (!chosen) return "Add files";
  return chosen === 1 ? "Add 1 file" : `Add ${chosen} files`;
}

/**
 * The places a person can open, read when asked (`load`), in the browser's order for the chat it was opened from.
 * @param {{ chat: () => Record<string, any> | null, chatBotId: () => string | null }} options
 */
export function useFilePlaces({ chat, chatBotId }) {
  const places = ref(null);
  const problem = ref("");
  async function load() {
    problem.value = "";
    try {
      places.value = orderPlaces((await filesApi.places()).places || [], { chat: chat(), chatBotId: chatBotId() });
    } catch (error) {
      problem.value = error?.message || "The places couldn't load.";
    }
  }
  return { places, problem, load };
}

/**
 * One folder of one place at a time, as the browser and the picker show it: `go` opens a place's folder (its root by
 * default), `current` is its listing once it has come ({ path, entries, left, partial }), and `failure` why it didn't. A
 * reply for a folder left meanwhile is dropped.
 */
export function useFolderListing() {
  // Shallow, so the folder asked for is the same object when its reply comes.
  const at = shallowRef(null);
  const listing = ref(null);
  const failure = ref(null);
  async function go(item, folder = item.root) {
    const asked = { item, folder };
    at.value = asked;
    failure.value = null;
    try {
      const listed = await filesApi.list(item.botId, folder, item.chat);
      if (at.value === asked) listing.value = { ...listed, key: item.key };
    } catch (error) {
      if (at.value === asked) failure.value = error;
    }
  }
  const reload = () => (at.value ? go(at.value.item, at.value.folder) : Promise.resolve());
  const current = computed(() => (at.value && listing.value?.key === at.value.item.key && listing.value.path === at.value.folder ? listing.value : null));
  /** The folders from the place's root to the one open, as breadcrumbs: { label, path }. */
  const crumbs = computed(() => {
    if (!at.value) return [];
    const { item, folder } = at.value;
    const parts = folder.slice(item.root.length).split("/").filter(Boolean);
    return [{ label: pickerLabel(item), path: item.root }, ...parts.map((part, index) => ({ label: part, path: `${item.root}/${parts.slice(0, index + 1).join("/")}` }))];
  });
  return { at, current, failure, crumbs, go, reload };
}

/** A place as a list of places names it on its own: a bot's files as "<Bot>'s files", the rest by their column label. */
export const pickerLabel = (item) => (item.kind === "bot" ? item.title : item.label);
