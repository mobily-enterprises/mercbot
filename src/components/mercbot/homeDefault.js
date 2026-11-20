import { ref } from "vue";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { currentHome } from "./homeApi.js";
import { homeRoute } from "./homesApi.js";

// A home's default for new bots (D-100): the sharing every bot made in it from then on gets, Mixed while nobody has
// chosen. The bot list's read brings it for the home the page is in, with the question its owners and admins are asked
// once a second person joins; the New home form, Settings → General and that question change it. With it comes whether
// the home's bots decide when to join in a Shared bot's shared tabs (D-102), which Settings → General turns on and off.
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });

/**
 * The home's default as the server answers it, and whether its bots join in.
 * @typedef {{
 *   newBotSharing: string,
 *   chosen: boolean,
 *   teamQuestion: { name: string, sharing: string } | null,
 *   botsJoinIn: boolean
 * }} HomeDefault
 */

// readable-check: allow module-state - shared resource: the bot list's read sets it, and Who sees what, Settings and the banner read it
export const homeDefault = ref(/** @type {HomeDefault} */ ({ newBotSharing: "mixed", chosen: false, teamQuestion: null, botsJoinIn: true }));

/** The three modes, as Settings → General offers them, each with what it adds to everyone's own chat (D-99). */
export const SHARING_MODES = Object.freeze([
  { value: "private", label: "Private", hint: "Own chats only" },
  { value: "mixed", label: "Mixed", hint: "Plus the notebook" },
  { value: "shared", label: "Shared", hint: "Plus shared tabs" }
]);

/** The New home form's "Who's it for?": Just me, preselected, makes new bots Mixed; A team makes them Shared. */
export const HOME_FOR = Object.freeze([
  { value: "me", label: "Just me", sharing: "mixed" },
  { value: "team", label: "A team", sharing: "shared" }
]);

const settingsOf = (slug) => homeRoute(slug, "/home-settings");

/**
 * Sets a home's default (owners and admins only: anyone else is refused), and answers it as the server keeps it.
 * @param {string} slug the home
 * @param {string} sharing private, mixed or shared
 * @returns {Promise<HomeDefault>}
 */
export function chooseHomeDefault(slug, sharing) {
  return client.request(settingsOf(slug), { method: "PATCH", body: { newBotSharing: sharing } });
}

/**
 * The New home form: makes the home, then sets its default from "Who's it for?", so its first conversation doesn't ask
 * again. A home made whose default didn't go through is still made, Mixed, and its first conversation asks.
 * @param {(name: string) => Promise<{ slug: string }>} create makes the home (useHomes().create)
 * @param {string} name
 * @param {string} forWhom one of HOME_FOR's values
 */
export async function makeHome(create, name, forWhom) {
  const home = await create(name);
  const sharing = (HOME_FOR.find((choice) => choice.value === forWhom) || HOME_FOR[0]).sharing;
  try {
    await chooseHomeDefault(home.slug, sharing);
  } catch {
    // The home is there; its own first conversation asks.
  }
  return home;
}

/** Settings → General: reads again the default of the home the page is in. */
export async function readHere() {
  homeDefault.value = await client.request(settingsOf(currentHome()));
  return homeDefault.value;
}

/**
 * Settings → General: sets the default of the home the page is in, which the page then shows.
 * @param {string} sharing private, mixed or shared
 */
export async function chooseHere(sharing) {
  homeDefault.value = await chooseHomeDefault(currentHome(), sharing);
  return homeDefault.value;
}

/** Settings → General's switch for whether bots join in (D-102): its label, and what it means as it stands. */
export const JOIN_IN = Object.freeze({
  label: "Bots decide when to join in",
  on: "In shared tabs, bots answer when it makes sense, without being called.",
  off: "In shared tabs, bots answer only when named, @-mentioned or replied to."
});

/**
 * Settings → General: turns joining in on or off for the home the page is in (owners and admins only: anyone else is
 * refused), and the page shows what the server keeps.
 * @param {boolean} on
 */
export async function chooseJoinIn(on) {
  homeDefault.value = await client.request(settingsOf(currentHome()), { method: "PATCH", body: { botsJoinIn: on } });
  return homeDefault.value;
}

/**
 * The question once a second person joins: `shared` makes new bots Shared, `keep` keeps them as they are. Either way it
 * isn't asked again.
 * @param {"shared" | "keep"} answer
 */
export async function answerTeamQuestion(answer) {
  homeDefault.value = await client.request(homeRoute(currentHome(), "/home-settings/team-question"), { method: "POST", body: { answer } });
  return homeDefault.value;
}

/**
 * The question's words, for the mode the home's new bots have now.
 * @param {{ name: string, sharing: string }} question
 */
export function teamQuestionWords({ name, sharing }) {
  const isPrivate = sharing === "private";
  const mode = isPrivate ? "Private: each person's own chat" : "Mixed: each person's own chat, plus the home's notebook";
  return {
    text: `${name} joined. New bots here are ${mode}. Make new bots Shared, for the whole home?`,
    note: "Bots you already have keep their mode; change one in its Details → Who sees what.",
    keep: isPrivate ? "Keep Private" : "Keep Mixed"
  };
}
