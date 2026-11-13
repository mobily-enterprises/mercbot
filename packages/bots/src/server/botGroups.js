import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { plainMentions, withMentions } from "./mentions.js";
import { BotsError } from "./botsError.js";
import { cloudShape, messageBody, previewOf, toBot } from "./botRows.js";

/**
 * Group chats (D-46): made, and their bots and people added and removed. Every method takes
 * the call's options last: the person and the home are its context.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("./types.js").BotConversations} dependencies.conversations
 */
export function createBotGroups({ records, conversations }) {
  const { conversations: store } = records;
  // Group chats. A group is a conversation row of kind "group" with up to eight member
  // bots in order. Each message from a member records who said it. A message goes to the bots it
  // mentions, or to every member; then bots another bot mentioned may answer once more. In a
  // group, a bot can set up or change its own routines: they belong to that bot,
  // so their event lines and any approval card go to its own chat. Nothing else uses tools.
  const MAX_MEMBERS = 6;

  async function withMembers(row, options) {
    return {
      ...toBot(row),
      members: (await conversations.membersOf([row.id], options)).get(String(row.id)) || [],
      people: (await conversations.peopleOf([row.id], options)).get(String(row.id)) || []
    };
  }

  async function ownedGroup(groupId, options) {
    const row = await conversations.ownedBot(groupId, options).catch(() => null);
    if (!row || row.kind !== "group") throw new BotsError(404, "Group not found.", { code: "bots_group_not_found" });
    return row;
  }

  /**
   * The first message creates the group; Enter with no message creates it empty.
   * With two or more bots its name lists the participants, the person first;
   * with one bot it's the first message, or the bot's name.
   */
  async function createGroup(input = {}, person = "", options) {
    const ids = [...new Set((Array.isArray(input.botIds) ? input.botIds : []).map(String))];
    if (!ids.length) throw new BotsError(400, "Pick at least one bot.", { code: "bots_group_bots_missing" });
    if (ids.length > MAX_MEMBERS) {
      throw new BotsError(400, `A group can have up to ${MAX_MEMBERS} bots.`, { code: "bots_group_full", params: { max: MAX_MEMBERS } });
    }
    const userId = conversations.personOf(options);
    return retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      const rows = await store.homeBotsOf(ids, txOptions);
      if (rows.length !== ids.length) throw new BotsError(400, "Pick from your own bots.", { code: "bots_group_bot_not_own" });
      const picked = ids.map((id) => rows.find((row) => String(row.id) === id));
      const empty = !String(input.text || "").trim() && !input.quotes?.length && !input.attachments?.length;
      const body = empty
        ? null
        : withMentions(
          messageBody(input),
          picked.map((row) => ({ id: String(row.id), name: row.name, color: row.color, shape: cloudShape(row.shape) }))
        );
      const name = picked.length > 1
        ? [person || "Me", ...picked.map((row) => row.name)].join(", ")
        : (body && plainMentions(body.text, body.mentions).replace(/\s+/gu, " ").trim()) || picked[0].name;
      const bot = await store.createBot({ user_id: userId, kind: "group", name: name.slice(0, 200), color: "#000000", shape: "cloud" }, txOptions);
      // The group talks in one room; its maker is its first person (createBot, D-46).
      const group = await conversations.seenBy(bot, txOptions);
      await store.updateConversation(group.seat_id, { room_id: group.conversation_id }, txOptions);
      await store.addGroupMembers(group.id, picked.map((row, position) => ({ botId: row.id, position })), txOptions);
      if (body) body.from = await conversations.fromOf(userId, txOptions);
      const messages = await conversations.append(group, [
        { kind: "timestamp", role: "system", body: { at: new Date().toISOString() } },
        ...(body ? [{ kind: "text", role: "user", body }] : [])
      ], txOptions);
      const fresh = await conversations.refresh(group, txOptions);
      return { bot: { ...await withMembers(fresh, txOptions), preview: body ? previewOf({ kind: "text", body }) : "" }, messages };
    }));
  }

  async function addMember(groupId, botId, options) {
    return store.withTransaction(options, async (txOptions) => {
      const group = await ownedGroup(groupId, txOptions);
      // Only a bot of the group's own home, which everyone in the group can use (D-46).
      const [bot] = botId ? await store.homeBotsOf([String(botId)], txOptions) : [];
      if (!bot) throw new BotsError(404, "Bot not found.", { code: "bots_bot_not_found" });
      const current = await store.groupMembersOf(group.id, txOptions);
      if (!current.some((member) => String(member.botId) === String(bot.id))) {
        if (current.length >= MAX_MEMBERS) {
          throw new BotsError(409, `A group can have up to ${MAX_MEMBERS} bots.`, {
            code: "bots_group_full",
            params: { max: MAX_MEMBERS }
          });
        }
        const position = current.length ? current[current.length - 1].position + 1 : 0;
        await store.addGroupMembers(group.id, [{ botId: bot.id, position }], txOptions);
      }
      return { bot: await withMembers(group, txOptions) };
    });
  }

  async function removeMember(groupId, botId, options) {
    return store.withTransaction(options, async (txOptions) => {
      const group = await ownedGroup(groupId, txOptions);
      if (!(await store.severalBotsIn(group.id, txOptions))) {
        throw new BotsError(409, "A group needs at least one bot.", { code: "bots_group_last_bot" });
      }
      await store.removeGroupMember(group.id, String(botId), txOptions);
      return { bot: await withMembers(group, txOptions) };
    });
  }

  /**
   * People in a group (D-46): anyone in it adds someone from the home; the group's maker, the
   * home's owners and admins remove people; anyone can leave. The last one out ends the group.
   */
  async function addPerson(groupId, personId, options) {
    const userId = conversations.personOf(options);
    const { group, line } = await retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      const group = await ownedGroup(groupId, txOptions);
      if (!personId || !(await store.isHomeMember(personId, txOptions))) {
        throw new BotsError(404, "That person isn't in this home.", { code: "bots_person_not_in_home" });
      }
      if (await conversations.inGroup(group.id, personId, txOptions)) return { group, line: null };
      await store.addGroupPerson(group, personId, userId, txOptions);
      const [by, added] = [await conversations.fromOf(userId, txOptions), await conversations.fromOf(personId, txOptions)];
      const [line] = await conversations.append(group, [
        { kind: "event", role: "system", body: { text: `${by.name} added ${added.name}`, icon: "group" } }
      ], txOptions);
      // What was said before they joined isn't news to them.
      await store.markRead(group.conversation_id, line.id, txOptions, { userId: personId });
      return { group, line };
    }));
    await conversations.tell(group, { type: "changed" }, options);
    if (line) await conversations.tell(group, { type: "messages" }, options);
    return { bot: await withMembers(await conversations.refresh(group, options), options) };
  }

  async function removePerson(groupId, personId, { manages = false } = {}, options) {
    const userId = conversations.personOf(options);
    const { group, gone } = await store.withTransaction(options, async (txOptions) => {
      const group = await ownedGroup(groupId, txOptions);
      const leaving = String(personId) === userId;
      if (!leaving && !manages && String(group.created_by) !== userId) {
        throw new BotsError(403, "Only the person who made this group, or the home's owners and admins, can remove people.", {
          code: "bots_group_remove_forbidden"
        });
      }
      if (!(await conversations.inGroup(group.id, personId, txOptions))) {
        throw new BotsError(404, "That person isn't in this group.", { code: "bots_person_not_in_group" });
      }
      const people = await conversations.groupPeople(group.id, txOptions);
      if (people.length === 1) {
        await store.deleteBot(group.id, txOptions);
        return { group, gone: "group" };
      }
      if (!leaving && String(personId) === String(group.created_by)) {
        throw new BotsError(409, "The person who made this group can leave it, but not be removed.", { code: "bots_group_maker_kept" });
      }
      const person = await conversations.fromOf(personId, txOptions);
      const by = await conversations.fromOf(userId, txOptions);
      // Written while they are still in the group: the row policy lets a person write only where they read.
      await conversations.append(group, [
        {
          kind: "event",
          role: "system",
          body: { text: leaving ? `${person.name} left` : `${by.name} removed ${person.name}`, icon: "group" }
        }
      ], txOptions);
      await store.removeGroupPerson(group, personId, txOptions);
      return { group, gone: "person" };
    });
    // The person who's out hears it; everyone still in sees the change.
    await conversations.publish([String(personId)], { botId: String(group.id), type: "removed" });
    if (gone === "group") return { deleted: String(group.id) };
    await conversations.tell(group, { type: "changed" }, options);
    await conversations.tell(group, { type: "messages" }, options);
    return String(personId) === userId
      ? { left: String(group.id) }
      : { bot: await withMembers(await conversations.refresh(group, options), options) };
  }

  return Object.freeze({
    createGroup,
    addMember,
    removeMember,
    addPerson,
    removePerson
  });
}
