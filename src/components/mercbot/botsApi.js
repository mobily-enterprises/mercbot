import { ref } from "vue";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { currentLanguage, currentTimeZone } from "./shellPreferences.js";
import { requestInHome } from "./homeApi.js";

// Client for the bots package routes (packages/bots).
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });

// Every bots route belongs to the current home (D-36).
const request = (path, options) => requestInHome(client, path, options);
const post = (url, body = {}) => request(url, { method: "POST", body });

/** Resolves after `ms` milliseconds: the retry pauses here, and the client's paced steps. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A server can disappear mid-request when machines are replaced (D-19). Requests that are safe
// to repeat are retried a few times with growing pauses, about 15 seconds in all, when nothing
// answered (status 0) or a gateway did (502, 503, 504).
async function retrying(request) {
  for (const delay of [1000, 2000, 4000, 8000]) {
    try {
      return await request();
    } catch (error) {
      if (!(error?.status === 0 || error?.status >= 502)) throw error;
      await sleep(delay);
    }
  }
  return request();
}
const patch = (url, body) => request(url, { method: "PATCH", body });
const remove = (url) => request(url, { method: "DELETE" });

export const botsApi = {
  // The whole list, with when its read began (`startedAt`, for useBotMessages' mergeBots).
  list: () => {
    const startedAt = performance.now();
    return request("/bots").then((listed) => ({ ...listed, startedAt }));
  },
  // One bot as the list shows it, when it has news (D-15).
  bot: (botId) => request(`/bots/${botId}`),
  search: (query) => request(`/search?q=${encodeURIComponent(query)}`),
  // Mercbot's pickable skills and the person's own, for the "/" picker.
  skills: () => request("/bot-skills"),
  // What the person's bots remember about them.
  memories: () => request("/memories"),
  // What the bot made, for its Library.
  library: (botId) => request(`/bots/${botId}/library`),
  pinItem: (botId, item, pinned) => post(`/bots/${botId}/library/pin`, { messageId: item.messageId, path: item.path, pinned }),
  // A page deleted from the Library: the Library again, and the page's cards.
  deletePage: (botId, item) => remove(`/bots/${botId}/library/pages/${item.messageId}`),
  // The person's answer on a secure form: submit with the values, or close.
  settleDraft: (botId, messageId, answer) => post(`/bots/${botId}/drafts/${messageId}`, answer),
  settleSecureForm: (botId, messageId, answer) => post(`/bots/${botId}/secure-forms/${messageId}`, answer),
  // The person started signing in from a connect card: the bot finishes its task once the app is connected.
  connectFromCard: (botId, messageId) =>
    post(`/bots/${botId}/connect-cards/${messageId}`, { timeZone: currentTimeZone(), language: currentLanguage() }),
  forgetMemory: (memoryId) => remove(`/memories/${memoryId}`),
  createFirst: () => post("/bots/first"),
  create: (bot) => post("/bots", bot),
  // A bot from a template or a shared link, after the person has seen it all.
  fromTemplate: (slug) => post("/bots/from-template", { slug }),
  answer: (botId, messageId, selected) => post(`/bots/${botId}/choices/${messageId}`, { selected }),
  // A shared bot's messages are its open tab's (D-36): the newest page and whether older ones are
  // left (`more`). With `since`, an earlier answer's cursor, only what was written or changed after
  // it (D-15); with `before`, a message id, the page before that message.
  messages: (botId, room = null, since = null, before = null) => {
    const query = new URLSearchParams({ ...(room ? { room } : {}), ...(since ? { since } : {}), ...(before ? { before } : {}) }).toString();
    return request(`/bots/${botId}/messages${query ? `?${query}` : ""}`);
  },
  // Find in chat before `before`, the oldest message the page has: { count, newest, oldest }.
  find: (botId, room, text, before) => {
    const query = new URLSearchParams({ q: text, before, ...(room ? { room } : {}) }).toString();
    return request(`/bots/${botId}/find?${query}`);
  },
  // `clientId` makes a repeated send store the message once.
  send: (botId, message) => retrying(() => post(`/bots/${botId}/messages`, message)),
  // The person's time zone and language, as set in Settings or from the browser.
  // `afterMessageId` makes a repeated request return the reply already made instead of a second one.
  reply: (botId, afterMessageId = null, room = null) => retrying(() => post(`/bots/${botId}/reply`, { timeZone: currentTimeZone(), language: currentLanguage(), afterMessageId, room })),
  activity: (botId, messageId) => post(`/bots/${botId}/messages/${messageId}/activity`),
  react: (botId, messageId, emoji) => request(`/bots/${botId}/messages/${messageId}/reaction`, { method: "PUT", body: { emoji } }),
  advance: (botId, step) => post(`/bots/${botId}/onboarding/advance`, { step }),
  chooseName: (botId, name) => post(`/bots/${botId}/onboarding/name`, { name }),
  update: (botId, changes) => patch(`/bots/${botId}`, changes),
  // A request between bots, cancelled by the person it's for (D-46).
  cancelRequest: (requestId) => post(`/bot-requests/${requestId}/cancel`),
  // A mixed bot's home notebook (D-36).
  notebook: (botId, after = null) => request(`/bots/${botId}/notebook${after ? `?after=${encodeURIComponent(after)}` : ""}`),
  removeNote: (botId, noteId) => remove(`/bots/${botId}/notebook/${noteId}`),
  // A shared bot's tabs (D-36): a new one continues from `from`; every tab has a name.
  createRoom: (botId, room) => post(`/bots/${botId}/rooms`, room),
  roomForApp: (botId, app) => post(`/bots/${botId}/rooms/app`, app),
  renameRoom: (botId, roomId, title) => patch(`/bots/${botId}/rooms/${roomId}`, { title }),
  remove: (botId) => remove(`/bots/${botId}`),
  routines: (botId) => request(`/bots/${botId}/routines`),
  setRoutine: (botId, routineId, enabled) => patch(`/bots/${botId}/routines/${routineId}`, { enabled }),
  createGroup: (group) => post("/groups", group),
  addMember: (groupId, botId) => post(`/groups/${groupId}/members`, { botId }),
  removeMember: (groupId, botId) => remove(`/groups/${groupId}/members/${botId}`),
  // People in a group (D-46).
  addPerson: (groupId, userId) => post(`/groups/${groupId}/people`, { userId }),
  removePerson: (groupId, userId) => remove(`/groups/${groupId}/people/${userId}`),
  voiceCall: (botId, seconds) => post(`/bots/${botId}/voice-call`, { seconds }),
  teachStart: (botId) => post(`/bots/${botId}/teach/start`),
  teachStop: (botId, discard = false) => post(`/bots/${botId}/teach/stop`, { discard }),
  removeRoutine: (botId, routineId) => remove(`/bots/${botId}/routines/${routineId}`),
  policy: () => request("/bot-policy"),
  setAutoReview: (autoReview) => patch("/bot-policy", { autoReview }),
  addRule: (rule) => post("/bot-policy/rules", rule),
  updateRule: (ruleId, rule) => patch(`/bot-policy/rules/${ruleId}`, rule),
  deleteRule: (ruleId) => remove(`/bot-policy/rules/${ruleId}`),
  // The account's theme, as Settings → Preferences saves it (JSKIT users, JSON:API): the account's, so outside any home.
  setThemePreference: (theme) => client.request("/api/settings/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/vnd.api+json", accept: "application/vnd.api+json" },
    body: { data: { type: "user-preferences", attributes: { theme } } }
  }),
  reorderPins: (botIds) => request("/bot-pins", { method: "PUT", body: { botIds } }),
  createSection: (name, botId) => post("/bot-sections", { name, botId }),
  updateSection: (sectionId, changes) => patch(`/bot-sections/${sectionId}`, changes),
  moveSection: (sectionId, direction) => post(`/bot-sections/${sectionId}/move`, { direction }),
  removeSection: (sectionId) => remove(`/bot-sections/${sectionId}`)
};

// Counts notes taken out of a home notebook from the chat, so an open notebook reads again (D-36).
// readable-check: allow module-state - shared resource: the chat that takes a note out and the open notebook are different components on the page
export const notebookChanges = ref(0);

// Delay before each onboarding step runs, and the status line shown while waiting.
export const ONBOARDING_TIMING = {
  start: { delay: 6000, status: "Getting things started" },
  confirm: { delay: 3000, status: "Thinking it over" },
  rename: { delay: 5000, status: "Wrapping up" },
  about: { delay: 2000, status: "Wrapping up" },
  connect: { delay: 4000, status: "Explaining how I work" },
  settle: { delay: 4000, status: "Setting up your apps" },
  "await-nudge": { delay: 180000, status: "" },
  "intro-greet": { delay: 2500, status: "Typing" },
  "intro-ask": { delay: 1500, status: "Typing" }
};
