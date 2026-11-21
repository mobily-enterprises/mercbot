// Someone who leaves a home, or is removed from it, takes the accounts they connected there with them (D-111): every
// account of a home is everyone's in it, so one whose person is gone would go on reading and sending as them. Each is
// withdrawn at its app and the hub, as its bin does, then deleted, and the home's Activity trail says so.

/**
 * The Activity trail's entry for an account taken away with its person, by Mercbot.
 * @param {{ pluginId: string, name: string, label: string | null }} account
 * @param {string} app the app's name
 * @param {string} person who connected it
 */
export function departedEntry(account, app, person) {
  return {
    actor: { type: "mercbot", name: "Mercbot" },
    via: { kind: "settings" },
    action: "settings",
    changes: { departedAccount: { app, account: account.label || account.name || "", person } }
  };
}

/**
 * @param {object} dependencies
 * @param {import("./types.js").Accounts} dependencies.accounts
 * @param {{ withdraw: (account: object, options: object) => Promise<void> }} dependencies.connections
 * @param {(homeId: string, options: object) => Promise<Array<string | number>>} dependencies.activeMemberIds
 * @param {(userIds: string[], options: object) => Promise<Map<string, string>>} dependencies.namesOf
 * @param {(pluginId: string) => string} dependencies.appName
 * @param {(entry: object, options: object) => Promise<void>} dependencies.recordActivity the home's Activity trail
 * @param {(reason: string) => object} dependencies.systemContext
 */
export function createDepartures({ accounts, connections, activeMemberIds, namesOf, appName, recordActivity, systemContext }) {
  /**
   * Withdraws and removes every account of the home that someone no longer in it added. Run whenever the home's people
   * change, it reads the home as it is, so a removal, a leave, or anything else that ends a membership is the same.
   * @param {string} homeId
   * @returns {Promise<string[]>} the ids of the accounts removed
   */
  async function withdrawDeparted(homeId) {
    const options = { context: systemContext("withdraw and remove the accounts someone no longer in a home connected there").forWorkspace(homeId) };
    const active = (await activeMemberIds(homeId, options)).map(String);
    const gone = await accounts.reachable(options, { filters: { userIdNot: active }, tokens: true });
    if (!gone.length) return [];
    const names = await namesOf([...new Set(gone.map((account) => account.userId))], options);
    for (const account of gone) {
      await connections.withdraw(account, options);
      await accounts.deleteAccount(account, options);
      await recordActivity(departedEntry(account, appName(account.pluginId), names.get(account.userId) || "Someone"), options);
    }
    return gone.map((account) => account.id);
  }

  return Object.freeze({ withdrawDeparted });
}
