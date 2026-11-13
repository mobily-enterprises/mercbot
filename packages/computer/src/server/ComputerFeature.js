import { defineFeature } from "@jskit-ai/kernel/server/features";
import { BOT_COMPUTER_FILTERS, SERVER_FILTERS, TICKET_FILTERS } from "./computerRecords.js";
import { createComputers, PLACE_HERE } from "./computers.js";
import { registerRoutes } from "./registerRoutes.js";
import { attachVncBridge } from "./vncBridge.js";
import {
  botBrowserStateResource,
  botComputerResource,
  computerTicketResource,
  mercbotServerResource,
  mercbotSettingResource
} from "./tableResources.js";

/** The tables the computer feature owns, with their search entries. */
export const COMPUTER_OWNS = Object.freeze([
  { resource: botComputerResource, searchSchema: BOT_COMPUTER_FILTERS },
  botBrowserStateResource,
  { resource: computerTicketResource, searchSchema: TICKET_FILTERS },
  { resource: mercbotServerResource, searchSchema: SERVER_FILTERS },
  mercbotSettingResource
]);

/**
 * Serves `computers`' screens and browsers through `fastify`'s own server (D-68) and puts them away as it closes (D-19).
 * Live screens and `streams` end first, so pages reconnect to another server. Every computer here is then put away,
 * its browser saved, before the server waits for its connections to end: Puppeteer and Stagehand reach each browser
 * through this same server, so it can't close while a computer is awake, and a put-away left until it had closed never
 * came.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} fastify
 * @param {import("./types.js").Computer} computers
 * @param {Set<import("node:http").ServerResponse>} streams The computers' live status streams.
 */
export function serveComputers(fastify, computers, streams) {
  const closeScreens = attachVncBridge(fastify.server, computers);
  const closeBrowsers = computers.attachBrowserBridge(fastify.server);
  fastify.addHook("preClose", async () => {
    closeScreens();
    for (const stream of streams) stream.end();
    await computers.shutdown();
    closeBrowsers();
  });
}

// Each bot's computer, on whichever server runs it (D-15), with its routes and live screens. A computer runs on the
// server that needs it, unless a feature says where computers run (`mercbot.computer-placement`, D-85).
const ComputerFeature = defineFeature({
  id: "mercbot.computer",
  domain: "computer",
  owns: COMPUTER_OWNS,
  systemScope:
    "run bot computers on whichever server holds them: their state, saved browsers and screen tickets, by conversation, for every home, with no request",
  requires: {
    records: "mercbot.bots.records",
    http: "runtime.http",
    fastify: "runtime.fastify",
    notices: "mercbot.notices",
    files: "mercbot.files",
    meter: "mercbot.meter",
    env: "runtime.env"
  },
  optional: {
    placement: "mercbot.computer-placement"
  },
  provides: {
    computer: "mercbot.computer"
  },
  /**
   * @param {object} capabilities
   * @param {{ directory: object }} capabilities.records mercbot.bots.records
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} capabilities.fastify
   * @param {import("@local/notices/server/types").Notices} capabilities.notices
   * @param {import("@local/files/server/types").Files} capabilities.files
   * @param {import("@local/account/server/types").Meter} capabilities.meter
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("./types.js").ComputerPlacement | null} capabilities.placement where computers run, when a copy
   *   built on Mercbot says; else `PLACE_HERE`
   * @param {Record<string, any>} capabilities.resources this feature's handles
   * @param {(reason: string) => object} capabilities.systemContext
   */
  async setup({ records, http, fastify, notices, files, meter, env, placement, resources, systemContext }) {
    const computers = createComputers({
      resources, systemContext, directory: records.directory, env, notices, files, meter, placement: placement ?? PLACE_HERE
    });
    fastify.addHook("onListen", () => {
      computers.register(fastify.server.address()).catch((error) => {
        fastify.log.error({ err: error }, "This server couldn't register for bot computers.");
      });
    });
    // A move of a home's files puts its computers to sleep first, as they write to its folders (D-80).
    files.moves.whenStarting((homeId) => computers.sleepHome(homeId));
    const streams = new Set();
    serveComputers(fastify, computers, streams);
    const computer = Object.freeze({
      register: computers.register,
      answer: computers.answer,
      status: computers.status,
      subscribe: computers.subscribe,
      issueTicket: computers.issueTicket,
      findScreen: computers.findScreen,
      screenshotData: computers.screenshotData,
      sweepFiles: computers.sweepFiles,
      wake: computers.wake,
      sleep: computers.sleep,
      reset: computers.reset,
      browse: computers.browse,
      act: computers.act,
      fill: computers.fill,
      screenshot: computers.screenshot,
      hold: computers.hold,
      open: computers.open,
      startRecording: computers.startRecording,
      stopRecording: computers.stopRecording,
      code: computers.code,
      onCodingEnd: computers.onCodingEnd
    });
    registerRoutes(http, { computer, files, directory: records.directory, streams, meter });
    return { computer };
  }
});

export { ComputerFeature };
