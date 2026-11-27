import { resolveWorkspaceScopeValue } from "@jskit-ai/resource-runtime/server";
import { MAIL } from "./mailTools.js";
import { sendOrSimulate } from "./connectedApps.js";
import { AppConnectedError } from "./appConnected.js";

// What apps send without a button press (D-137): a notice to the home's members, as a message from the home's main bot
// in each one's own chat with it (unread for them, and on their devices as any message is), and an email from one of the
// home's connected mailboxes (Gmail or Outlook) that the app's owners and admins chose. The apps decide whether an app
// may send at all and count what it sends (appSending.js); here it is only made. A test or staging copy logs an email
// instead of sending it (D-69).

/**
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {(reason: string) => object} dependencies.systemContext the bots'
 */
export function createAppMessages({ records, integrations, env, systemContext }) {
  /** The home's connected mailboxes an app may send from, as its owners and admins choose one: { id, app, address }. */
  async function mailboxes(call) {
    const accounts = await integrations.reachableAccounts(call, { pluginIds: Object.keys(MAIL) });
    return accounts
      .filter((account) => account.status === "connected")
      .map((account) => ({ id: String(account.id), app: account.pluginId, address: account.label || account.name || "" }));
  }

  /** The home's members now, whom a notice may reach. */
  const members = (call) => records.chats.everyoneIn(call);

  /** The home's owners and admins, whom a notice "to owners" reaches. */
  const managers = (call) => records.chats.managersIn(call);

  /**
   * A notice to each of `userIds` (members of the call's home): the home's main bot says `text` in their chat with it,
   * made on first use. Answers how many it reached.
   */
  async function notifyMembers(call, { userIds, text }) {
    const home = resolveWorkspaceScopeValue(call?.context);
    const main = (await records.directory.homeBotFaces(call)).find((bot) => bot.main && !bot.archived);
    if (!main) throw new AppConnectedError("This home has no main bot to send the notice through.", "apps_notify_no_bot");
    for (const userId of userIds) {
      const asPerson = { context: systemContext("an app's notice to a member, from the home's main bot").forWorkspace(home, { actorId: String(userId) }) };
      const chat = await records.chats.direct(String(main.id), asPerson);
      await records.messages.append(String(chat.id), [{ kind: "text", role: "bot", authorBotId: String(main.id), body: { text } }], asPerson);
    }
    return userIds.length;
  }

  /** An email from the mailbox `account` (one of mailboxes'), to `to`: sent in a live copy, logged in a test copy. */
  async function sendEmail(call, { account, to, subject, text }) {
    const accounts = await integrations.reachableAccounts(call, { pluginIds: Object.keys(MAIL) });
    const entry = accounts.find((each) => String(each.id) === String(account));
    if (!entry || entry.status !== "connected") {
      throw new AppConnectedError("The mailbox chosen for this app isn't connected any more: an owner or admin chooses another in the app's Logic tab.", "apps_email_mailbox_gone");
    }
    const effect = { kind: "email", summary: `"${subject}" from ${entry.label} to ${to.join(", ")}`, details: { from: entry.label, to } };
    return sendOrSimulate({ env }, effect, async () => {
      const token = await integrations.connections.accessToken(entry.id, call);
      return MAIL[entry.pluginId].sendEmail({ token: token.accessToken, fetch: token.fetch }, { to, subject, text });
    });
  }

  return Object.freeze({
    mailboxes,
    members,
    managers,
    notifyMembers,
    sendEmail
  });
}
