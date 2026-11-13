import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { isSystemContext, passedOn, resolveWorkspaceScopeValue } from "@jskit-ai/resource-runtime/server";

// Whose connected accounts a call may reach (D-37). The person and the home come from the call's
// context: a request's signed-in person in the home its address names, or the person a job acts for
// (`forWorkspace(home, { actorId })`). A reach is { personal }: whether the person's own accounts may
// be used (not in a shared bot's room, which everyone sees). Changing a home's account takes the
// home's owners or admins (`workspace.settings.update`).

/** What a read answers; tokens only when this package's own sign-ins ask for them. */
const ACCOUNT_FIELDS = Object.freeze(["pluginId", "name", "label", "status", "signInState", "bridgeRef", "userId", "workspaceId"]);

export class IntegrationsError extends AppError {
  /**
   * @param {number} status The HTTP status the route answers with.
   * @param {string} message The sentence the person sees.
   * @param {{ code: string, params?: object }} options The refusal's own code, and the values its sentence names.
   */
  constructor(status, message, options) {
    super(status, message, options);
    this.name = "IntegrationsError";
  }
}

/**
 * The search entries plugin_accounts' owns entry adds (IntegrationsFeature.js). Whose own accounts a
 * call reaches is the row policy's (rowPolicies.js), for a request and for a job acting for someone.
 * - `homeOnly: true`: only the home's (a shared bot's room).
 * - `hasBridgeRef`, `hasLabel`, `statusNot`: accounts signed in through the hub, those with an
 *   address, and those not in a status.
 * - `pluginIds`: the accounts of any of these apps (a bot tool's apps: Gmail and Outlook for mail).
 */
export const ACCOUNT_FILTERS = Object.freeze({
  pluginIds: { type: "array", actualField: "pluginId", filterOperator: "in", items: { type: "string" } },
  homeOnly: {
    type: "boolean",
    applyFilter(query, _value, { column }) {
      query.whereNotNull(column("workspaceId"));
    }
  },
  hasBridgeRef: {
    type: "boolean",
    applyFilter(query, _value, { column }) {
      query.whereNotNull(column("bridgeRef"));
    }
  },
  hasLabel: {
    type: "boolean",
    applyFilter(query, _value, { column }) {
      query.whereNotNull(column("label"));
    }
  },
  statusNot: { type: "string", actualField: "status", filterOperator: "!=" }
});

/**
 * One plugin_accounts record as integrations' callers see it: `home` says it is a home's.
 * @param {Record<string, any>} record
 * @param {boolean} withTokens
 */
function toRecord(record, withTokens) {
  return {
    id: String(record.id),
    pluginId: record.pluginId,
    name: record.name,
    label: record.label ?? null,
    status: record.status,
    signInState: record.signInState ?? null,
    bridgeRef: record.bridgeRef ?? null,
    userId: String(record.userId),
    home: record.workspaceId != null,
    ...(withTokens ? { tokens: record.tokens ?? null } : {})
  };
}

