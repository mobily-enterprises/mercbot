import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { GateError } from "./validate.js";

// Connected apps for scripts (D-136): `connected.actions()` and `connected.run(app, action, input, account)`, through the
// bots' own tools (mercbot.app-connected), as the person the run is for: the member who pressed the button or opened
// the screen, or the person a job runs as (who saved it or switched it on; none once they left the home). Only a
// button changes anything, through the person's approval rules as a bot's changes do: one the rules ask about is kept
// for them (app_connected_confirms) and the button shows its question; it is made once they confirm, within
// CONFIRM_MINUTES. A screen's data and a job only read, and a draft's preview pretends to change (D-71). The app's
// owners and admins choose which connected apps it may use (appConnectedAccess.js); a public app's visitors never reach
// any, and such an app is never public. Each change is in the app's activity, naming the person.
const MAX_BYTES = 1024 * 1024;
const CONFIRM_MINUTES = 15;

/** A refusal the script sees, in words for the app's people. */
export const refused = (message) => new Error(message);

/** The person of a call, as a job or a confirm keeps them: the member's, or the one a job's run is for. */
export const personOf = (call) => String(resolveAuditActorId(call?.context) ?? "");

/**
 * The call options of the person a run uses connected apps, bots or pictures (`what`) as: the member who pressed or
 * opened, or the job's person; refused for a public app's visitor and for a job whose person left the home.
 */
export function personCallFor(systemContext, ctx, script, what) {
  if (ctx.visitor) throw refused(`${what} are for the home's people: a public app's visitors can't use them`);
  if (script.kind !== "job") return ctx.options;
  if (!script.runsAsUserId) {
    throw refused(`this job has no person to use ${what} as (they left the home): switch it off and on again to run it as you`);
  }
  return { context: systemContext("a job uses connected apps, bots and pictures as its person").forWorkspace(script.workspaceId, { actorId: script.runsAsUserId }) };
}

/**
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
 *   AppsFeature's handles: apps and auditEvents.
 * @param {import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 * @param {() => import("./types.js").AppConnected} dependencies.connected read at call time
 */
export function createScriptConnected({ resources, systemContext, connected }) {
  const { apps: appRows, auditEvents, appConnectedConfirms } = resources;

  /** A change made in a connected app, in the app's activity: the script, the app, the action and the person. */
  const recordChange = (call, { actor, via }, app, action, made) => auditEvents.create(
    { actor, via, action: "connected", changes: { connected: { app, action, made, person: personOf(call) } } },
    { ...passedOn(call), returning: "none" }
  );

  /**
   * The host's `connected` calls for one run of `script` (its row: kind, workspaceId, runsAsUserId), at most
   * `limits.connected` of them.
   * @param {{ options: object, actor: object, via: { appId: string, script: string }, visitor?: object,
   *   practice?: { simulated: object[] }, confirms?: Array<{ id: string, question: string }> }} ctx `confirms` gets the
   *   changes waiting for the person, for the button to ask about
   * @param {{ connected: number }} limits
   * @param {{ kind: string, workspaceId: string, runsAsUserId?: string | null }} script
   */
  function forRun(ctx, limits, script) {
    let calls = 0;
    let allowed = null;
    /** The connected apps this app may use, read once a run. */
    const allowedApps = () => (allowed ||= appRows
      .get(ctx.via.appId, { fields: ["connectedAccess"] }, passedOn(ctx.options))
      .then((app) => (app.connectedAccess || []).filter((id) => id !== "ai")));

    const personCall = () => personCallFor(systemContext, ctx, script, "connected apps");

    return async (name, args) => {
      if ((calls += 1) > limits.connected) throw refused(`at most ${limits.connected} connected-app calls per run`);
      const call = personCall();
      const apps = await allowedApps();
      if (name === "actions") return connected().actions(call, apps);
      const [app, action, input = {}, account = ""] = args;
      if (!apps.includes(String(app))) {
        throw refused(`this app may not use ${app}: the home's owners and admins allow connected apps in the app's Scripts tab`);
      }
      const request = { app: String(app), action: String(action), input: input || {}, account: String(account || "") };
      const outcome = { made: [], waiting: [] };
      let answer;
      try {
        answer = await connected().run(call, request, script.kind === "action" && !ctx.practice ? "button" : "read", outcome);
      } catch (error) {
        // A draft's preview pretends a button's change, as its web calls do: nothing was changed.
        if (ctx.practice && script.kind === "action" && error.code === "apps_connected_write_refused") {
          ctx.practice.simulated.push({ connected: { app: request.app, action: request.action }, script: ctx.via.script });
          return { simulated: true };
        }
        throw error.code?.startsWith("apps_connected") ? refused(error.message) : error;
      }
      if (outcome.made.length) await recordChange(call, ctx, request.app, request.action, outcome.made);
      if (outcome.waiting.length) {
        if (!ctx.confirms) throw refused("this change needs its person to confirm it, which only a button on a screen can ask");
        for (const { actionId, args, question } of outcome.waiting) {
          const row = await appConnectedConfirms.create(
            { appId: ctx.via.appId, scriptKey: ctx.via.script, userId: personOf(call), pluginId: request.app, actionId, args, question },
            passedOn(call)
          );
          ctx.confirms.push({ id: String(row.id), question });
        }
      }
      if (Buffer.byteLength(JSON.stringify(answer ?? null)) > MAX_BYTES) {
        throw refused(`${request.app}'s answer is over 1 MB: ask for less (a narrower search, fewer items)`);
      }
      return answer;
    };
  }

  /**
   * The person confirmed a change their button kept waiting: taken once, theirs alone, while fresh, then made as them
   * and recorded. Answers what was done, in words for them.
   */
  async function confirm(appId, id, options) {
    const person = personOf(options);
    const cutoff = new Date(Date.now() - CONFIRM_MINUTES * 60 * 1000).toISOString();
    const taken = await appConnectedConfirms.patchWhere(
      { id: String(id), appId, userId: person, used: false, createdFrom: cutoff },
      { usedAt: new Date().toISOString() },
      { ...passedOn(options), returning: "count" }
    );
    if (taken !== 1) {
      throw new GateError(409, "That change isn't waiting for you any more: press the button again.", { code: "apps_connected_confirm_gone" });
    }
    const row = await appConnectedConfirms.get(String(id), {}, passedOn(options));
    let done;
    try {
      done = await connected().runConfirmed(options, row.pluginId, { actionId: row.actionId, args: row.args });
    } catch (error) {
      if (!error.code?.startsWith("apps_connected")) throw error;
      throw new GateError(422, error.message, { code: error.code });
    }
    const via = { kind: "script", appId, script: row.scriptKey, trigger: { kind: "confirm" } };
    await recordChange(options, { actor: { type: "person", id: person, name: "" }, via }, row.pluginId, row.actionId, [row.actionId]);
    return { done };
  }

  /** Clears the changes nobody confirmed in time, in every home (scripts.prune). */
  const prune = (options) =>
    appConnectedConfirms.deleteWhere({ createdBefore: new Date(Date.now() - CONFIRM_MINUTES * 60 * 1000).toISOString() }, options);

  return Object.freeze({
    forRun,
    confirm,
    prune
  });
}
