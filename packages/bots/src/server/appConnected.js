import { z } from "zod";
import { buildAccountTools } from "./accountTools.js";
import { ACTIONS } from "./botActions.js";
import { turnPerson } from "./connectedApps.js";
import { buildConnectorTools } from "./connectorTools.js";
import { inTime } from "./botTools.js";

// Connected apps for apps' scripts (D-136): the very tools a bot uses, built for one person with no chat, so every rule
// they keep holds here too: the accounts the call's person reaches (D-111), Sedna only as their confirmed Sedna user
// (D-94), sign-in codes hidden from mailboxes not their own, the actions they switched off in Connect apps, each
// account's pace (D-96) and a test copy logging what it would change (D-69). Nothing reaches a chat: no status lines,
// no cards. A change is tried only when the person pressed the app's button (`mode: "button"`, the press is their asking
// for it), and then goes through their approval rules as a bot's does (approvals.decide): one the rules would ask about
// isn't made, but waits (`outcome.waiting`) for the person to confirm the question it asks, and runConfirmed makes it
// then. A job or a screen only reads (`mode: "read"`). The answers are the tools' own: data, with text from outside
// marked as information only.

/** What a script's connected-app call refused, in words for the app's people, with a code for the script. */
export class AppConnectedError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   */
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// The bots' actions that aren't for apps: a draft card in a chat for the person to send, a routine's own feed, and the
// ones that keep a copy among a bot's files or send one of them, which an app has none of.
const NOT_FOR_APPS = new Set([
  "show_draft",
  "send_draft",
  "sedna_draft",
  "sedna_inbox",
  "drive_read.download",
  "drive_read.export",
  "save_to_drive",
  "sedna_attachments.save",
  "sedna_attachments.save_all",
  "sedna_mail.attach"
]);

/** The action ids an app of the catalogue offers, each `tool` or `tool.action`. */
const actionIds = (entry) => (entry.actions || []).map((action) => action.id);

/** The tool an action id (`tool` or `tool.action`) belongs to. */
const toolOf = (actionId) => String(actionId).split(".")[0];

// A tool's inputs a script never gives: the chat's status line and approval words, and the action, named in its id.
const NOT_SCRIPT_INPUTS = new Set(["statusLine", "acknowledgement", "personAsked", "action"]);

/** A tool's inputs in one line for the Builder, "query?: string, to: string[]" (? when optional). */
function inputLine(tool) {
  const schema = tool.inputSchema ? z.toJSONSchema(tool.inputSchema) : {};
  const required = new Set(schema.required || []);
  const typeOf = (property) =>
    property.enum
      ? property.enum.map((value) => JSON.stringify(value)).join(" | ")
      : property.type === "array"
        ? `${property.items?.type || "any"}[]`
        : property.type || "any";
  return Object.entries(schema.properties || {})
    .filter(([name]) => !NOT_SCRIPT_INPUTS.has(name))
    .map(([name, property]) => `${name}${required.has(name) ? "" : "?"}: ${typeOf(property)}`)
    .join(", ");
}

/** Whether apps may use an action of an app: OneDrive's documents are Word files a bot's office makes. */
const forApps = (appId, actionId) =>
  !NOT_FOR_APPS.has(actionId) && !NOT_FOR_APPS.has(toolOf(actionId)) && !(appId === "onedrive" && actionId === "create_drive_document");

/**
 * @param {object} dependencies
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {{ findById: (userId: string, options: object) => Promise<{ email?: string } | null> }} dependencies.profiles
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("./types.js").BotRecords} dependencies.records
 * @param {import("@local/apps/server/types").Apps} dependencies.apps
 * @param {{ decide: (action: string, how: { reversible?: boolean }, options: object) => Promise<"ask" | "allow"> }}
 *   dependencies.approvals the person's approval rules (approvals.js), as a bot's changes go through them
 */
