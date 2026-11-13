import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { passedOn, resolveUserScopeValue } from "@jskit-ai/resource-runtime/server";
import { personName } from "@local/homes/server/personName";
import { IntegrationsError } from "./accounts.js";
import { resultText } from "./connector.js";

/**
 * The search entries plugin_actions_off's owns entry adds: the action a switch is for.
 */
export const ACTION_SWITCH_FILTERS = Object.freeze({
  actionId: { type: "string", actualField: "action_id", filterOperator: "=" }
});

/**
 * An account as Connect apps shows it; a home's says so and who added it (D-37).
 * @param {Record<string, any>} account a record of accounts.reachable, with its tokens
 * @param {Connections["lacksAccess"]} lacksAccess
 * @param {Map<string, string>} names who added each home's account
 */
function toAccount(account, lacksAccess, names) {
  return {
    id: account.id,
    name: account.name,
    // A sign-in started and not finished, or one that was cancelled or refused; or a
    // connected one whose app now asks for more than it was given (D-42).
    status: account.status === "needs-auth" && account.signInState ? account.signInState : lacksAccess(account) ? "more-access" : account.status,
    label: account.label || null,
    home: account.home,
    ...(account.home ? { addedBy: names.get(account.userId) || "" } : {})
  };
}

/**
 * A taught skill as the bots and Connect apps show it.
 * @param {Record<string, any>} record
 */
function toSkill(record) {
  return {
    id: String(record.id),
    name: record.name,
    description: record.description,
    instructions: record.instructions,
    updatedAt: new Date(record.updatedAt).toISOString()
  };
}

/** @typedef {ReturnType<typeof import("./connections.js").createConnections>} Connections */

