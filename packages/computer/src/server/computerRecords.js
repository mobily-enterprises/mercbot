import { randomBytes } from "node:crypto";
import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";

// The bot computers' rows (D-15): which server runs each computer and its state (bot_computers),
// the servers and when each was last seen (mercbot_servers), the servers' shared secret
// (mercbot_settings) and one-time screen tickets (computer_tickets). Computers run on no request
// and pass between servers, so every read and write here is in the computer feature's system
// context, by the conversation's id; a computer's rows are created in its conversation's home.
// The database's clock (now()) decides which servers are alive, as every server reads it.

const ALIVE_SECONDS = 45;
const SERVER_DAYS = 1;
const TICKET_SECONDS = 30;

/** The search entries the owns entries of bot_computers, mercbot_servers and computer_tickets add. */
export const BOT_COMPUTER_FILTERS = Object.freeze({
  serverId: { type: "string", actualField: "server_id", filterOperator: "=" },
  awake: {
    type: "boolean",
    applyFilter(query, _value, { column }) {
      query.whereRaw("?? <> 'asleep'", [column("state")]);
    }
  }
});
export const SERVER_FILTERS = Object.freeze({
  seenWithinSeconds: {
    type: "integer",
    applyFilter(query, seconds, { column }) {
      query.whereRaw("?? > now() - make_interval(secs => ?)", [column("seenAt"), Number(seconds)]);
    }
  },
  unseenForSeconds: {
    type: "integer",
    applyFilter(query, seconds, { column }) {
      query.whereRaw("?? < now() - make_interval(secs => ?)", [column("seenAt"), Number(seconds)]);
    }
  }
});
export const TICKET_FILTERS = Object.freeze({
  expiredBy: { type: "dateTime", actualField: "expires_at", filterOperator: "<" }
});

/**
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.resources the computer feature's handles
 * @param {() => { context: object }} dependencies.system the computer feature's system context, as call options
 * @param {(computerId: string, options: object) => Promise<string | null>} dependencies.homeOf the conversation's home
 */
