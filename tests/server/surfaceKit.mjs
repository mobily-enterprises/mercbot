import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createBotArchive } from "../../packages/bots/src/server/botArchive.js";
import { createBotKnowledge } from "../../packages/bots/src/server/botKnowledge.js";
import { createBotLibrary } from "../../packages/bots/src/server/botLibrary.js";
import { createBotList } from "../../packages/bots/src/server/botList.js";
import { createBotPlans } from "../../packages/bots/src/server/botPlans.js";
import { createBotSettings } from "../../packages/bots/src/server/botSettings.js";
import { createBotTeams } from "../../packages/bots/src/server/botTeams.js";
import { NO_TEMPLATE_LINKS, createBotTemplates } from "../../packages/bots/src/server/botTemplates.js";
import { createChatMembers } from "../../packages/bots/src/server/chatMembers.js";
import { createChatRoutines } from "../../packages/bots/src/server/chatRoutines.js";
import { createOnboarding } from "../../packages/bots/src/server/onboarding.js";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";

// The bots' surfaces (step 2's B, D-112) put together on real records the way botsService.js composes them, with the
// other owners' parts as recording doubles: the computer (what sleeps and what a deleted chat removes), the apps (the
// Builder and the views search finds), the files a Library page is deleted from, the turns' pauseWork, and the
// notices every open page hears. A test reads what each double was asked from `calls`.

/**
 * @param {import("knex").Knex} knex the test database
 * @param {{ after: (work: () => unknown) => void }} context the test's, for its cleanup
 * @param {{ model?: object | null, write?: Function, templateLinks?: object, views?: object[], integrations?: object, track?: (who: object) => void }} [options]
 *   `track` hears who each piece of metered work is for, as the meter is asked.
 */
export async function startSurfaces(knex, context, {
  model = null, write = async () => "{}", templateLinks = NO_TEMPLATE_LINKS, views = [], integrations = { app: () => null }, track = null
} = {}) {
  const parts = await startBotParts(knex, context);
  const { records, profiles, workspaces, systemContext } = parts;
  const meter = track ? { ...parts.meter, track: (who, work) => (track(who), parts.meter.track(who, work)) } : parts.meter;
  const calls = { told: [], sleeps: [], removed: [], paused: [], files: [] };
  const builder = { id: null };
  const notices = {
    publish: async (topic, key, event) => { calls.told.push({ topic, keys: [String(key)], event }); },
    publishEach: async (topic, keys, event) => { calls.told.push({ topic, keys: keys.map(String), event }); }
  };
  const computer = {
    sleepHome: async (homeId, chatBotIds) => { calls.sleeps.push({ homeId: String(homeId), chatBotIds: [...chatBotIds].map(String) }); },
    chatRemoved: async (removal) => { calls.removed.push(removal); }
  };
  const apps = {
    apps: {
      builder: async () => (builder.id ? { id: String(builder.id), name: "Builder", color: "#1E86FC" } : null),
      searchViews: async () => views
    }
  };
  const files = {
    store: {
      placeFor: (place) => ({ ...place, kind: "chat" }),
      widened: (place) => ({ ...place, widened: true }),
      botPlace: (place) => ({ ...place, kind: "bot" }),
      remove: async (place, path) => { calls.files.push({ remove: path, place }); },
      settle: async () => {},
      existingFile: async () => ({})
    },
    pages: { pathChanged: async (change) => { calls.files.push({ pathChanged: change }); } }
  };
  // The turns' pauseWork (chatTurns.js): which seats an archive (a bot's or a chat's) asked to pause, and its line.
  const pauseWork = async (seats, line) => { calls.paused.push({ seats: seats.map((seat) => ({ id: String(seat.id), chatId: String(seat.chatId) })), text: line.text }); };

  // A deleted public chat's bots forget it (botMemory.js); the surfaces' tests read no memory.
  const chats = createChatMembers({ records, notices, computer, systemContext, pauseWork, forget: async () => {} });
  const onboarding = createOnboarding({ records, chats, model, meter, notices, workspaces });
  const botList = createBotList({ records, apps, notices });
  const templates = createBotTemplates({ records, profiles, integrations, env: process.env, templateLinks, botList });
  const settings = createBotSettings({ records, computer, notices, tellHome: botList.tellHome, listedBot: botList.listedBot });
  const archive = createBotArchive({ records, apps, computer, pauseWork, tellHome: botList.tellHome, listedBot: botList.listedBot });
  const teams = createBotTeams({ records, botList, templates, onboarding, notices });
  const plans = createBotPlans({ records, workspaces, meter, write });
  const library = createBotLibrary({ records, apps, files });
  const routines = createChatRoutines({ records });
  const knowledge = createBotKnowledge({ records, files, meter, env: process.env, systemContext });
  return { ...parts, meter, records, calls, builder, chats, onboarding, botList, templates, settings, archive, teams, plans, library, routines, knowledge };
}

/**
 * A home of its own for the test: Anna its owner, Ben a member, and Carla, who isn't in it; removed when the test ends.
 * `as(name)` gives a person's call options there, an owner's with the settings permission.
 * @param {import("knex").Knex} knex
 * @param {{ after: (work: () => unknown) => void }} context
 */
export async function seedHome(knex, context, { name = "Rossi" } = {}) {
  const [anna, ben, carla] = (await knex("users").orderBy("id").limit(3).pluck("id")).map(String);
  assert.ok(carla, "the test database needs three users");
  const [row] = await knex("workspaces").insert({ slug: `surfaces-${randomBytes(5).toString("hex")}`, name, owner_user_id: anna, is_personal: false }).returning("id");
  const homeId = String(row.id);
  context.after(() => knex("workspaces").where({ id: homeId }).del());
  await knex("workspace_memberships").insert([
    { workspace_id: homeId, user_id: anna, role_sid: "owner", status: "active" },
    { workspace_id: homeId, user_id: ben, role_sid: "member", status: "active" }
  ]);
  const people = { anna, ben, carla };
  const as = (person) => memberOptions(person === "anna"
    ? { userId: anna, homeId, role: "owner", permissions: ["workspace.settings.update"] }
    : { userId: people[person], homeId });
  /** A bot of the home, made by `madeBy` (Anna unless said). */
  const bot = async (botName, columns = {}) => String((await knex("bots")
    .insert({ workspace_id: homeId, made_by: anna, name: botName, color: "#1E86FC", library_template: "general", ...columns })
    .returning("id"))[0].id);
  return { homeId, ...people, as, bot };
}
