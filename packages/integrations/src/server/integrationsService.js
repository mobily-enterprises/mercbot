import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { passedOn, resolveUserScopeValue, resolveWorkspaceScopeValue } from "@jskit-ai/resource-runtime/server";
import { personName } from "@local/homes/server/personName";
import { IntegrationsError } from "./accounts.js";
import { PACES, paceOf } from "./appRequests.js";
import { resultText } from "./connector.js";

/**
 * The search entries plugin_actions_off's owns entry adds: the action a switch is for.
 */
export const ACTION_SWITCH_FILTERS = Object.freeze({
  actionId: { type: "string", actualField: "action_id", filterOperator: "=" }
});

/**
 * An account as Connect apps shows it (D-111): who added it, and whether the call's person may change it (the person
 * who added it, and the home's owners and admins).
 * @param {Record<string, any>} account a record of accounts.reachable, with its tokens
 * @param {Connections["lacksAccess"]} lacksAccess
 * @param {Map<string, string>} names who added each account
 * @param {object} options the call's
 * @param {import("./types.js").Accounts} accounts
 */
function toAccount(account, lacksAccess, names, options, accounts) {
  return {
    id: account.id,
    name: account.name,
    // A sign-in started and not finished, or one that was cancelled or refused; or a
    // connected one whose app now asks for more than it was given (D-42).
    status: account.status === "needs-auth" && account.signInState ? account.signInState : lacksAccess(account) ? "more-access" : account.status,
    label: account.label || null,
    addedBy: names.get(account.userId) || "",
    addedByYou: account.userId === String(accounts.personOf(options) ?? ""),
    canChange: accounts.mayChange(account, options),
    // Its Request pace (D-96): the one chosen in Connect apps, or Gentle.
    pace: paceOf(account)
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
 * Connect apps (D-31, D-33, D-111): the catalogue with the apps on the home's list and the home's
 * accounts, each person's switches on each app's actions, and the skills bots learn. Its `connections`
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
  const { homePlugins, userSkills, appInterest, pluginActionsOff } = resources;

  function plugin(pluginId) {
    const found = catalogue.find((entry) => entry.id === pluginId);
    if (!found) throw new IntegrationsError(404, "That app isn't in the catalogue.", { code: "integrations_app_not_found" });
    return found;
  }

  /**
   * The options for the person's own rows (wishes, and their skills in this home: `user` and `workspace_user` tables).
   * A request's are its own, and so are a job's already scoped to the person. A home's job acting for a person reads and
   * writes the person's rows in that home, and only theirs, through a context for that person there.
   */
  function own(options) {
    if (resolveActorId(options?.context)) return passedOn(options);
    const person = accounts.personOf(options);
    if (!person) throw new Error("integrations: a person's own apps and skills need a signed-in person or a job acting for one.");
    if (String(resolveUserScopeValue(options?.context) ?? "") === String(person)) return passedOn(options);
    const home = resolveWorkspaceScopeValue(options?.context);
    if (!home) throw new Error("integrations: a person's own skills are theirs in a home: the job needs its home.");
    return {
      ...passedOn(options),
      context: systemContext("read and change a person's own wishes and skills in a home for a job acting for them")
        .forWorkspaceUser(String(home), String(person), { actorId: String(person) })
    };
  }

  /**
   * People's names by id, for who added each account.
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
   * The catalogue with each plugin's place on the home's list (`installed`, and `canRemove`: whether the call's person
   * may take it off, mayRemoveApp) and the home's accounts (D-111).
   */
  async function list(options) {
    const mine = own(options);
    const marks = new Map((await homePlugins.queryAll({ fields: ["pluginId", "userId"] }, passedOn(options))).map((record) => [record.pluginId, record]));
    const accountRows = await accounts.reachable(options, { tokens: true });
    const names = await namesOf([...new Set(accountRows.map((row) => row.userId))], options);
    const skills = (await userSkills.queryAll({ sort: ["id"] }, mine)).map(toSkill);
    const wanted = new Set((await appInterest.queryAll({ fields: ["pluginId"] }, mine)).map((record) => record.pluginId));
    const off = await actionsOff(options);
    const listed = await connectorActionLists(options);
    return {
      plugins: catalogue.map((entry) => {
        const actions = actionsOf(entry, listed);
        const appAccounts = accountRows.filter((row) => row.pluginId === entry.id);
        return {
          ...entry,
          installed: marks.has(entry.id),
          canRemove: marks.has(entry.id) && mayRemoveApp(marks.get(entry.id), appAccounts, options),
          accounts: appAccounts.map((row) => toAccount(row, connections.lacksAccess, names, options, accounts)),
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

  /** Puts the app on the home's list, once, as added by the call's person; a second add at the same moment finds the first. */
  function addToHome(entry, options) {
    const person = accounts.personOf(options);
    return homePlugins.createMany([{ pluginId: entry.id, userId: person ? String(person) : null }], {
      ...passedOn(options),
      onConflict: { keys: ["workspaceId", "pluginId"], action: "ignore" }
    });
  }

  /**
   * Whether the call's person may take the app off the home's list, with all its accounts (D-111): the home's owners and
   * admins, and the person who added it while every account of it in the home is one they added.
   * @param {{ userId?: string | null } | undefined} mark the app's home_plugins record
   * @param {Array<{ userId: string }>} appAccounts the home's accounts of the app
   */
  function mayRemoveApp(mark, appAccounts, options) {
    if (accounts.managesHome(options)) return true;
    const person = String(accounts.personOf(options) ?? "");
    return Boolean(person) && String(mark?.userId ?? "") === person && appAccounts.every((found) => found.userId === person);
  }

  /** An app whose API credentials are the whole home's (D-93) is its owners' and admins' to connect. */
  const homeAppForbidden = (entry) =>
    new IntegrationsError(403, `Only the home's owners and admins can connect ${entry.name}: its API credentials are the whole home's.`, {
      code: "integrations_home_app_forbidden",
      params: { app: entry.name }
    });

  /**
   * Adding a plugin puts it on the home's list, for anyone in the home. An app people sign in to gets its accounts from
   * the Add account step (addAccount, D-110), never an unnamed one of its own; an app whose API credentials are the
   * home's makes the home's one.
   */
  async function install(pluginId, options) {
    const entry = plugin(pluginId);
    // Not connectable yet: Add records that the person wants it (D-33).
    if (entry.soon) {
      await appInterest.createMany([{ pluginId: entry.id }], { ...own(options), onConflict: { keys: ["userId", "pluginId"], action: "ignore" } });
      return list(options);
    }
    if (entry.credentials?.home) return installForHome(entry, options);
    await addToHome(entry, options);
    return list(options);
  }

  /**
   * An app whose API credentials are the whole home's (D-93), such as an organisation's: only the home's owners and
   * admins add it, and adding it makes the home's account, which still needs its credentials, unless the home has one.
   */
  async function installForHome(entry, options) {
    if (!accounts.managesHome(options)) throw homeAppForbidden(entry);
    await retryLostInsertRace(options, () => homePlugins.withTransaction(passedOn(options), async (txOptions) => {
      await addToHome(entry, txOptions);
      const [account] = await accounts.reachable(txOptions, { filters: { pluginId: entry.id } });
      if (!account) await accounts.addAccount({ pluginId: entry.id, name: "" }, txOptions);
    }));
    return list(options);
  }

  /**
   * Remove from this home (D-111): the app leaves the home's list with every account of it in the home, each sign-in
   * withdrawn first. Who may: mayRemoveApp, else 403 integrations_home_app_remove_forbidden.
   */
  async function uninstall(pluginId, options) {
    const entry = plugin(pluginId);
    const appAccounts = await accounts.reachable(options, { filters: { pluginId: entry.id }, tokens: true });
    const [mark] = await homePlugins.queryAll({ filters: { pluginId: entry.id }, fields: ["userId"] }, passedOn(options));
    if (!mayRemoveApp(mark, appAccounts, options)) {
      throw new IntegrationsError(403, `Only the home's owners and admins can remove ${entry.name} from the home while it has accounts someone else added.`, {
        code: "integrations_home_app_remove_forbidden",
        params: { app: entry.name }
      });
    }
    for (const found of appAccounts) await connections.withdraw(found, options);
    await homePlugins.withTransaction(passedOn(options), async (txOptions) => {
      for (const found of appAccounts) await accounts.deleteAccount(found, txOptions);
      await homePlugins.deleteWhere({ pluginId: entry.id }, passedOn(txOptions));
    });
    return list(options);
  }

  /**
   * The Add account step (D-110): an account of the home's, added by the call's person, with the label they give it
   * (e.g. "work"), or none, when the list shows it by its address once signed in; the app goes on the home's list too.
   * Anyone in the home adds one, except of an app whose API credentials are the home's: its owners and admins. That app
   * keeps one unlabelled account a home (D-94), so another needs a label.
   */
  async function addAccount(pluginId, label, options) {
    const entry = plugin(pluginId);
    if (entry.credentials?.home && !accounts.managesHome(options)) throw homeAppForbidden(entry);
    const name = String(label || "").trim().slice(0, 80);
    if (!name && entry.credentials?.home) {
      const found = await accounts.reachable(options, { filters: { pluginId: entry.id } });
      if (found.some((account) => !account.name)) {
        throw new IntegrationsError(400, "Give the account a label, such as work or family.", { code: "integrations_account_label_missing" });
      }
    }
    await addToHome(entry, options);
    const accountId = await accounts.addAccount({ pluginId: entry.id, name }, options);
    return { ...await list(options), accountId };
  }

  async function renameAccount(accountId, name, options) {
    const clean = String(name || "").trim().slice(0, 80);
    if (!clean) throw new IntegrationsError(400, "Give the account a name.", { code: "integrations_account_name_missing" });
    const found = await accounts.manageableAccount(accountId, options);
    await accounts.patchAccount(found, { name: clean }, options);
    return list(options);
  }

  /**
   * Chooses an account's Request pace (D-96): how fast Mercbot sends its app requests, as a share of the app's own limit.
   * Who may change the account may choose it: the person who added it, and the home's owners and admins.
   * @param {string} accountId
   * @param {unknown} pace "gentle", "normal" or "fast"
   * @param {object} options
   */
  async function choosePace(accountId, pace, options) {
    const found = await accounts.manageableAccount(accountId, options);
    const chosen = String(pace ?? "");
    if (!Object.hasOwn(PACES, chosen)) {
      throw new IntegrationsError(400, "Choose Gentle, Normal or Fast.", { code: "integrations_account_pace_unknown" });
    }
    await accounts.patchAccount(found, { pace: chosen }, options);
    return list(options);
  }

  /**
   * Removing an account (the bin on its line, D-110), connected or not, the only one or not: its sign-in is withdrawn at
   * the app and the hub, then it is deleted with its keys. The person who added it, or the home's owners and admins. The
   * app stays on the home's list.
   */
  async function removeAccount(accountId, options) {
    const found = await accounts.manageableAccount(accountId, options, { tokens: true });
    await connections.withdraw(found, options);
    await accounts.deleteAccount(found, options);
    return list(options);
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

  /** The actions the home has turned off, by app (D-112: the home's, as its accounts are). */
  async function actionsOff(options) {
    const records = await pluginActionsOff.queryAll({ fields: ["pluginId", "actionId"] }, passedOn(options));
    const off = new Map();
    for (const record of records) off.set(record.pluginId, new Set([...(off.get(record.pluginId) || []), record.actionId]));
    return off;
  }

  /**
   * An action switched off or on for the whole home: its owners' and admins' to change, since it holds for everyone's
   * bots in every chat (403 otherwise).
   */
  async function switchAction(pluginId, actionId, enabled, options) {
    if (!accounts.managesHome(options)) {
      throw new IntegrationsError(403, "Only the home's owners and admins can switch an app's actions on or off.", { code: "integrations_actions_forbidden" });
    }
    const entry = plugin(pluginId);
    if (!actionsOf(entry, await connectorActionLists(options))?.some((action) => action.id === actionId)) {
      throw new IntegrationsError(404, "That app has no such action.", { code: "integrations_action_not_found" });
    }
    const home = passedOn(options);
    if (enabled) {
      await pluginActionsOff.deleteWhere({ pluginId: entry.id, actionId }, home);
    } else {
      await pluginActionsOff.createMany([{ pluginId: entry.id, actionId }], {
        ...home,
        onConflict: { keys: ["workspaceId", "pluginId", "actionId"], action: "ignore" }
      });
    }
    return list(options);
  }

  /**
   * What the home's bots may use: for each tool, the apps it's switched off for, the tools
   * to leave out altogether because every connected app that offers them has them off, and the
   * switched-off actions in words for the bot.
   */
  async function toolSwitches(options) {
    const off = await actionsOff(options);
    const connected = new Set((await accounts.reachable(options, { filters: { status: "connected" } })).map((found) => found.pluginId));
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
    return { skip, removed, turnedOff, connected: [...connected] };
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
   * @param {string} pluginId
   * @param {object} options
   */
  async function hasConnected(pluginId, options) {
    const connected = await accounts.reachable(options, { filters: { pluginId, status: "connected" }, tokens: true });
    return connected.some((row) => !connections.lacksAccess(row));
  }

  /**
   * The home's accounts, in id order: `{ id, pluginId, name, label, status, signInState, bridgeRef, pace, userId }`
   * (userId: who added it), without tokens. `filters` keeps only some, e.g. `{ status: "connected", pluginIds:
   * ["gmail", "outlook"] }`.
   * @param {object} options
   * @param {{ status?: string, pluginIds?: string[] }} [filters]
   */
  function reachableAccounts(options, filters = {}) {
    return accounts.reachable(options, { filters });
  }

  /**
   * One account as Connect apps shows it, `{ account }`, for the screen waiting for its sign-in;
   * 404 integrations_account_not_found.
   */
  async function accountStatus(accountId, options) {
    const found = await accounts.reachableAccount(accountId, options, { tokens: true });
    return { account: toAccount(found, connections.lacksAccess, await namesOf([found.userId], options), options, accounts) };
  }

  /** One account the call may use; 404 integrations_account_not_found. */
  function reachableAccount(accountId, options) {
    return accounts.reachableAccount(accountId, options);
  }

  /** One account the call may change; 403 integrations_account_manage_forbidden unless they added it or manage the home. */
  function manageableAccount(accountId, options) {
    return accounts.manageableAccount(accountId, options);
  }

  /**
   * An app that hosts its own connection point (D-34), as a bot uses it through one of the call's
   * connected accounts: its actions as the app lists them, less the ones the person switched off in
   * Connect apps, which are named in `off`.
   * @returns {Promise<{ tools: object[], off: string[] }>}
   */
  async function connectorActions(accountId, options) {
    const found = await accounts.reachableAccount(accountId, options);
    const switchedOff = (await actionsOff(options)).get(found.pluginId) || new Set();
    const tools = await connections.connectorTools(found.id, options);
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
  async function useConnector(accountId, name, input, options) {
    const found = await accounts.reachableAccount(accountId, options);
    const entry = plugin(found.pluginId);
    if ((await actionsOff(options)).get(entry.id)?.has(name)) {
      throw new IntegrationsError(403, `The person has switched ${name} off for ${entry.name} in Connect apps.`, {
        code: "integrations_connector_action_off",
        params: { app: entry.name, action: name }
      });
    }
    const result = await connections.connectorCall(found.id, name, input, options);
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
    choosePace,
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
    // For whoever runs the copy: every account a person added, in every home, and disconnecting any by its id.
    acrossHomes: Object.freeze({
      accountsOf: accounts.addedBy,
      disconnect: connections.disconnectAnywhere
    }),
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
