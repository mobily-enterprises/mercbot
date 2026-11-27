import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { isId } from "./recordRows.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/**
 * A repository a person let a bot use (D-128): GitHub's id and owner/name, for always (`chatBotId` null) or for one
 * task, the bot's seat in one chat until `expiresAt`.
 * @typedef {{ id: string, botId: string, repositoryId: string, fullName: string, chatBotId: string | null, expiresAt: string | null, createdAt: string }} GithubRepoGrant
 */

/** How long Just this task lets a bot use a repository, in the chat it was asked in. */
const TASK_HOURS = 4;

/**
 * bot_github_repos filters beyond its `search: true` fields: the yeses still standing, by the database's clock, and the
 * always ones.
 */
export const GITHUB_REPO_SEARCH = Object.freeze({
  always: Object.freeze({
    type: "boolean",
    applyFilter(query, _always, { column }) {
      query.whereNull(column("chatBotId"));
    }
  }),
  standing: Object.freeze({
    type: "boolean",
    applyFilter(query, _standing, { column }) {
      query.where((live) => live.whereNull(column("expiresAt")).orWhereRaw("?? > now()", [column("expiresAt")]));
    }
  }),
  // What counts in the bot's seat in one chat: an always, or a yes for a task there.
  usableIn: Object.freeze({
    type: "id",
    applyFilter(query, chatBotId, { column }) {
      query.where((seat) => seat.whereNull(column("chatBotId")).orWhere(column("chatBotId"), chatBotId));
    }
  })
});

const FIELDS = Object.freeze(["botId", "repositoryId", "fullName", "chatBotId", "expiresAt", "createdAt"]);

/**
 * The repositories each person let each bot use in its commands (D-128). The rows are the person's own in the home
 * (ownership `workspace_user`): a request reads and changes the signed-in person's, and a turn's model reader, which
 * acts for its asker, the asker's. So a bot working for someone in a room only ever finds what that person allowed.
 * @param {{ botGithubRepos: import("@jskit-ai/resource-runtime/server/types").ResourceHandle }} resources
 */
export function createGithubRepoRepository({ botGithubRepos }) {
  /** @returns {GithubRepoGrant} */
  const asGrant = (record) => ({
    id: String(record.id),
    botId: String(record.botId),
    repositoryId: String(record.repositoryId),
    fullName: record.fullName,
    chatBotId: record.chatBotId == null ? null : String(record.chatBotId),
    expiresAt: record.expiresAt ?? null,
    createdAt: record.createdAt
  });

  /**
   * Whether the call's person lets the bot use a repository here: always, or for a task in this seat that hasn't run out.
   * @param {{ botId: string, chatBotId: string, repositoryId: string }} wanted
   * @param {CallOptions} options
   */
  async function allows({ botId, chatBotId, repositoryId }, options) {
    const found = await botGithubRepos.queryAll(
      { filters: { botId: String(botId), repositoryId: String(repositoryId), standing: true, usableIn: String(chatBotId) }, fields: ["id"], take: 1 },
      passedOn(options)
    );
    return found.length > 0;
  }

  /**
   * The call's person lets the bot use a repository: `always`, or for this task (the bot's seat, for TASK_HOURS).
   * Saying always again keeps the one row (ux_bot_github_repos_always); a card is answered once, under its chat's lock.
   * @param {{ botId: string, chatBotId: string, repository: { id: string, fullName: string }, always: boolean }} grant
   * @param {CallOptions} options
   */
  async function allow({ botId, chatBotId, repository, always }, options) {
    if (always) {
      const [kept] = await botGithubRepos.queryAll(
        { filters: { botId: String(botId), repositoryId: String(repository.id), always: true }, fields: ["fullName"] },
        passedOn(options)
      );
      if (kept) return;
    }
    await botGithubRepos.create({
      botId: String(botId),
      repositoryId: String(repository.id),
      fullName: String(repository.fullName),
      chatBotId: always ? null : String(chatBotId),
      expiresAt: always ? null : new Date(Date.now() + TASK_HOURS * 3600000).toISOString()
    }, { ...passedOn(options), returning: "none" });
  }

  /**
   * The repositories the call's person lets a bot use and still stand, newest first, for the bot's details.
   * @param {string} botId
   * @param {CallOptions} options
   * @returns {Promise<GithubRepoGrant[]>}
   */
  async function listFor(botId, options) {
    const found = await botGithubRepos.queryAll(
      { filters: { botId: String(botId), standing: true }, sort: ["-id"], fields: [...FIELDS] },
      passedOn(options)
    );
    return found.map(asGrant);
  }

  /**
   * Takes one of the call's person's yeses back; answers whether it was theirs (another person's or a missing one is
   * left alone).
   * @param {string} botId
   * @param {string} grantId
   * @param {CallOptions} options
   */
  async function remove(botId, grantId, options) {
    if (!isId(grantId)) return false;
    const removed = await botGithubRepos.deleteWhere({ id: String(grantId), botId: String(botId) }, { ...passedOn(options), returning: "count" });
    return Number(removed) > 0;
  }

  return Object.freeze({
    allows,
    allow,
    listFor,
    remove
  });
}