export function createAppConnected({ integrations, profiles, env, records, apps, approvals }) {
  /** Whether an app of the catalogue is one apps' scripts can use: it has actions for apps, or brings its own. */
  function usable(appId) {
    const entry = integrations.app(String(appId || ""));
    return Boolean(entry && (entry.mcp || actionIds(entry).some((id) => forApps(entry.id, id))));
  }

  /** The catalogue entry of an app a script names, by id; refused when it isn't one apps can use. */
  function appEntry(appId) {
    if (!usable(appId)) throw new AppConnectedError(`"${appId}" isn't one of the apps in Connect apps.`, "apps_connected_unknown");
    return integrations.app(String(appId));
  }

  /** The home's connected apps an app's scripts could be allowed, `{ id, name }`, for its owners and admins to choose. */
  async function choices(call) {
    const { connected } = await integrations.toolSwitches(call);
    return connected.filter(usable).map((id) => ({ id, name: integrations.appName(id) }));
  }

  /**
   * The tools of one person's call, kept to one app: they see that app's accounts only, so a call for Gmail never reads
   * or changes an Outlook mailbox, though both are mail. `mode` decides what a change does.
   */
  /** Integrations as the tools see them, kept to one app's accounts. */
  const oneAppOf = (appId) => Object.freeze({
    ...integrations,
    reachableAccounts(options, filters = {}) {
      const pluginIds = (filters.pluginIds || [appId]).filter((pluginId) => pluginId === appId);
      return pluginIds.length ? integrations.reachableAccounts(options, { ...filters, pluginIds }) : Promise.resolve([]);
    }
  });

  /** A change's context, as an approval card's gives it: the person's call, one app's accounts, no chat or files. */
  const changeContext = (call, appId) => ({
    call,
    env,
    integrations: oneAppOf(appId),
    apps,
    work: records.work,
    bots: records.bots,
    userId: turnPerson(call),
    files: null,
    place: null
  });

  async function toolsFor(call, appId, mode, outcome, known = null) {
    const switches = known || (await integrations.toolSwitches(call));
    const oneApp = oneAppOf(appId);
    const appFor = (toolId) => ({ integrations: oneApp, call, skip: switches.skip[toolId] || [] });
    // The tools' own record of what they tried (reads among them, as a bot's reply checks it), and the changes asked for.
    const attempted = [];
    const asked = [];
    // A change the tools asked for: refused unless the person pressed the button (run names the refusal, since the tools
    // turn what they throw into an answer); then made, or kept waiting when their approval rules would ask first.
    async function attempt(actionId, input) {
      attempted.push(actionId);
      asked.push(actionId);
      if (mode !== "button") throw new AppConnectedError("Refused: this call only reads.", "apps_connected_write_refused");
      const action = ACTIONS[actionId];
      const args = { ...input, personAsked: true };
      const decision = action.alwaysAsks ? "ask" : await approvals.decide(action.describe(args), { reversible: action.reversible(args) }, call);
      if (decision === "ask") {
        outcome.waiting.push({ actionId, args, question: action.question(args) });
        return { status: "waiting_for_approval", note: "Nothing has been done yet: the person is asked to confirm it." };
      }
      const { result } = await action.run(changeContext(call, appId), args);
      outcome.made.push(actionId);
      return { status: "done", ...(result ? { result } : {}) };
    }
    const quiet = async () => {};
    const tools = {
      ...buildAccountTools({
        profiles,
        turns: records.turns,
        call,
        integrations: oneApp,
        userId: turnPerson(call),
        conversationId: null,
        files: null,
        place: null,
        office: null,
        saved: new Set(),
        removed: switches.removed,
        connectedApps: switches.connected,
        appFor,
        attempt,
        attempted,
        postLead: quiet,
        inTime,
        untrusted: (text) => text,
        before: [],
        after: []
      }),
      ...buildConnectorTools({ integrations: oneApp, call, attempt, postLead: quiet })
    };
    return { tools: Object.values(tools), asked, connected: switches.connected };
  }

  /**
   * The actions a script may call in the apps it's allowed (`allowed`, plugin ids), for the call's person: the connected
   * ones only, each `{ app, action, name }`. A connector that brings its own actions lists them from the app.
   */
  async function actions(call, allowed) {
    const switches = await integrations.toolSwitches(call);
    const listed = [];
    for (const pluginId of allowed.filter((id) => switches.connected.includes(id))) {
      const entry = integrations.app(pluginId);
      if (!entry) continue;
      for (const action of entry.actions || []) {
        if (!forApps(pluginId, action.id) || (switches.skip[action.id] || []).includes(pluginId)) continue;
        listed.push({ app: pluginId, action: action.id, name: action.name });
      }
      if (entry.mcp) listed.push({ app: pluginId, action: "*", name: `${entry.name}'s own actions (connected.run with their names)` });
    }
    return listed;
  }

  /**
   * One action of a connected app, as the call's person: `{ app, action, input, account }`. Answers the tool's answer;
   * refusals throw AppConnectedError.
   * @param {object} call the person's call options (a member's, or the job's person's)
   * @param {{ app: string, action: string, input?: object, account?: string }} request
   * @param {"button" | "read"} mode
   * @param {{ made: string[], waiting: Array<{ actionId: string, args: object, question: string }> }} [outcome] gets the
   *   bots' action id of each change made, for the app's activity, and each change waiting for the person to confirm
   */
  async function run(call, { app, action, input = {}, account = "" }, mode, outcome = { made: [], waiting: [] }) {
    const entry = appEntry(app);
    const { tools, asked, connected } = await toolsFor(call, entry.id, mode, outcome);
    if (!connected.includes(entry.id)) {
      throw new AppConnectedError(`${entry.name} isn't connected for this person.`, "apps_connected_not_connected");
    }
    const byId = (id) => tools.find((tool) => tool.id === id);
    let tool;
    let args;
    if (entry.mcp && !actionIds(entry).includes(String(action))) {
      tool = byId("use_connected_app");
      args = { app: entry.name, action: String(action), input, account, personAsked: true };
    } else {
      const toolId = toolOf(action);
      if (!actionIds(entry).includes(String(action)) || !forApps(entry.id, String(action))) {
        throw new AppConnectedError(`${entry.name} has no action "${action}" that apps can use.`, "apps_connected_no_action");
      }
      tool = byId(toolId);
      const sub = String(action).includes(".") ? String(action).slice(toolId.length + 1) : null;
      args = { ...input, ...(sub ? { action: sub } : {}), ...(account ? { account } : {}) };
    }
    if (!tool) {
      throw new AppConnectedError(
        `${entry.name}'s ${action} is switched off for this person in Connect apps.`,
        "apps_connected_switched_off"
      );
    }
    const answer = await tool.execute(args, {});
    if (asked.length && mode !== "button") {
      throw new AppConnectedError(
        "Only a button someone presses can change anything in a connected app; a job or a screen only reads.",
        "apps_connected_write_refused"
      );
    }
    if (answer && typeof answer === "object" && "error" in answer) {
      throw new AppConnectedError(String(answer.error), "apps_connected_refused");
    }
    return answer;
  }

  /**
   * What the Builder writes scripts with (scriptWriter.js): the allowed apps connected for the call's person, each
   * action apps may use with its inputs, one line each. Switches are read once for every app.
   */
  async function guide(call, allowed) {
    const switches = await integrations.toolSwitches(call);
    const lines = [];
    for (const appId of allowed.filter((id) => id !== "ai" && switches.connected.includes(id) && usable(id))) {
      const entry = integrations.app(appId);
      const { tools } = await toolsFor(call, appId, "read", { made: [], waiting: [] }, switches);
      lines.push(`- ${appId} (${entry.name}):`);
      for (const action of entry.actions || []) {
        if (!forApps(appId, action.id) || (switches.skip[action.id] || []).includes(appId)) continue;
        const tool = tools.find((candidate) => candidate.id === toolOf(action.id));
        if (tool) lines.push(`  - ${action.id} (${action.name}): { ${inputLine(tool)} }`);
      }
      if (entry.mcp) lines.push(`  - its own actions: connected.actions() lists them; connected.run("${appId}", name, input)`);
    }
    return lines.join("\n");
  }

  /**
   * A change that waited (run's `outcome.waiting`), once the person confirmed it: made as them, in that app's account.
   * The waiting change is the server's own, kept for them; it must still be one of that app's.
   * @returns {Promise<string>} what was done, in words for them
   */
  async function runConfirmed(call, appId, { actionId, args }) {
    const entry = appEntry(appId);
    const action = Object.hasOwn(ACTIONS, actionId) ? ACTIONS[actionId] : null;
    const ofApp = actionId === "connected_app_change" ? args?.pluginId === entry.id : actionIds(entry).includes(actionId);
    if (!action || !ofApp) throw new AppConnectedError(`${entry.name} has no action "${actionId}" that apps can use.`, "apps_connected_no_action");
    const done = await action.run(changeContext(call, entry.id), args);
    return String(done?.body?.text || "Done.");
  }

  return Object.freeze({
    usable,
    choices,
    actions,
    guide,
    run,
    runConfirmed
  });
}
