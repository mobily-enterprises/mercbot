import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createApprovals, matchRules } from "./approvals.js";
import { createBotLoops } from "./botLoops.js";
import { createBotsService } from "./botsService.js";
import { NO_TEMPLATE_LINKS } from "./botTemplates.js";
import { botsMeter, createChatModel } from "./model.js";
import { registerRoutes } from "./registerRoutes.js";
import { useAddedSkills } from "./skills.js";

// Bots, their conversations and their background work (D-8).
const BotsFeature = defineFeature({
  id: "mercbot.bots",
  domain: "bots",
  requires: {
    records: "mercbot.bots.records",
    // People's names and addresses, and the home's name, in what a bot is told.
    profiles: "users.profiles",
    workspaces: "workspaces",
    http: "runtime.http",
    fastify: "runtime.fastify",
    computer: "mercbot.computer",
    notices: "mercbot.notices",
    integrations: "mercbot.integrations",
    files: "mercbot.files",
    apps: "mercbot.apps",
    meter: "mercbot.meter",
    account: "mercbot.account",
    env: "runtime.env"
  },
  // The templates links open, beside Mercbot's own, and skills beside Mercbot's: a copy built on Mercbot may keep them
  // and add them (types.js TemplateLinks and AddedSkill).
  optional: {
    templateLinks: "mercbot.template-links",
    addedSkills: "mercbot.added-skills"
  },
  // Requests between bots, goal rounds, routines, Apps tasks and replies left part-way are claimed
  // across every home, then each runs as a job for its person in its own home.
  systemScope: "run the bots' queued work and resume their replies in every home",
  provides: {
    bots: "mercbot.bots",
    // Provided so the shutdown hook can drain the loops.
    botLoops: "mercbot.bot-loops"
  },
  /**
   * @param {object} capabilities
   * @param {import("./types.js").BotRecords} capabilities.records
   * @param {(reason: string) => object} capabilities.systemContext the bots' system context (systemScope)
   * @param {import("@jskit-ai/users-core/server/types").UserProfilesRepository} capabilities.profiles
   * @param {import("@jskit-ai/workspaces-core/server/types").WorkspacesRepository} capabilities.workspaces
   * @param {import("@local/account/server/types").Account} capabilities.account
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} capabilities.fastify
   * @param {import("@local/computer/server/types").Computer} capabilities.computer
   * @param {import("@local/notices/server/types").Notices} capabilities.notices
   * @param {import("@local/integrations/server/types").Integrations} capabilities.integrations
   * @param {import("@local/files/server/types").Files} capabilities.files
   * @param {import("@local/apps/server/types").Apps} capabilities.apps
   * @param {import("@local/account/server/types").Meter} capabilities.meter
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("./types.js").TemplateLinks | null} capabilities.templateLinks
   * @param {ReadonlyArray<import("./types.js").AddedSkill> | null} capabilities.addedSkills
   */
  async setup({
    records,
    systemContext,
    profiles,
    workspaces,
    account,
    http,
    fastify,
    computer,
    notices,
    integrations,
    files,
    apps,
    meter,
    env,
    templateLinks,
    addedSkills
  }) {
    useAddedSkills(addedSkills ?? []);
    const model = createChatModel(env);
    // A copy whose AI isn't set up starts no bot work, and each bot says why (botsMeter).
    const botMeter = botsMeter(meter, env);
    const approvals = createApprovals({ policies: records.policies, match: (rules, action) => matchRules(model, rules, action) });
    const bots = createBotsService({
      records,
      systemContext,
      profiles,
      workspaces,
      account,
      env,
      model,
      approvals,
      meter: botMeter,
      computer,
      notices,
      integrations,
      files,
      apps,
      templateLinks: templateLinks ?? NO_TEMPLATE_LINKS
    });
    const botLoops = createBotLoops({ records, systemContext, notices, files, apps, computer, bots });
    fastify.addHook("onListen", () => {
      botLoops.start();
    });
    // Shutting down (D-19): close live streams so pages reconnect elsewhere; the shutdown hook then
    // drains the loops before the bots' computers are put away.
    const streams = new Set();
    fastify.addHook("preClose", async () => {
      for (const stream of streams) stream.end();
    });
    registerRoutes(http, { bots, approvals, notices, meter: botMeter, records, streams });
    return { bots, botLoops };
  },
  async shutdown(_dependencies, { outputs }) {
    await outputs.botLoops.drain(20000);
  }
});

export { BotsFeature };
