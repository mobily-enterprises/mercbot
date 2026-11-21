import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { isSystemContext, passedOn, resolveWorkspaceScopeValue } from "@jskit-ai/resource-runtime/server";

// The connected accounts a call reaches (D-111): every account of the call's home, for everyone in it and their bots,
// in any chat. The person and the home come from the call's context: a request's signed-in person in the home its
// address names, or the person a job acts for (`forWorkspace(home, { actorId })`). The person who added an account and
// the home's owners and admins (`workspace.settings.update`) change it: rename it, sign it in again, choose its pace and
// remove it.

/** What a read answers; tokens only when this package's own sign-ins ask for them. */
const ACCOUNT_FIELDS = Object.freeze(["pluginId", "name", "label", "status", "signInState", "bridgeRef", "pace", "userId", "workspaceId"]);

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
 * The search entries plugin_accounts' owns entry adds (IntegrationsFeature.js).
 * - `hasBridgeRef`, `hasLabel`, `statusNot`: accounts signed in through the hub, those with an
 *   address, and those not in a status.
 * - `pluginIds`: the accounts of any of these apps (a bot tool's apps: Gmail and Outlook for mail).
 * - `userIdNot`: the accounts someone other than this person added.
 */
export const ACCOUNT_FILTERS = Object.freeze({
  pluginIds: { type: "array", actualField: "pluginId", filterOperator: "in", items: { type: "string" } },
  userIdNot: {
    type: "array",
    items: { type: "id" },
    applyFilter(query, value, { column }) {
      query.whereNotIn(column("userId"), value);
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
 * One plugin_accounts record as integrations' callers see it; `userId` is who added it.
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
    pace: record.pace ?? null,
    userId: String(record.userId),
    ...(withTokens ? { tokens: record.tokens ?? null } : {})
  };
}

/**
 * Homes' connected accounts, on the pluginAccounts handle. Every read is scoped to the call's home. A
 * change of one account the call reached goes through `patchAccount` or `deleteAccount`, and a system
 * write names the account's home, except the unlink sign-out, which is every account of the deployment
 * that borrowed the hub's sign-in. An account turning connected
 * (`signedIn`, `connectedHere`) is saved with what waits for it elsewhere (`whenConnected`).
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

  /**
   * The accounts the call's home holds, in id order. Never in a system context, which would reach every home's.
   * @param {object} options
   * @param {{ filters?: object, tokens?: boolean }} [params]
   */
  async function reachable(options, { filters = {}, tokens = false } = {}) {
    if (isSystemContext(options?.context)) throw new Error("integrations: accounts are read in a request's or a job's context in a home, not a system one.");
    const records = await pluginAccounts.queryAll({
      filters,
      sort: ["id"],
      fields: tokens ? [...ACCOUNT_FIELDS, "tokens"] : ACCOUNT_FIELDS
    }, passedOn(options));
    return records.map((record) => toRecord(record, tokens));
  }

  /** One account the call may use, or 404 integrations_account_not_found. */
  async function reachableAccount(accountId, options, { tokens = false } = {}) {
    const id = String(accountId ?? "");
    const [account] = /^\d+$/u.test(id) ? await reachable(options, { filters: { id }, tokens }) : [];
    if (!account) throw new IntegrationsError(404, "Account not found.", { code: "integrations_account_not_found" });
    return account;
  }

  /** Whether the call's person may change the account: the person who added it, or one of the home's owners or admins. */
  function mayChange(account, options) {
    return account.userId === String(personOf(options) ?? "") || managesHome(options);
  }

  /** One account the call may change (mayChange), or 403 integrations_account_manage_forbidden. */
  async function manageableAccount(accountId, options, params = {}) {
    const account = await reachableAccount(accountId, options, params);
    if (!mayChange(account, options)) {
      throw new IntegrationsError(403, "Only the person who added this account and the home's owners and admins can change it.", {
        code: "integrations_account_manage_forbidden"
      });
    }
    return account;
  }

  /**
   * A write of an account a scoped read answered, in the call's own scope, by its id. `options` may carry the call's
   * transaction.
   * @param {{ id: string }} account
   */
  function patchAccount(account, changes, options) {
    return pluginAccounts.patch(account.id, changes, { ...passedOn(options), returning: "none" });
  }

  /**
   * Runs `work(locked, txOptions)` with the account's row locked until it ends, `locked` as the lock read it (with its
   * tokens), or null once it's gone: two servers renewing one account's key wait for each other (D-15). The work runs
   * once, as it calls the app; patchAccount with `txOptions` writes inside it.
   * @param {{ id: string }} account a record a scoped read answered
   * @template T
   * @param {object} options
   * @param {(locked: ReturnType<typeof toRecord> | null, txOptions: object) => Promise<T>} work
   * @returns {Promise<T>}
   */
  function withLockedAccount(account, options, work) {
    return pluginAccounts.withTransaction({ ...passedOn(options), retry: false }, async (txOptions) => {
      const locked = await pluginAccounts.lock(account.id, { ...txOptions, missing: "skip", fields: [...ACCOUNT_FIELDS, "tokens"] });
      return work(locked ? toRecord(locked, true) : null, txOptions);
    });
  }

  /** @param {{ id: string }} account a record a scoped read answered */
  function deleteAccount(account, options) {
    return pluginAccounts.delete(account.id, passedOn(options));
  }

  /** An account of the call's home, added by the call's person. */
  async function addAccount(fields, options) {
    const id = await pluginAccounts.create({ ...fields, userId: String(personOf(options)) }, { ...passedOn(options), returning: "id" });
    return String(id);
  }

  /**
   * The labels (addresses) of every account the call's person added, in every home: a bot
   * never saves which mailbox to use to the memory all the person's bots share (memoryTools.js). Only
   * the rows they added are read.
   * @param {object} options
   * @returns {Promise<string[]>}
   */
  async function accountLabels(options) {
    const person = personOf(options);
    if (!person) return [];
    const records = await pluginAccounts.queryAll(
      { filters: { userId: String(person), hasLabel: true }, sort: ["id"], fields: ["label"] },
      { ...passedOn(options), context: systemContext("read the addresses of the accounts a person added in every home, to keep them out of shared memory") }
    );
    return records.map((record) => record.label);
  }

  /**
   * Every account a person added, in every home, for whoever runs the copy: what each is,
   * where it is and whether it is connected, never its keys. Read in this feature's own system context, which reaches
   * every home.
   * @param {string | number} userId
   * @param {object} [options] the call's transaction, if any
   */
  async function addedBy(userId, options = {}) {
    const records = await pluginAccounts.queryAll(
      { filters: { userId: String(userId) }, sort: ["id"], fields: [...ACCOUNT_FIELDS, "connectedAt"] },
      { ...passedOn(options), context: systemContext("list every account a person added, in every home, for whoever runs the copy") }
    );
    return records.map((record) => {
      const { signInState: _state, bridgeRef: _bridge, ...shown } = toRecord(record, false);
      return { ...shown, workspaceId: String(record.workspaceId), connectedAt: record.connectedAt ?? null };
    });
  }

  /** The options of a read or change of any account by its id, in any home, for whoever runs the copy. */
  function anywhere(options = {}) {
    return { ...passedOn(options), context: systemContext("read and disconnect any account by its id, in any home, for whoever runs the copy") };
  }

  /**
   * One account by its id, in any home, with its keys, for whoever runs the copy: null when there is none.
   * @param {string | number} accountId
   * @param {object} [options] the call's transaction, if any
   */
  async function anyAccount(accountId, options = {}) {
    const id = String(accountId ?? "");
    if (!/^\d+$/u.test(id)) return null;
    const record = await pluginAccounts.get(id, { fields: [...ACCOUNT_FIELDS, "tokens"] }, { ...anywhere(options), missing: "skip" });
    return record ? { ...toRecord(record, true), workspaceId: String(record.workspaceId) } : null;
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

  /** The account a sign-in's state names, for the callback: `{ id, pluginId, status, label, userId, workspaceId }` or null. */
  async function signingIn(accountId, options) {
    const fields = ["pluginId", "status", "label", "userId", "workspaceId"];
    const record = await pluginAccounts.get(String(accountId), { fields }, { ...signInOptions(options), missing: "skip" });
    if (!record) return null;
    return {
      id: String(record.id),
      pluginId: record.pluginId,
      status: record.status,
      label: record.label ?? null,
      userId: String(record.userId),
      workspaceId: String(record.workspaceId)
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
   * The callback's write of the account its state names, connected with `changes`, naming the account's home.
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
   * An account a scoped read answered, connected with `changes`: a sign-in through the hub found finished
   * (syncPending), or API credentials an owner or admin entered and the app took (D-93), sealed in `changes`. That read
   * was in the call's home, so the account is that home's.
   * @param {{ id: string, pluginId: string, userId: string }} account
   */
  function connectedHere(account, changes, options) {
    return savedConnected(options, async (txOptions) => {
      await patchAccount(account, changes, txOptions);
      return { pluginId: account.pluginId, userId: account.userId, homeId: String(resolveWorkspaceScopeValue(options?.context)) };
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
    connectedHere,
    whenConnected,
    signInFailed,
    personOf,
    managesHome,
    mayChange,
    reachable,
    reachableAccount,
    manageableAccount,
    patchAccount,
    withLockedAccount,
    deleteAccount,
    addAccount,
    accountLabels,
    addedBy,
    anywhere,
    anyAccount,
    signOutBridged
  });
}