/**
 * Connect apps (D-31, D-33, D-37): the catalogue with what each person added, their accounts and
 * the home's, the switches on each app's actions, and the skills bots learn. Its `connections`
 * sign accounts in and give bot tools a provider key (accessToken) when they call an app.
 *
 * Every method takes the call's options last: a request's (`request.callOptions()`), or a job's acting for
 * a person (`forWorkspace(home, { actorId })`). The person is the signed-in one, or the one the job
 * acts for.
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.resources this feature's handles
 * @param {import("./types.js").Accounts} dependencies.accounts
 * @param {import("./catalogue.js").Catalogue} dependencies.catalogue
 * @param {Connections} dependencies.connections
 * @param {import("@jskit-ai/users-core/server/types").UsersProfiles} dependencies.profiles users.profiles
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 */
export function createIntegrationsService({ resources, accounts, catalogue, connections, profiles, systemContext }) {
  const { userPlugins, userSkills, appInterest, pluginActionsOff } = resources;

  function plugin(pluginId) {
    const found = catalogue.find((entry) => entry.id === pluginId);
    if (!found) throw new IntegrationsError(404, "That app isn't in the catalogue.", { code: "integrations_app_not_found" });
    return found;
  }

  /**
   * The options for the person's own rows (added apps, wishes, switches, skills: `user` tables). A
   * request's are its own, and so are a job's already scoped to the person. A home's job acting for a
   * person reads and writes the person's rows, and only theirs, through a context for that person.
   */
  function own(options) {
    if (resolveActorId(options?.context)) return passedOn(options);
    const person = accounts.personOf(options);
    if (!person) throw new Error("integrations: a person's own apps and skills need a signed-in person or a job acting for one.");
    if (String(resolveUserScopeValue(options?.context) ?? "") === String(person)) return passedOn(options);
    return { ...passedOn(options), context: systemContext("read and change a person's own apps, switches and skills for a job acting for them").forUser(person) };
  }

  /**
   * People's names by id, for who added a home's account.
   * @param {Array<string | number>} userIds
   * @param {object} options
   * @returns {Promise<Map<string, string>>}
   */
  async function namesOf(userIds, options) {
    const found = await profiles.listByIds(userIds, passedOn(options));
    return new Map(found.map((user) => [String(user.id), personName(user)]));
  }

  /**
   * The coming-soon apps people want (D-33), each with how many people want it, most wanted first, then by name; an app
   * nobody wants isn't listed. It counts everyone's wishes: whoever shows it decides who sees it.
   * @param {object} options
   * @returns {Promise<Array<{ id: string, name: string, people: number }>>}
   */
  async function comingSoonWanted(options) {
    const rows = await appInterest.aggregate(
      { measures: { people: { count: "*" } }, groupBy: ["pluginId"] },
      { ...passedOn(options), context: systemContext("count how many people want each coming-soon app") }
    );
    const people = new Map(rows.map((row) => [row.pluginId, Number(row.people)]));
    return catalogue
      .filter((entry) => entry.soon && people.get(entry.id))
      .map((entry) => ({ id: entry.id, name: entry.name, people: people.get(entry.id) }))
      .sort((left, right) => right.people - left.people || left.name.localeCompare(right.name));
  }

  /**
   * The catalogue with each plugin's install state, and the accounts this person reaches: their
   * own and the home's (D-37).
   */
  async function list(reach, options) {
    const mine = own(options);
    const installed = new Set((await userPlugins.queryAll({ fields: ["pluginId"] }, mine)).map((record) => record.pluginId));
    const accountRows = await accounts.reachable(reach, options, { tokens: true });
    const names = await namesOf(accountRows.filter((row) => row.home).map((row) => row.userId), options);
    const skills = (await userSkills.queryAll({ sort: ["id"] }, mine)).map(toSkill);
    const wanted = new Set((await appInterest.queryAll({ fields: ["pluginId"] }, mine)).map((record) => record.pluginId));
    const off = await actionsOff(options);
    const listed = await connectorActionLists(options);
    return {
      plugins: catalogue.map((entry) => {
        const actions = actionsOf(entry, listed);
        return {
          ...entry,
          installed: installed.has(entry.id),
          accounts: accountRows.filter((row) => row.pluginId === entry.id).map((row) => toAccount(row, connections.lacksAccess, names)),
          // What the bot can do with the app, each with the person's switch.
          ...(actions ? { actions: actions.map((action) => ({ ...action, enabled: !off.get(entry.id)?.has(action.id) })) } : {}),
          ...(entry.soon ? { wanted: wanted.has(entry.id) } : {})
        };
      }),
      skills
    };
  }

  /**
   * The actions of the apps that host their own connection point (D-34), as each last listed them:
   * they come from the app, not from plugin.json, so none until someone has connected it.
   */
  function connectorActionLists(options) {
    return catalogue.some((entry) => entry.mcp) ? connections.storedConnectorActions(options) : new Map();
  }

  /** An app's actions, from plugin.json or as the app listed them; null for an app with none. */
  function actionsOf(entry, listed) {
    const actions = entry.mcp ? listed.get(entry.id) : entry.actions;
    return actions?.length ? actions : null;
  }

  /** Adding a plugin creates its default account, which still needs signing in. */
  async function install(reach, pluginId, options) {
    const entry = plugin(pluginId);
    // Not connectable yet: Add records that the person wants it (D-33).
    if (entry.soon) {
      await appInterest.createMany([{ pluginId: entry.id }], { ...own(options), onConflict: { keys: ["userId", "pluginId"], action: "ignore" } });
      return list(reach, options);
    }
    // Added once: a second Add at the same time loses the unique (user, app) race and finds the first.
    await retryLostInsertRace(options, () => userPlugins.withTransaction(passedOn(options), async (txOptions) => {
      const mine = own(txOptions);
      const [added] = await userPlugins.queryAll({ filters: { pluginId: entry.id }, fields: ["pluginId"] }, mine);
      if (added) return;
      await userPlugins.create({ pluginId: entry.id }, { ...mine, returning: "none" });
      // The first account has no label: it's shown by its address once signed in.
      await accounts.addPersonalAccount({ pluginId: entry.id, name: "" }, txOptions);
    }));
    return list(reach, options);
  }

  /** Removing an app removes the person's own accounts of it; the home's stay. */
  async function uninstall(reach, pluginId, options) {
    const entry = plugin(pluginId);
    await userPlugins.withTransaction(passedOn(options), async (txOptions) => {
      const person = accounts.personOf(txOptions);
      const ownAccounts = (await accounts.reachable({ personal: true }, txOptions, { filters: { pluginId: entry.id, userId: person } }))
        .filter((found) => !found.home);
      for (const found of ownAccounts) await accounts.deleteAccount(found, txOptions);
      await userPlugins.deleteWhere({ pluginId: entry.id }, own(txOptions));
    });
    return list(reach, options);
  }

  /**
   * Another account of the same app carries the label the person gives it, e.g. "work". The
   * home's owners and admins can add one for the whole home instead (D-37).
   */
  async function addAccount(reach, pluginId, label, { forHome = false } = {}, options) {
    const entry = plugin(pluginId);
    if (forHome && !accounts.managesHome(options)) {
      throw new IntegrationsError(403, "Only the home's owners and admins can add accounts for everyone.", {
        code: "integrations_home_account_forbidden"
      });
    }
    if (!forHome) {
      const { records: [added] } = await userPlugins.query({ filters: { pluginId: entry.id }, fields: ["pluginId"], page: { size: 1 } }, own(options));
      if (!added) throw new IntegrationsError(409, "Add the app first.", { code: "integrations_app_not_added" });
    }
    const name = String(label || "").trim().slice(0, 80);
    if (!name) {
      throw new IntegrationsError(400, "Give the account a label, such as work or family.", { code: "integrations_account_label_missing" });
    }
    const accountId = forHome
      ? await accounts.addHomeAccount({ pluginId: entry.id, name }, options)
      : await accounts.addPersonalAccount({ pluginId: entry.id, name }, options);
    return { ...await list(reach, options), accountId };
  }

  async function renameAccount(reach, accountId, name, options) {
    const clean = String(name || "").trim().slice(0, 80);
    if (!clean) throw new IntegrationsError(400, "Give the account a name.", { code: "integrations_account_name_missing" });
    const found = await accounts.manageableAccount(reach, accountId, options);
    await accounts.patchAccount(found, { name: clean }, options);
    return list(reach, options);
  }

  /**
   * A home's account is removed outright; a person's own is removed with Uninstall.
   * Removing an account: a home's at any time, by its owners and admins; a person's own
   * only while it isn't connected (a connected one is disconnected first) and while the app keeps
   * another account (the last one goes with Uninstall).
   */
  async function removeAccount(reach, accountId, options) {
    const found = await accounts.manageableAccount(reach, accountId, options);
    if (!found.home) {
      if (found.status === "connected") {
        throw new IntegrationsError(409, "Disconnect the account first.", { code: "integrations_account_still_connected" });
      }
      const sameApp = { filters: { pluginId: found.pluginId, userId: found.userId } };
      const others = (await accounts.reachable({ personal: true }, options, sameApp))
        .filter((other) => !other.home && other.id !== found.id);
      if (!others.length) {
        throw new IntegrationsError(409, "This is the app's only account: uninstall the app to remove it.", {
          code: "integrations_account_last"
        });
      }
    }
    await accounts.deleteAccount(found, options);
    return list(reach, options);
  }

  async function updateSkill(skillId, patch = {}, options) {
    const changes = {};
    if (patch.name !== undefined) {
      changes.name = String(patch.name).trim().slice(0, 80);
      if (!changes.name) throw new IntegrationsError(400, "A skill needs a name.", { code: "integrations_skill_name_missing" });
    }
    if (patch.description !== undefined) changes.description = String(patch.description).slice(0, 240);
    if (patch.instructions !== undefined) changes.instructions = String(patch.instructions).slice(0, 50000);
    const id = String(skillId ?? "");
    const mine = own(options);
    const record = !/^\d+$/u.test(id)
      ? null
      : Object.keys(changes).length
        ? await userSkills.patch(id, changes, { ...mine, missing: "skip" })
        : await userSkills.get(id, {}, { ...mine, missing: "skip" });
    if (!record) throw new IntegrationsError(404, "Skill not found.", { code: "integrations_skill_not_found" });
    return { skill: toSkill(record) };
  }

  async function deleteSkill(skillId, options) {
    const id = String(skillId ?? "");
    const deleted = /^\d+$/u.test(id) ? await userSkills.delete(id, { ...own(options), missing: "skip" }) : null;
    if (deleted == null) throw new IntegrationsError(404, "Skill not found.", { code: "integrations_skill_not_found" });
    return { deleted: id };
  }

  /** Bots save what they learn as private skills and read them when asked. */
  async function createSkill(input, options) {
    const record = await userSkills.create({
      name: String(input.name || "").trim().slice(0, 80) || "Taught task",
      description: String(input.description || "").slice(0, 240),
      instructions: String(input.instructions || "").slice(0, 50000)
    }, own(options));
    return toSkill(record);
  }

  async function skills(options) {
    return (await userSkills.queryAll({ sort: ["id"] }, own(options))).map(toSkill);
  }

  /**
   * The person's skills as a list of them shows them, `{ id, name, description }` in id order,
   * without their instructions (up to 50,000 characters each). `limit` keeps the first ones.
   * @param {object} options
   * @param {{ limit?: number }} [params]
   */
  async function skillNames(options, { limit = 0 } = {}) {
    const params = { sort: ["id"], fields: ["name", "description"] };
    const records = limit
      ? (await userSkills.query({ ...params, page: { size: limit } }, own(options))).records
      : await userSkills.queryAll(params, own(options));
    return records.map((record) => ({ id: String(record.id), name: record.name, description: record.description }));
  }

  /** The actions a person has turned off, by app. */
  async function actionsOff(options) {
    const records = await pluginActionsOff.queryAll({ fields: ["pluginId", "actionId"] }, own(options));
    const off = new Map();
    for (const record of records) off.set(record.pluginId, new Set([...(off.get(record.pluginId) || []), record.actionId]));
    return off;
  }

  async function switchAction(reach, pluginId, actionId, enabled, options) {
    const entry = plugin(pluginId);
    if (!actionsOf(entry, await connectorActionLists(options))?.some((action) => action.id === actionId)) {
      throw new IntegrationsError(404, "That app has no such action.", { code: "integrations_action_not_found" });
    }
    const mine = own(options);
    if (enabled) {
      await pluginActionsOff.deleteWhere({ pluginId: entry.id, actionId }, mine);
    } else {
      await pluginActionsOff.createMany([{ pluginId: entry.id, actionId }], {
        ...mine,
        onConflict: { keys: ["userId", "pluginId", "actionId"], action: "ignore" }
      });
    }
    return list(reach, options);
  }

  /**
   * What a person's bots may use: for each tool, the apps it's switched off for, the tools
   * to leave out altogether because every connected app that offers them has them off, and the
   * switched-off actions in words for the bot.
   */
  async function toolSwitches(reach, options) {
    const off = await actionsOff(options);
    const connected = new Set((await accounts.reachable(reach, options, { filters: { status: "connected" } })).map((found) => found.pluginId));
    const skip = {};
    const offered = new Map();
    const turnedOff = [];
    for (const entry of catalogue) {
      for (const action of entry.actions || []) {
        if (off.get(entry.id)?.has(action.id)) {
          skip[action.id] = [...(skip[action.id] || []), entry.id];
          if (connected.has(entry.id)) turnedOff.push(`${action.name} (${entry.name})`);
        }
        if (connected.has(entry.id)) offered.set(action.id, [...(offered.get(action.id) || []), entry.id]);
      }
    }
    const removed = [...offered].filter(([id, apps]) => apps.every((app) => skip[id]?.includes(app))).map(([id]) => id);
    return { skip, removed, turnedOff };
  }

  /** An app's catalogue entry (its name, logo, colour, sign-in and actions), or null; read from no table. */
  function app(id) {
    return catalogue.find((entry) => entry.id === id) || null;
  }

  /** An app's name, for things that list apps by id (the apps a bot's chat has connected). */
  function appName(id) {
    return app(id)?.name || id;
  }

  /** The app a bot names: by its id or its name, else the first whose name holds the words; or null. */
  function appNamed(wanted) {
    const name = String(wanted || "").trim().toLowerCase();
    return catalogue.find((entry) => entry.name.toLowerCase() === name || entry.id === name) ||
      catalogue.find((entry) => entry.name.toLowerCase().includes(name)) ||
      null;
  }

  /**
   * Whether the call reaches a connected account of the app that has all the access the app asks
   * for (one that needs more shows as "more-access" in Connect apps, D-42).
   * @param {{ personal?: boolean }} reach
   * @param {string} pluginId
   * @param {object} options
   */
  async function hasConnected(reach, pluginId, options) {
    const connected = await accounts.reachable(reach, options, { filters: { pluginId, status: "connected" }, tokens: true });
    return connected.some((row) => !connections.lacksAccess(row));
  }

  /**
   * The accounts the call reaches, in id order: `{ id, pluginId, name, label, status, signInState,
   * bridgeRef, userId, home }`, without tokens. The home's, and the person's own unless `personal`
   * is false (a shared bot's room). `filters` keeps only some, e.g. `{ status: "connected",
   * pluginIds: ["gmail", "outlook"] }`.
   * @param {{ personal?: boolean }} reach
   * @param {object} options
   * @param {{ status?: string, pluginIds?: string[] }} [filters]
   */
  function reachableAccounts(reach, options, filters = {}) {
    return accounts.reachable(reach, options, { filters });
  }

  /**
   * One account as Connect apps shows it, `{ account }`, for the screen waiting for its sign-in;
   * 404 integrations_account_not_found.
   */
  async function accountStatus(reach, accountId, options) {
    const found = await accounts.reachableAccount(reach, accountId, options, { tokens: true });
    const names = found.home ? await namesOf([found.userId], options) : new Map();
    return { account: toAccount(found, connections.lacksAccess, names) };
  }

  /** One account the call may use; 404 integrations_account_not_found. */
  function reachableAccount(reach, accountId, options) {
    return accounts.reachableAccount(reach, accountId, options);
  }

  /** One account the call may change; 403 integrations_account_manage_forbidden for a home's, unless they manage it. */
  function manageableAccount(reach, accountId, options) {
    return accounts.manageableAccount(reach, accountId, options);
  }

  /**
   * An app that hosts its own connection point (D-34), as a bot uses it through one of the call's
   * connected accounts: its actions as the app lists them, less the ones the person switched off in
   * Connect apps, which are named in `off`.
   * @returns {Promise<{ tools: object[], off: string[] }>}
   */
  async function connectorActions(reach, accountId, options) {
    const found = await accounts.reachableAccount(reach, accountId, options);
    const switchedOff = (await actionsOff(options)).get(found.pluginId) || new Set();
    const tools = await connections.connectorTools(reach, found.id, options);
    return {
      tools: tools.filter((tool) => !switchedOff.has(tool.name)),
      off: tools.filter((tool) => switchedOff.has(tool.name)).map((tool) => tool.title || tool.name)
    };
  }

  /**
   * Runs one of an app's actions through one of the call's accounts, unless the person switched it
   * off: what the app answered, as text, and whether it was an error the app reported.
   * @returns {Promise<{ text: string, isError: boolean }>}
   */
  async function useConnector(reach, accountId, name, input, options) {
    const found = await accounts.reachableAccount(reach, accountId, options);
    const entry = plugin(found.pluginId);
    if ((await actionsOff(options)).get(entry.id)?.has(name)) {
      throw new IntegrationsError(403, `The person has switched ${name} off for ${entry.name} in Connect apps.`, {
        code: "integrations_connector_action_off",
        params: { app: entry.name, action: name }
      });
    }
    const result = await connections.connectorCall(reach, found.id, name, input, options);
    return { text: resultText(result), isError: Boolean(result?.isError) };
  }

  return Object.freeze({
    app,
    appName,
    appNamed,
    hasConnected,
    switchAction,
    toolSwitches,
    list,
    comingSoonWanted,
    install,
    uninstall,
    addAccount,
    renameAccount,
    removeAccount,
    updateSkill,
    deleteSkill,
    createSkill,
    skills,
    skillNames,
    reachableAccounts,
    accountStatus,
    reachableAccount,
    manageableAccount,
    accountLabels: accounts.accountLabels,
    namesOf,
    connectors: Object.freeze({
      // The apps that host their own connection point (D-34), from the catalogue.
      apps: () => catalogue.filter((entry) => entry.mcp),
      actions: connectorActions,
      use: useConnector
    }),
    connections
  });
}
