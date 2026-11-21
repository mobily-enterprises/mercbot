import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { homeRoutes } from "./homeApi.js";

// Client for the home's bots (D-112: members of the home, like people, in any number of chats): the Team page's list,
// one bot, Add bots, templates and teams, and a bot's own Details (instructions, knowledge, template, library). What is
// said in chats, and a chat's members, are chatsApi.js's.
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });

// Every bots route belongs to the current home (D-36).
const { request, post, patch, remove } = homeRoutes(client);

export const botsApi = {
  // The home's bots as Team lists them ({ bots }), archived ones too (D-108).
  list: () => request("/bots"),
  // One bot as Team lists it: { bot }.
  bot: (botId) => request(`/bots/${botId}`),
  search: (query) => request(`/search?q=${encodeURIComponent(query)}`),
  // Mercbot's pickable skills and the person's own, for the "/" picker.
  skills: () => request("/bot-skills"),
  // What the bot made in the chats the person can open, for its Library.
  library: (botId) => request(`/bots/${botId}/library`),
  pinItem: (botId, item, pinned) => post(`/bots/${botId}/library/pin`, { messageId: item.messageId, path: item.path, pinned }),
  // A page deleted from the Library: the Library again, and the page's cards.
  deletePage: (botId, item) => remove(`/bots/${botId}/library/pages/${item.messageId}`),
  create: (bot) => post("/bots", bot),
  // A bot from a template a shared link opens, after the person has seen it all (D-98: it becomes the home's).
  fromTemplate: (slug) => post("/bots/from-template", { slug }),
  // Teams (D-105): a team's bots as the home has them, and Add N bots, which answers the whole list and the bots it added.
  team: (teamId) => request(`/teams/${encodeURIComponent(teamId)}`),
  addTeam: (teamId, templates) => post(`/teams/${encodeURIComponent(teamId)}`, { templates }),
  // Add bots' suggestions (D-109): a plan for what the person describes (or the plan before, changed as asked), and
  // Add N bots, the ones ticked on it.
  suggestBots: (body) => post("/bots/plan", body),
  addBots: (body) => post("/bots/batch", body),
  // A bot's name, colour, shape or additions, or { main: true } (owners and admins): { bot }.
  update: (botId, changes) => patch(`/bots/${botId}`, changes),
  // A request between bots, cancelled by the person it's for (D-46).
  cancelRequest: (requestId) => post(`/bot-requests/${requestId}/cancel`),
  // A whole bot archived and unarchived for everyone in the home (D-108): each answers { bot } as listed.
  archiveBot: (botId) => post(`/bots/${botId}/archive`),
  unarchiveBot: (botId) => post(`/bots/${botId}/unarchive`),
  // A bot's template and additions (D-98): its additions change with update(botId, { additions }), its template with
  // changeTemplate(botId, { library: slug }, { home: id } or { draft, foldAdditions }).
  instructions: (botId) => request(`/bots/${botId}/instructions`),
  // What a bot knows (D-107): the list, each piece's text, and its changes, each of which answers the list.
  knowledge: (botId) => request(`/bots/${botId}/knowledge`),
  knowledgePiece: (botId, id) => request(`/bots/${botId}/knowledge/${id}`),
  addKnowledge: (botId, piece) => post(`/bots/${botId}/knowledge`, piece),
  changeKnowledge: (botId, id, changes) => patch(`/bots/${botId}/knowledge/${id}`, changes),
  removeKnowledge: (botId, id) => remove(`/bots/${botId}/knowledge/${id}`),
  retryKnowledge: (botId, id) => post(`/bots/${botId}/knowledge/${id}/retry`),
  changeTemplate: (botId, choice) => request(`/bots/${botId}/template`, { method: "PUT", body: choice }),
  // A template drafted by the bot ({ purpose: "new" | "from-bot" | "change", … }): { draft, problems }, nothing kept.
  draftTemplate: (body) => post("/bots/templates/draft", body),
  // The home's own templates (D-98): each one's tag, description and how many bots use it; one in full; an owner's or
  // admin's edit (naming the updatedAt it opened) and delete.
  homeTemplates: () => request("/home-templates"),
  homeTemplate: (templateId) => request(`/home-templates/${templateId}`),
  editHomeTemplate: (templateId, draft, updatedAt) => request(`/home-templates/${templateId}`, { method: "PUT", body: { draft, updatedAt } }),
  deleteHomeTemplate: (templateId) => remove(`/home-templates/${templateId}`),
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
  })
};
