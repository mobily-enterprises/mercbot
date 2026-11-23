import { onScopeDispose, ref, watch } from "vue";
import { chatsApi } from "./chatsApi.js";

// Who is typing where, as the best chat apps show it: a chat's other people see "Ana is typing" a moment after Ana
// starts, until she sends, empties the box or pauses, and never for long after her page stops saying so. Nothing is
// stored: the server passes each word on to the chat's other people (`typing` events, useChatEvents.js).

/** A person stays shown typing this long after their page last said so, unless it says so again or says they stopped. */
const SHOWN_MS = 7000;
/** While the person types, their page says so again this often, well inside SHOWN_MS. */
const REPEAT_MS = 3000;
/** Typing that pauses this long counts as stopped. */
const PAUSE_MS = 5000;

/** The people typing in each chat (chatId → their user ids, earliest first), from the `typing` events. */
// readable-check: allow module-state - shared resource: the server's news arrives in the shell and shows in the chat list and the open chat
export const typingByChat = ref({});
const fading = new Map();

function show(chatId, userId, typing) {
  const key = `${chatId} ${userId}`;
  clearTimeout(fading.get(key));
  fading.delete(key);
  const others = (typingByChat.value[chatId] || []).filter((id) => id !== userId);
  const now = typing ? [...others, userId] : others;
  if (typing) fading.set(key, setTimeout(() => show(chatId, userId, false), SHOWN_MS));
  const { [chatId]: _gone, ...rest } = typingByChat.value;
  typingByChat.value = now.length ? { ...rest, [chatId]: now } : rest;
}

/** A `typing` event: someone in a chat started or stopped typing. */
export function heardTyping({ chatId, userId, typing }) {
  show(String(chatId), String(userId), typing === true);
}

/** The names of the people typing in a chat, as the chat names them, never the person themself. */
export function typingNames(chat, me) {
  if (!chat) return [];
  const names = new Map((chat.people || []).map((person) => [String(person.userId), person.name || "Someone"]));
  return (typingByChat.value[chat.id] || []).filter((id) => id !== String(me) && names.has(id)).map((id) => names.get(id));
}

/** "Ana is typing", "Ana and Max are typing", "Ana, Max and Lee are typing", "Several people are typing", or "". */
export function typingLine(names) {
  if (!names.length) return "";
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} are typing`;
  return "Several people are typing";
}

/**
 * Tells a chat's other people while this person types in it: when they start, again every REPEAT_MS while they go on,
 * and that they stopped once they send, empty the box, pause for PAUSE_MS, go to another chat or close it. Opening a
 * chat with a draft already in it isn't typing, and a chat with nobody else in it hears nothing.
 * @param {{ chatId: () => string, draft: () => string, alone: () => boolean }} options
 */
export function useTypingSignal({ chatId, draft, alone }) {
  let typingIn = "";
  let saidAt = 0;
  let pause = null;
  const say = (id, typing) => chatsApi.typing(id, typing).catch(() => {});

  function stop() {
    clearTimeout(pause);
    if (typingIn) say(typingIn, false);
    typingIn = "";
  }

  watch([chatId, draft], ([id, text], [idBefore]) => {
    if (!id || id !== idBefore || !String(text || "").trim() || alone()) return stop();
    clearTimeout(pause);
    pause = setTimeout(stop, PAUSE_MS);
    if (typingIn === id && Date.now() - saidAt < REPEAT_MS) return;
    typingIn = id;
    saidAt = Date.now();
    say(id, true);
  });
  onScopeDispose(stop);
}