/**
 * People's and homes' connected accounts, on the pluginAccounts handle. Every read is scoped to the
 * call's reach. A change of one account the call reached goes through `patchAccount` or
 * `deleteAccount`, and a system write names the account's owner, except the unlink sign-out, which
 * is every account of the deployment that borrowed the hub's sign-in. An account turning connected
 * (`signedIn`, `connectedThroughHub`) is saved with what waits for it elsewhere (`whenConnected`).
 * @param {object} dependencies
 * @param {object} dependencies.pluginAccounts the plugin_accounts handle
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 */
export function createAccounts({ pluginAccounts, systemContext }) {
  /** @type {Set<import("./types.js").ConnectedListener>} */
  const connectedListeners = new Set();

  /** The person the call is for: the signed-in person, or the one a job acts for. */
  function personOf(options) {
    return resolveAuditActorId(options?.context);
  }

  /** Whether the call's person may change the home's accounts, from the request's own permissions. */
  function managesHome(options) {
    return hasPermission(options?.context?.permissions || [], "workspace.settings.update");
  }

  /** A read's reach filters. Never a system context, which would reach every home's accounts. */
  function reachFilters({ personal = true } = {}, options) {
    if (isSystemContext(options?.context)) throw new Error("integrations: a reach needs a request's or a job's context, not a system one.");
    const person = personOf(options);
    return personal && person ? {} : { homeOnly: true };
  }

  /**
   * The accounts the call reaches, in id order: the home's, and the person's own unless `personal`
   * is false.
   * @param {{ personal?: boolean }} reach
   * @param {object} options
   * @param {{ filters?: object, tokens?: boolean }} [params]
   */
  async function reachable(reach, options, { filters = {}, tokens = false } = {}) {
    const records = await pluginAccounts.queryAll({
      filters: { ...filters, ...reachFilters(reach, options) },
      sort: ["id"],
      fields: tokens ? [...ACCOUNT_FIELDS, "tokens"] : ACCOUNT_FIELDS
    }, passedOn(options));
    return records.map((record) => toRecord(record, tokens));
  }

  /** One account the call may use, or 404 integrations_account_not_found. */
  async function reachableAccount(reach, accountId, options, { tokens = false } = {}) {
    const id = String(accountId ?? "");
    const [account] = /^\d+$/u.test(id) ? await reachable(reach, options, { filters: { id }, tokens }) : [];
    if (!account) throw new IntegrationsError(404, "Account not found.", { code: "integrations_account_not_found" });
    return account;
  }

  /** One account the call may change: a home's takes the home's owners or admins. */
  async function manageableAccount(reach, accountId, options, params = {}) {
    const account = await reachableAccount(reach, accountId, options, params);
    if (account.home && !managesHome(options)) {
      throw new IntegrationsError(403, "Only the home's owners and admins can change its accounts.", {
        code: "integrations_account_manage_forbidden"
      });
    }
    return account;
  }

  /**
   * A write of an account a scoped read answered. A home's account is written in the call's own
   * scope, by its id. A person's own account belongs to no home, and only a plain system context may
   * change such a shared row, so it is written there, naming its shared owner (workspaceId: null),
   * once the scoped read above found it the caller's. `options` may carry the call's transaction.
   * The one place a person's own account is changed.
   * @param {object} options
   */
  function personalWrite(options) {
    return { ...passedOn(options), context: systemContext("change a person's own account, which belongs to no home, once a scoped read found it theirs") };
  }

  /** @param {{ id: string, home: boolean }} account a record a scoped read answered */
  function patchAccount(account, changes, options) {
    if (account.home) return pluginAccounts.patch(account.id, changes, { ...passedOn(options), returning: "none" });
    return pluginAccounts.patchWhere({ id: [String(account.id)], workspaceId: null }, changes, { ...personalWrite(options), returning: "none" });
  }

  /**
   * Runs `work(locked, txOptions)` with the account's row locked until it ends, `locked` as the lock read it (with its
   * tokens), or null once it's gone: two servers renewing one account's key wait for each other (D-15). A person's own
   * account is locked where it is written (personalWrite). The work runs once, as it calls the app; patchAccount with
   * `txOptions` writes inside it.
   * @param {{ id: string, home: boolean }} account a record a scoped read answered
   * @template T
   * @param {object} options
   * @param {(locked: ReturnType<typeof toRecord> | null, txOptions: object) => Promise<T>} work
   * @returns {Promise<T>}
   */
  function withLockedAccount(account, options, work) {
    return pluginAccounts.withTransaction({ ...passedOn(options), retry: false }, async (txOptions) => {
      const scope = account.home ? txOptions : personalWrite(txOptions);
      const locked = await pluginAccounts.lock(account.id, { ...scope, missing: "skip", fields: [...ACCOUNT_FIELDS, "tokens"] });
      return work(locked ? toRecord(locked, true) : null, txOptions);
    });
  }

  /** @param {{ id: string, home: boolean }} account a record a scoped read answered */
  function deleteAccount(account, options) {
    if (account.home) return pluginAccounts.delete(account.id, passedOn(options));
    return pluginAccounts.deleteWhere({ id: [String(account.id)], workspaceId: null }, { ...personalWrite(options), returning: "none" });
  }

  /**
   * The call's person's own account, of no home: created in a plain system context, which
   * alone may leave the home empty, and only ever for the person the call is for.
   * @param {{ pluginId: string, name: string, label?: string | null }} fields
   * @param {object} options
   * @returns {Promise<string>} its id
   */
  async function addPersonalAccount(fields, options) {
    const person = personOf(options);
    if (!person) throw new Error("integrations: a personal account is added for the call's own person, and this call has none.");
    const id = await pluginAccounts.create(
      { ...fields, userId: String(person), workspaceId: null },
      { ...passedOn(options), context: systemContext("add a person's own account, which belongs to no home"), returning: "id" }
    );
    return String(id);
  }

  /** The home's account, added in the call's home by its person. */
  async function addHomeAccount(fields, options) {
    const id = await pluginAccounts.create({ ...fields, userId: String(personOf(options)) }, { ...passedOn(options), returning: "id" });
    return String(id);
  }

  /**
   * The labels (addresses) of every account the call's person added, in every home, as today: a bot
   * never saves which mailbox to use to the memory all the person's bots share (memoryTools.js). Only
   * the person's own rows are read.
   * @param {object} options
   * @returns {Promise<string[]>}
   */
  async function accountLabels(options) {
    const person = personOf(options);
    if (!person) return [];
    const records = await pluginAccounts.queryAll(
      { filters: { userId: String(person), hasLabel: true }, sort: ["id"], fields: ["label"] },
      { ...passedOn(options), context: systemContext("read the addresses of a person's own accounts in every home, to keep them out of shared memory") }
    );
    return records.map((record) => record.label);
  }

  /** Signs out every account that borrowed the hub's sign-in, in every home, as this copy unlinks. */
  function signOutBridged(options) {
    return pluginAccounts.patchWhere(
      { hasBridgeRef: true },
      { bridgeRef: null, status: "needs-auth", label: null },
      {
        ...passedOn(options),
        context: systemContext("sign out every account that borrowed the hub's sign-in when this copy unlinks from it"),
        returning: "none"
      }
    );
  }

  /**
   * The provider's callback has no one signed in: the unguessable state it carries names the
   * account, and is the proof. Its reads and writes of that one account run in this context.
   */
  function signInOptions(options) {
    return { ...passedOn(options), context: systemContext("finish a sign-in a provider sent back, for the one account its unguessable state names") };
  }

  /** The account a sign-in's state names, for the callback: `{ id, pluginId, status, userId, workspaceId }` or null. */
  async function signingIn(accountId, options) {
    const fields = ["pluginId", "status", "userId", "workspaceId"];
    const record = await pluginAccounts.get(String(accountId), { fields }, { ...signInOptions(options), missing: "skip" });
    if (!record) return null;
    return {
      id: String(record.id),
      pluginId: record.pluginId,
      status: record.status,
      userId: String(record.userId),
      workspaceId: record.workspaceId == null ? null : String(record.workspaceId)
    };
  }

  /**
   * Work elsewhere that waits for accounts to connect (the bots' connect follow-ups, D-77): `listener` is told of each
   * account that turns connected, inside the transaction that saves it, on whichever server the sign-in finishes, and
   * may answer what to do once that has committed. Answers how to stop listening.
   * @param {import("./types.js").ConnectedListener} listener
   */
  function whenConnected(listener) {
    connectedListeners.add(listener);
    return () => connectedListeners.delete(listener);
  }

  /**
   * Saves an account as connected with what waits for it: `save(txOptions)` writes it and answers whose it is (null
   * once it's gone), and each listener is told in the same transaction, so a listener that fails rolls the account
   * back with it. What the listeners answer runs once it has committed.
   * @param {object} options
   * @param {(txOptions: object) => Promise<import("./types.js").Connection | null>} save
   */
  async function savedConnected(options, save) {
    const after = await pluginAccounts.withTransaction(passedOn(options), async (txOptions) => {
      const connection = await save(txOptions);
      const then = [];
      if (connection) for (const listener of connectedListeners) then.push(await listener(connection, txOptions));
      return then;
    });
    for (const work of after) {
      if (typeof work !== "function") continue;
      await work().catch((error) => console.warn(`What waited for a connection failed once it was saved: ${error?.message || error}`));
    }
  }

  /**
   * The callback's write of the account its state names, connected with `changes`, naming the account's owner: its
   * home, or none for a person's own.
   */
  function signedIn(accountId, changes, options) {
    return savedConnected(options, async (txOptions) => {
      const account = await signingIn(accountId, txOptions);
      if (!account) return null;
      await pluginAccounts.patchWhere({ id: [account.id], workspaceId: account.workspaceId }, changes, { ...signInOptions(txOptions), returning: "none" });
      return { pluginId: account.pluginId, userId: account.userId, homeId: account.workspaceId };
    });
  }

  /**
   * A sign-in through the hub found finished (syncPending): the account a scoped read answered, connected with
   * `changes`. That read was in the call's home, so a home's account is that home's.
   * @param {{ id: string, home: boolean, pluginId: string, userId: string }} account
   */
  function connectedThroughHub(account, changes, options) {
    return savedConnected(options, async (txOptions) => {
      await patchAccount(account, changes, txOptions);
      const homeId = account.home ? String(resolveWorkspaceScopeValue(options?.context)) : null;
      return { pluginId: account.pluginId, userId: account.userId, homeId };
    });
  }

  /** A cancelled or refused sign-in marks the account, unless it is connected. */
  async function signInFailed(accountId, options) {
    const account = await signingIn(accountId, options);
    if (!account) return;
    await pluginAccounts.patchWhere(
      { id: [account.id], workspaceId: account.workspaceId, statusNot: "connected" },
      { signInState: "failed" },
      { ...signInOptions(options), returning: "none" }
    );
  }

  return Object.freeze({
    signingIn,
    signedIn,
    connectedThroughHub,
    whenConnected,
    signInFailed,
    personOf,
    managesHome,
    reachable,
    reachableAccount,
    manageableAccount,
    patchAccount,
    withLockedAccount,
    deleteAccount,
    addPersonalAccount,
    addHomeAccount,
    accountLabels,
    signOutBridged
  });
}
