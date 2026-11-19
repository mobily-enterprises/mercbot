import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { ConnectionError } from "./oauth.js";

// Who each of a home's people is at an app connected with the home's API credentials (D-93), such as Sedna, whose one
// key reads, and later acts for, the whole organisation. A person is only ever themselves there: the user with their
// sign-in address (JSKIT confirms an address before it is a person's), or, when no user has it, the user they picked as
// themselves once an owner or admin of the home confirmed it (an owner's or admin's own pick is confirmed at once: they
// hold the organisation's credentials anyway). Nobody is confirmed as a user another person of the home has by address,
// nor as one already confirmed for someone else; a person found neither way is no one there, and their bots read nothing.
// Picks are kept in plugin_account_people, each for the organisation the credentials were for (`org`).

const LINK_FIELDS = ["id", "accountId", "userId", "org", "appUserId", "appUserName", "status"];

/**
 * @param {object} dependencies
 * @param {object} dependencies.accounts accounts.js
 * @param {object} dependencies.links the plugin_account_people handle, kept to the call's home
 * @param {(account: object) => object} dependencies.kindOf the account's kind of credentials (credentials.js)
 * @param {(account: object, options: object) => Promise<{ access: string, values: object }>} dependencies.keyFor a key
 *   for the account's credentials, and the credentials
 * @param {(options: object) => Promise<Array<{ id: string, name: string, email: string }>>} dependencies.homePeople
 * @param {(userId: string, options: object) => Promise<string>} dependencies.emailOf a person's sign-in address
 * @param {(email: string, options: object) => Promise<string | null>} dependencies.memberWithEmail the id of the home's
 *   person who signs in with an address, or null
 */