export function createComputerRecords({ resources, system, homeOf }) {
  const { botComputers, botBrowserState, computerTickets, mercbotServers, mercbotSettings } = resources;

  /** The secret every server signs its calls to another with, made once (D-15). */
  async function sharedSecret() {
    const record = await mercbotSettings.findOrCreate({ id: "internal_secret", value: randomBytes(32).toString("hex") }, system());
    return record.value;
  }

  /** This server is alive at its address: seen now, by the database's clock. */
  async function seen(serverId, url) {
    const options = system();
    const changed = await mercbotServers.patchWhere({ id: serverId }, { url, seenAt: mercbotServers.raw("now()") }, { ...options, returning: "count" });
    if (!changed) {
      // The first heartbeat: the next one sets the database's own time.
      await mercbotServers.createMany([{ id: serverId, url, seenAt: new Date().toISOString() }], { ...options, onConflict: { keys: ["id"], action: "ignore" } });
    }
  }

  /** Servers not seen for a day are forgotten. */
  function forgetOldServers() {
    return mercbotServers.deleteWhere({ unseenForSeconds: SERVER_DAYS * 86400 }, system());
  }

  function forgetServer(serverId) {
    return mercbotServers.delete(String(serverId), { ...system(), missing: "skip" });
  }

  /** The home's computers that aren't asleep, on any server. */
  async function awakeInHome(workspaceId) {
    const found = await botComputers.queryAll({ filters: { workspaceId: String(workspaceId), awake: true }, fields: ["id"] }, system());
    return found.map((computer) => String(computer.id));
  }

  /** A server's computers after it restarted: all asleep, in every home. */
  function putToSleep(serverId) {
    return botComputers.patchWhere({ serverId }, { state: "asleep", url: "" }, { ...system(), returning: "none" });
  }

  /**
   * The computer's row, locked, then changed by `work(current, txOptions)`; a missing row is
   * created in the conversation's home first when `create` gives its fields.
   * A missing row is created under retryLostInsertRace, so two first uses at once make it once.
   */
  function withComputer(computerId, work) {
    const options = system();
    return retryLostInsertRace(options, () => botComputers.withTransaction(options, async (txOptions) => {
      const current = await botComputers.lock(computerId, { ...txOptions, missing: "skip", fields: ["serverId"] });
      return work(current, txOptions);
    }));
  }

  async function createComputer(computerId, fields, txOptions) {
    const workspaceId = await homeOf(computerId, txOptions);
    if (!workspaceId) return false;
    await botComputers.create({ id: computerId, workspaceId, ...fields }, { ...txOptions, returning: "none" });
    return true;
  }

  /**
   * Only the server holding a computer records its state; one that lost it to another server
   * can't take it back.
   */
  function recordState(computerId, serverId, { state, url, error }) {
    return withComputer(String(computerId), async (current, txOptions) => {
      if (!current) return createComputer(String(computerId), { serverId, state, url, error }, txOptions);
      if (current.serverId !== serverId) return false;
      await botComputers.patch(String(computerId), { state, url, error }, { ...txOptions, returning: "none" });
      return true;
    });
  }

  /** Whether the server was seen in the last 45 seconds, and its address. */
  async function liveServer(serverId, options = system()) {
    const [server] = await mercbotServers.queryAll(
      { filters: { id: String(serverId), seenWithinSeconds: ALIVE_SECONDS }, fields: ["url"] },
      options
    );
    return server ? { id: String(server.id), url: server.url } : null;
  }

  /**
   * The servers seen in the last 45 seconds, each with how many computers it holds that aren't asleep, for a
   * placement to choose from (D-85).
   * @returns {Promise<Array<{ id: string, awake: number }>>}
   */
  async function liveServers() {
    const servers = await mercbotServers.queryAll({ filters: { seenWithinSeconds: ALIVE_SECONDS }, fields: ["id"] }, system());
    const counts = await botComputers.aggregate(
      { measures: { awake: { count: "id" } }, groupBy: ["serverId"], filters: { awake: true } },
      system()
    );
    const awake = new Map(counts.map((row) => [String(row.serverId), Number(row.awake) || 0]));
    return servers.map((server) => ({ id: String(server.id), awake: awake.get(String(server.id)) ?? 0 }));
  }

  /** Take the computer for the server given unless a live server already has it. */
  function claim(computerId, serverId) {
    return withComputer(String(computerId), async (current, txOptions) => {
      if (!current) return createComputer(String(computerId), { serverId }, txOptions);
      if (current.serverId !== serverId && await liveServer(current.serverId, txOptions)) return false;
      await botComputers.patch(String(computerId), { serverId }, { ...txOptions, returning: "none" });
      return true;
    });
  }

  /** The computer's row, if the server holding it is alive: `{ serverId, serverUrl, state, url, error }`. */
  async function owner(computerId) {
    const found = await botComputers.get(String(computerId), { fields: ["serverId", "state", "url", "error"] }, { ...system(), missing: "skip" });
    const server = found ? await liveServer(found.serverId) : null;
    return server ? { serverId: found.serverId, serverUrl: server.url, state: found.state, url: found.url, error: found.error } : null;
  }

  /** A one-time ticket for the computer's screen, valid for 30 seconds; expired ones go first. */
  async function issueTicket(computerId, ticket) {
    const workspaceId = await homeOf(String(computerId), system());
    if (!workspaceId) throw new Error("This computer's conversation is gone.");
    await computerTickets.deleteWhere({ expiredBy: new Date().toISOString() }, system());
    await computerTickets.create(
      {
        id: ticket,
        conversationId: String(computerId),
        workspaceId,
        expiresAt: new Date(Date.now() + TICKET_SECONDS * 1000).toISOString()
      },
      { ...system(), returning: "none" }
    );
  }

  /** The computer a live ticket is for, or null. */
  async function ticketFor(ticket) {
    const found = await computerTickets.get(String(ticket || ""), { fields: ["conversationId", "expiresAt"] }, { ...system(), missing: "skip" });
    return found && new Date(found.expiresAt) > new Date() ? { ticket: String(found.id), computerId: String(found.conversationId) } : null;
  }

  /** Uses a ticket up: true once, for whoever deleted it. */
  async function useTicket(ticket) {
    return (await computerTickets.delete(String(ticket), { ...system(), missing: "skip" })) != null;
  }

  /**
   * The computer's saved browser record, changed by `changes`, and the one it replaced:
   * `{ before, saved }`, or null when the conversation is gone.
   * It answers the record it replaced, which an upsert cannot, so the row is read first and a
   * missing one created under retryLostInsertRace.
   */
  function saveBrowser(computerId, changes) {
    const options = system();
    const id = String(computerId);
    return retryLostInsertRace(options, () => botBrowserState.withTransaction(options, async (txOptions) => {
      const before = await botBrowserState.lock(id, { ...txOptions, missing: "skip", fields: ["profileFile"] });
      if (before) return { before, saved: await botBrowserState.patch(id, changes, txOptions) };
      const workspaceId = await homeOf(id, txOptions);
      return workspaceId ? { before: null, saved: await botBrowserState.create({ id, workspaceId, ...changes }, txOptions) } : null;
    }));
  }

  function savedBrowser(computerId) {
    return botBrowserState.get(String(computerId), {}, { ...system(), missing: "skip" });
  }

  function forgetBrowser(computerId) {
    return botBrowserState.delete(String(computerId), { ...system(), missing: "skip" });
  }

  return Object.freeze({
    sharedSecret,
    seen,
    forgetOldServers,
    forgetServer,
    awakeInHome,
    putToSleep,
    recordState,
    liveServers,
    claim,
    owner,
    issueTicket,
    ticketFor,
    useTicket,
    saveBrowser,
    savedBrowser,
    forgetBrowser
  });
}
