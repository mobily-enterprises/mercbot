import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { currentLanguage, currentTimeZone } from "./shellPreferences.js";
import { homeRoutes } from "./homeApi.js";

// Client for the chat routes (D-112, packages/bots registerRoutes.js): the person's chat list, one chat, New room, its
// members, the person's own place in each, and everything said in a chat.
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });
const { request, post, patch, remove } = homeRoutes(client);
const chat = (chatId, path = "") => `/chats/${encodeURIComponent(chatId)}${path}`;

/** Resolves after `ms` milliseconds: the retry pauses here, and the client's paced steps. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A server can disappear mid-request when machines are replaced (D-19). Requests that are safe to repeat are retried a
// few times with growing pauses, about 15 seconds in all, when nothing answered (status 0) or a gateway did (502, 503,
// 504).
async function retrying(work) {
  for (const delay of [1000, 2000, 4000, 8000]) {
    try {
      return await work();
    } catch (error) {
      if (!(error?.status === 0 || error?.status >= 502)) throw error;
      await sleep(delay);
    }
  }
  return work();
}

/** The person's time zone and language, as set in Settings or from the browser, which every reply is given. */
const where = () => ({ timeZone: currentTimeZone(), language: currentLanguage() });

export const chatsApi = {
  // The person's whole chat list ({ chats, sections }), with when its read began (`startedAt`, for the store's
  // mergeChats). `hidden` and `archived` list those too. The server answers a page at a time; every page is read.
  list: async ({ hidden = false, archived = false } = {}) => {
    const startedAt = performance.now();
    const chats = [];
    let page = { next: null };
    do {
      const query = new URLSearchParams({
        ...(hidden ? { hidden: "1" } : {}),
        ...(archived ? { archived: "1" } : {}),
        ...(page.next ? { after: page.next } : {})
      }).toString();
      page = await request(`/chats${query ? `?${query}` : ""}`);
      chats.push(...page.chats);
    } while (page.next);
    return { chats, sections: page.sections, startedAt };
  },
  // One chat the person can open: { chat }.
  get: (chatId) => request(chat(chatId)),
  // New room's Create: { kind: "public" | "private", title, people: userIds, bots: botIds } → { chat }; a room needs its
  // title (400 bots_chat_needs_title).
  create: (choice) => post("/chats", choice),
  // The home's public rooms the person isn't in, which the sidebar lists faded: { chats }. The server answers a page at
  // a time, newest first; every page is read.
  publicRooms: async () => {
    const chats = [];
    let page = { next: null };
    do {
      page = await request(`/chats/public${page.next ? `?${new URLSearchParams({ after: page.next })}` : ""}`);
      chats.push(...page.chats);
    } while (page.next);
    return { chats };
  },
  // A card's "Show hidden and archived": a page of the person's hidden and archived chats one bot (`withBot`) or one
  // person (`withPerson`) is in too, newest chat first, 20 at a time: { chats, next }, `after` the page before's `next`.
  sharedTuckedAway: ({ withBot = null, withPerson = null, after = null }) => request(`/chats/shared?${new URLSearchParams({
    ...(withBot ? { withBot: String(withBot) } : {}),
    ...(withPerson ? { withPerson: String(withPerson) } : {}),
    ...(after ? { after: String(after) } : {})
  })}`),
  // Continue with others (D-114): the hand-over note the direct chat's bot writes for a new chat, { note }; nothing kept.
  handOverNote: (chatId) => post(chat(chatId, "/hand-over-note")),
  // A bot's [Message]: the person's direct chat with it, made on first use: { chat }.
  direct: (botId) => post(`/bots/${encodeURIComponent(botId)}/direct`),
  // A person's [Message] and their row in People: the private chat of just the two of them, made on first use: { chat }.
  personDirect: (userId) => post(`/people/${encodeURIComponent(userId)}/direct`),
  // An app's chat with the Builder (D-41: Ask Builder), public and named after the app, made the first time anyone asks:
  // { chat }; 409 apps_builder_missing while the home has no Builder.
  appChat: (appSlug) => post(`/apps/${encodeURIComponent(appSlug)}/chat`),
  // The person's welcome chat, their direct chat with the home's main bot, made once at their first visit (a new home's
  // main bot with it): { chat }.
  welcome: () => post("/chats/welcome"),
  rename: (chatId, title) => patch(chat(chatId), { title }),
  // Whether the chat's bots join in when useful (D-115): its maker's and the home's owners' and admins'.
  setJoinIn: (chatId, botsJoinIn) => patch(chat(chatId), { botsJoinIn }),
  archive: (chatId) => post(chat(chatId, "/archive")),
  unarchive: (chatId) => post(chat(chatId, "/unarchive")),
  remove: (chatId) => remove(chat(chatId)),
  // { chat }, { left: true } out of a private chat, or { deleted: true } when the last person left it.
  leave: (chatId) => post(chat(chatId, "/leave")),
  // A public room joined by the person, as opening a faded one does: { chat }.
  join: (chatId) => post(chat(chatId, "/join")),
  addPerson: (chatId, userId) => post(chat(chatId, "/people"), { userId }),
  removePerson: (chatId, userId) => remove(chat(chatId, `/people/${encodeURIComponent(userId)}`)),
  addBot: (chatId, botId) => post(chat(chatId, "/bots"), { botId }),
  removeBot: (chatId, botId) => remove(chat(chatId, `/bots/${encodeURIComponent(botId)}`)),
  // The person's own place in a chat: { pinned, sectionId, hidden, muted, unread }, each optional → { chat }.
  changePlace: (chatId, changes) => patch(chat(chatId, "/place"), changes),
  markRead: (chatId, messageId) => post(chat(chatId, "/read"), { messageId }),
  // The person started (true) or stopped (false) typing there: told to the chat's other people (useChatTyping.js).
  typing: (chatId, typing) => post(chat(chatId, "/typing"), { typing }),
  reorderPins: (chatIds) => request("/chat-pins", { method: "PUT", body: { chatIds } }),
  createSection: (name, chatId) => post("/chat-sections", { name, chatId }),
  updateSection: (sectionId, changes) => patch(`/chat-sections/${encodeURIComponent(sectionId)}`, changes),
  moveSection: (sectionId, direction) => post(`/chat-sections/${encodeURIComponent(sectionId)}/move`, { direction }),
  removeSection: (sectionId) => remove(`/chat-sections/${encodeURIComponent(sectionId)}`),

  // What is said in a chat: its newest page and whether older ones are left (`more`); with `since`, an earlier answer's
  // cursor, only what was written or changed after it (D-15); with `before`, a message id, the page before it.
  messages: (chatId, { since = null, before = null } = {}) => {
    const query = new URLSearchParams({ ...(since ? { since } : {}), ...(before ? { before } : {}) }).toString();
    return request(chat(chatId, `/messages${query ? `?${query}` : ""}`));
  },
  // Find in chat before `before`, the oldest message the page has: { count, newest, oldest }.
  find: (chatId, text, before) => request(chat(chatId, `/find?${new URLSearchParams({ q: text, before })}`)),
  // `clientId` makes a repeated send store the message once.
  send: (chatId, message) => retrying(() => post(chat(chatId, "/messages"), message)),
  // The bots' reply to the newest message (who speaks is the server's, R3). `afterMessageId` makes a repeated request
  // return the reply already made instead of a second one; `afterCard` says it follows the person answering a card.
  reply: (chatId, afterMessageId = null, { afterCard = false } = {}) =>
    retrying(() => post(chat(chatId, "/reply"), { ...where(), afterMessageId, afterCard })),
  activity: (chatId, messageId) => post(chat(chatId, `/messages/${messageId}/activity`)),
  react: (chatId, messageId, emoji) => request(chat(chatId, `/messages/${messageId}/reaction`), { method: "PUT", body: { emoji } }),
  answer: (chatId, messageId, selected) => post(chat(chatId, `/choices/${messageId}`), { selected }),
  settleHandover: (chatId, messageId, outcome) => post(chat(chatId, `/handover/${messageId}`), { outcome }),
  settleSecureForm: (chatId, messageId, answer) => post(chat(chatId, `/secure-forms/${messageId}`), answer),
  // The person started signing in from a connect card: the bot finishes its task once the app is connected.
  connectFromCard: (chatId, messageId) => post(chat(chatId, `/connect-cards/${messageId}`), where()),
  settleDraft: (chatId, messageId, answer) => post(chat(chatId, `/drafts/${messageId}`), answer),
  // Discuss (D-115): a card proposed with the question ({ messages }), then each press on it ({ message }). Start, One
  // more round and Wrap up are given where the person is, as replies are.
  discuss: (chatId, question) => post(chat(chatId, "/discussions"), { question }),
  discussion: (chatId, messageId, press, input = {}) =>
    post(chat(chatId, `/discussions/${messageId}/${press}`), ["start", "round", "wrap"].includes(press) ? { ...where(), ...input } : {}),
  advance: (chatId, step) => post(chat(chatId, "/onboarding/advance"), { step }),
  chooseName: (chatId, name) => post(chat(chatId, "/onboarding/name"), { name }),
  voiceCall: (chatId, botId, seconds) => post(chat(chatId, `/bots/${botId}/voice-call`), { seconds }),
  // Teaching a bot a task on its computer in this chat (D14: the chat's computer).
  teachStart: (chatId, botId) => post(chat(chatId, `/bots/${botId}/teach/start`)),
  teachStop: (chatId, botId, discard = false) => post(chat(chatId, `/bots/${botId}/teach/stop`), { discard }),
  // Routines belong to a bot in a chat: a chat's, and a bot's in the chats the person can open, each { routines }.
  routinesIn: (chatId) => request(chat(chatId, "/routines")),
  routinesOf: (botId) => request(`/bots/${encodeURIComponent(botId)}/routines`),
  switchRoutine: (routineId, enabled) => patch(`/routines/${encodeURIComponent(routineId)}`, { enabled }),
  removeRoutine: (routineId) => remove(`/routines/${encodeURIComponent(routineId)}`)
};

// Delay before each step of the welcome chat (and of a bot's first chat with a person) runs, and the status line shown
// while waiting; the steps waiting on the person's answer (ask-name, home-for, home-people) have none (onboarding.js).
export const ONBOARDING_TIMING = {
  start: { delay: 6000, status: "Getting things started" },
  confirm: { delay: 3000, status: "Thinking it over" },
  rename: { delay: 5000, status: "Wrapping up" },
  about: { delay: 2000, status: "Wrapping up" },
  connect: { delay: 4000, status: "Explaining how I work" },
  settle: { delay: 4000, status: "Setting up your apps" },
  "await-nudge": { delay: 180000, status: "" },
  "intro-greet": { delay: 2500, status: "Typing" },
  "intro-ask": { delay: 1500, status: "Typing" },
  "people-offer": { delay: 1500, status: "Typing" }
};