export function createAppPeople({ accounts, links, kindOf, keyFor, homePeople, emailOf, memberWithEmail }) {
  const me = (options) => String(accounts.personOf(options) || "");

  /** A home's account connected with API credentials, its kind, a key, and the organisation it is for. */
  async function connected(account, options) {
    const kind = kindOf(account);
    if (!account.home) {
      throw new ConnectionError(409, `${kind.name}'s credentials are the whole home's: add its account for everyone in the home.`, {
        code: "integrations_credentials_home_only",
        params: { app: kind.name }
      });
    }
    const { access, values } = await keyFor(account, options);
    return { account, kind, access, values, org: kind.org(values) };
  }

  const reached = async (reach, accountId, options) =>
    connected(await accounts.reachableAccount(reach, accountId, options, { tokens: true }), options);
  const managed = async (reach, accountId, options) =>
    connected(await accounts.manageableAccount(reach, accountId, options, { tokens: true }), options);

  /** The account's picks for its organisation, `filters` narrowing them. */
  const linksOf = ({ account, org }, options, filters = {}) =>
    links.queryAll({ filters: { accountId: String(account.id), org, ...filters }, sort: ["id"], fields: LINK_FIELDS }, passedOn(options));

  /**
   * Who `userId` is at the app: `{ person, via }` with `via` "picked" or "email", or `person` null with what is known:
   * `asked`, the user they picked and wait to have confirmed; `gone`, a confirmed user the app no longer has; `taken`,
   * the user their address finds, already confirmed for someone else.
   */
  async function whoIs(app, userId, options) {
    const { kind, values, access } = app;
    // A call without a person is no one anywhere.
    if (!userId) return { person: null, asked: null };
    const [link] = await linksOf(app, options, { userId });
    if (link?.status === "confirmed") {
      const person = await kind.personById({ values, access, id: link.appUserId });
      return person ? { person, via: "picked" } : { person: null, gone: link.appUserName };
    }
    const found = await kind.person({ values, access, address: await emailOf(userId, options) });
    if (found) {
      const confirmed = await linksOf(app, options, { appUserId: found.id, status: "confirmed" });
      if (confirmed.some((entry) => String(entry.userId) !== userId)) return { person: null, taken: found.name };
      return { person: found, via: "email" };
    }
    return { person: null, asked: link?.status === "asked" ? { id: link.appUserId, name: link.appUserName } : null };
  }

  /**
   * The call's person at an app connected with the home's API credentials: whoIs. Their bots read only what this
   * person may (packages/bots/src/server/sednaApi.js).
   * @param {{ personal?: boolean }} reach
   * @param {string} accountId
   * @param {object} options
   */
  async function appPerson(reach, accountId, options) {
    const app = await reached(reach, accountId, options);
    return { app: app.kind.name, ...await whoIs(app, me(options), options) };
  }

  /** The app's users whose name or address holds `words`, for the call's person to pick their own. */
  async function appUsers(reach, accountId, words, options) {
    const { kind, values, access } = await reached(reach, accountId, options);
    return (await kind.users({ values, access, words })).map(({ id, name, email }) => ({ id, name, email }));
  }

  /** Refuses `chosen` for `userId` when another of the home's people is that user, by address or confirmed. */
  async function refuseSomeoneElses(app, chosen, userId, options) {
    const owners = await Promise.all(chosen.emails.map((email) => memberWithEmail(email, options)));
    const theirs = owners.some((owner) => owner && owner !== userId);
    const confirmed = await linksOf(app, options, { appUserId: chosen.id, status: "confirmed" });
    if (theirs || confirmed.some((entry) => String(entry.userId) !== userId)) {
      throw new ConnectionError(409, `${chosen.name} is someone else in this home at ${app.kind.name}. Pick yourself, or ask an owner or admin.`, {
        code: "integrations_app_user_taken",
        params: { app: app.kind.name }
      });
    }
  }

  /**
   * The call's person picks who they are at the app, when their address finds no one: asked until an owner or admin
   * confirms it, confirmed at once when they are one.
   * @param {{ personal?: boolean }} reach
   * @param {string} accountId
   * @param {unknown} appUserId
   * @param {object} options
   */
  async function pickAppUser(reach, accountId, appUserId, options) {
    const app = await reached(reach, accountId, options);
    const { kind, values, access, account, org } = app;
    const userId = me(options);
    const byAddress = await kind.person({ values, access, address: await emailOf(userId, options) });
    if (byAddress) {
      throw new ConnectionError(409, `${kind.name} already knows you as ${byAddress.name}, by your email address.`, {
        code: "integrations_app_person_matched",
        params: { app: kind.name }
      });
    }
    const chosen = await kind.personById({ values, access, id: String(appUserId ?? "") });
    if (!chosen) throw new ConnectionError(404, `${kind.name} has no such user.`, { code: "integrations_app_user_unknown", params: { app: kind.name } });
    const confirmed = accounts.managesHome(options);
    await retryLostInsertRace(options, () => links.withTransaction(passedOn(options), async (txOptions) => {
      await refuseSomeoneElses(app, chosen, userId, txOptions);
      await links.deleteWhere({ accountId: String(account.id), userId }, { ...passedOn(txOptions), returning: "none" });
      await links.create({
        accountId: String(account.id),
        userId,
        org,
        appUserId: chosen.id,
        appUserName: chosen.name,
        status: confirmed ? "confirmed" : "asked",
        confirmedBy: confirmed ? userId : null,
        confirmedAt: confirmed ? new Date().toISOString() : null
      }, { ...passedOn(txOptions), returning: "none" });
    }));
    return { app: kind.name, ...await whoIs(app, userId, options) };
  }

  /**
   * An owner or admin confirms the user a person of the home picked as themselves.
   * @param {{ personal?: boolean }} reach
   * @param {string} accountId
   * @param {unknown} userId the person's id
   * @param {object} options
   */
  async function confirmAppPerson(reach, accountId, userId, options) {
    const app = await managed(reach, accountId, options);
    const person = String(userId ?? "");
    const [link] = /^\d+$/u.test(person) ? await linksOf(app, options, { userId: person, status: "asked" }) : [];
    if (!link) throw new ConnectionError(404, "Nobody waits for that to be confirmed.", { code: "integrations_app_person_not_asked" });
    const chosen = await app.kind.personById({ values: app.values, access: app.access, id: link.appUserId });
    if (!chosen) throw new ConnectionError(404, `${app.kind.name} no longer has that user.`, { code: "integrations_app_user_unknown", params: { app: app.kind.name } });
    await retryLostInsertRace(options, () => links.withTransaction(passedOn(options), async (txOptions) => {
      await refuseSomeoneElses(app, chosen, person, txOptions);
      await links.patchWhere(
        { id: [String(link.id)], status: "asked" },
        { status: "confirmed", confirmedBy: me(options), confirmedAt: new Date().toISOString(), appUserName: chosen.name },
        { ...passedOn(txOptions), returning: "none" }
      );
    }));
    return appPeople(reach, accountId, options);
  }

  /**
   * Forgets who a person picked as themselves: a refused or mistaken pick. Their own, or anyone's for an owner or admin.
   * @param {{ personal?: boolean }} reach
   * @param {string} accountId
   * @param {unknown} userId the person's id, or "me"
   * @param {object} options
   */
  async function forgetAppPerson(reach, accountId, userId, options) {
    const own = userId === "me" || String(userId) === me(options);
    const account = own
      ? await accounts.reachableAccount(reach, accountId, options)
      : await accounts.manageableAccount(reach, accountId, options);
    kindOf(account);
    const person = own ? me(options) : String(userId ?? "");
    if (!/^\d+$/u.test(person)) throw new ConnectionError(404, "No such person.", { code: "integrations_app_person_not_found" });
    await links.deleteWhere({ accountId: String(account.id), userId: person }, { ...passedOn(options), returning: "none" });
    return { forgotten: true };
  }

  /**
   * The home's people and who each is at the app, for its owners and admins: by address, picked and confirmed, or
   * picked and waiting for them to confirm. People past the first fifty are listed unchecked.
   * @param {{ personal?: boolean }} reach
   * @param {string} accountId
   * @param {object} options
   */
  async function appPeople(reach, accountId, options) {
    const app = await managed(reach, accountId, options);
    const { kind, values, access } = app;
    const everyone = await homePeople(options);
    const picks = await linksOf(app, options);
    const found = await kind.matches({ values, access, people: everyone });
    const confirmedFor = new Map(picks.filter((entry) => entry.status === "confirmed").map((entry) => [entry.appUserId, String(entry.userId)]));
    const people = everyone.map((entry, index) => {
      const pick = picks.find((link) => String(link.userId) === entry.id);
      const shown = { id: entry.id, name: entry.name, email: entry.email };
      if (pick?.status === "confirmed") return { ...shown, via: "picked", appUser: { id: pick.appUserId, name: pick.appUserName } };
      if (index >= found.length) return { ...shown, unchecked: true };
      const match = found[index];
      if (match && (confirmedFor.get(match.id) ?? entry.id) !== entry.id) return { ...shown, taken: match.name };
      if (match) return { ...shown, via: "email", appUser: { id: match.id, name: match.name } };
      return { ...shown, asked: pick ? { id: pick.appUserId, name: pick.appUserName } : null };
    });
    return { app: kind.name, people };
  }

  return Object.freeze({
    appPerson,
    appUsers,
    pickAppUser,
    confirmAppPerson,
    forgetAppPerson,
    appPeople
  });
}
