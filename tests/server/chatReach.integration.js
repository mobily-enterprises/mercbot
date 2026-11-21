import assert from "node:assert/strict";
import test from "node:test";
import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { seedChat } from "../support/chatFixtures.mjs";
import { memberOptions, startBotRecordsWithAccount } from "../support/botRecords.mjs";
import { SIGN_IN_LINE } from "../../packages/bots/src/server/signInCodes.js";
import { botsOf, homeOfPeople, startChatTurns } from "./turnKit.mjs";

// What a bot may use in a chat (D-112, R4): everything connected to the home, and the home's Vault, in any chat, as the
// person who asked; the cards it makes are theirs alone to answer. Against the disposable test database, a scripted
// reply in place of the model and a stand-in for the home's connected accounts.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/**
 * The home's connected accounts as integrations answers them: Pat's Gmail and Kim's Outlook, for `people` ([Pat, Kim],
 * filled in once they exist). Who each call is for is kept.
 */
function homeAccounts(people) {
  const askedFor = [];
  const accountsOf = ([pat, kim]) => [
    { id: "1", pluginId: "gmail", label: "pat@example.org", name: "", status: "connected", userId: pat },
    { id: "2", pluginId: "outlook", label: "kim@example.org", name: "", status: "connected", userId: kim }
  ];
  return {
    askedFor,
    integrations: {
      reachableAccounts: async (call, filters = {}) => {
        askedFor.push(String(resolveActorId(call.context) ?? ""));
        return accountsOf(people).filter((entry) => !filters.pluginIds || filters.pluginIds.includes(entry.pluginId));
      },
      toolSwitches: async (call) => {
        askedFor.push(String(resolveActorId(call.context) ?? ""));
        return { skip: {}, removed: [], turnedOff: [], connected: ["gmail", "outlook"] };
      },
      namesOf: async (userIds) => new Map(userIds.map((id) => [id, id === people[0] ? "Pat" : "Kim"])),
      appName: (id) => ({ gmail: "Gmail", outlook: "Outlook" })[id] || id
    }
  };
}

test("in a chat with others, the bot uses the home's accounts for whoever asked, and only they answer its cards", async (context) => {
  const people = [];
  const states = [];
  const reach = homeAccounts(people);
  const kit = await startChatTurns(context, {
    integrations: reach.integrations,
    reply: async (_bot, _history, tools, state, prompt) => {
      states.push(state);
      if (prompt) return { text: "Noted.", transcript: [] };
      await tools.askWithOptions.execute({ question: "Which day suits?", options: ["Monday", "Tuesday"] });
      return { text: "Which day?", transcript: [] };
    }
  });
  const made = await homeOfPeople(kit, ["Pat", "Kim"]);
  people.push(...made.people);
  const [pat, kim] = people;
  const [ada] = await botsOf(kit, made.homeId, pat, ["Ada"]);
  const { id: chat } = await seedChat(kit.knex, { homeId: made.homeId, kind: "private", people: [pat, kim], bots: [ada] });
  const as = (person) => kit.as(person, made.homeId);

  const sent = await kit.turns.chat.sendMessage(chat, { text: "Ada, book us a meeting" }, as(kim));
  await kit.turns.chat.reply(chat, { afterMessageId: sent.messages.at(-1).id }, undefined, as(kim));
  await kit.drain();

  assert.ok(reach.askedFor.length && reach.askedFor.every((person) => person === kim), "every account read is for Kim, who asked");
  const [state] = states;
  assert.match(state, /Gmail: pat@example\.org \(connected by Pat\)/u, "the home's accounts, Pat's too, in a private chat (R4)");
  assert.match(state, /Outlook: kim@example\.org \(connected by them\)/u);
  assert.match(state, /Who you're working for now: Kim\. Cards you make are for Kim, and only Kim can answer them\./u);

  // The card is Kim's: Pat can't answer it, Kim can.
  const card = await kit.knex("messages").where({ conversation_id: chat, kind: "choice" }).orderBy("id", "desc").first();
  assert.deepEqual(card.body.for, { id: kim, name: "Kim" });
  await assert.rejects(kit.turns.chat.answerChoice(chat, String(card.id), ["Monday"], as(pat)), { statusCode: 403, code: "bots_waiting_for_other" });
  const answered = await kit.turns.chat.answerChoice(chat, String(card.id), ["Monday"], as(kim));
  assert.equal(answered.messages.find((message) => message.id === String(card.id))?.body.chosen, "Monday");
});

test("in a chat with others, codes and coding are offered, and a sign-in on the chat's computer posts one line (D14)", async (context) => {
  const offered = [];
  const noted = [];
  const kit = await startChatTurns(context, {
    computer: {
      status: async () => null,
      code: async () => ({ tools: [{ id: "claude-code", label: "Claude Code", installed: true, signedIn: true }], run: null }),
      noteSignIn: async (computerId, note) => {
        noted.push([computerId, note]);
      }
    },
    reply: async (_bot, _history, tools) => {
      offered.push(...["startSignIn", "fillSignInCode", "startCoding"].filter((name) => name in tools));
      // Twice in one turn: the chat hears it once.
      await tools.connectCodingAccount.execute({ tool: "claude-code" });
      await tools.connectCodingAccount.execute({ tool: "claude-code" });
      return { text: "Claude Code is ready.", transcript: [] };
    }
  });
  const { homeId, people: [pat, kim] } = await homeOfPeople(kit, ["Pat", "Kim"]);
  const [ada] = await botsOf(kit, homeId, pat, ["Ada"]);
  const { id: chat, chatBotIds } = await seedChat(kit.knex, { homeId, people: [pat, kim], bots: [ada] });
  const sent = await kit.turns.chat.sendMessage(chat, { text: "Ada, get the coding tool ready" }, kit.as(kim, homeId));
  await kit.turns.chat.reply(chat, { afterMessageId: sent.messages.at(-1).id }, undefined, kit.as(kim, homeId));
  await kit.drain();

  assert.deepEqual(offered, ["startSignIn", "fillSignInCode", "startCoding"], "Kim's own turn in a chat with Pat");
  const computer = chatBotIds.get(ada);
  assert.deepEqual(noted, [[computer, { label: "Claude Code", kind: "coding" }], [computer, { label: "Claude Code", kind: "coding" }]], "the computer of Ada's seat in this chat");
  const lines = await kit.knex("messages").where({ conversation_id: chat, kind: "event" }).whereRaw("body->>'text' = ?", [SIGN_IN_LINE]);
  assert.equal(lines.length, 1, "one line a turn");
  assert.match(lines[0].body.detail, /Signed in to Claude Code on this chat's computer\./u);
});

test("the Vault is the home's: everyone in it reads its items, and an item is deleted by who added it or an owner", async (context) => {
  const kit = await startChatTurns(context);
  const { homeId, people: [pat, kim, lee] } = await homeOfPeople(kit, ["Pat", "Kim", "Lee"]);
  const { account } = await startBotRecordsWithAccount(kit.knex, kit.cleanup);
  const as = (person, permissions = []) => memberOptions({ userId: person, homeId, permissions });
  const owner = as(pat, ["workspace.settings.update"]);

  const { item } = await account.addVaultItem({ kind: "contact", data: { label: "Office", fullName: "Front desk" } }, as(kim));
  assert.equal(item.madeBy, kim);
  assert.deepEqual((await account.vault(as(lee))).items.map((entry) => entry.id), [item.id], "Lee reads Kim's item: it's the home's");
  await assert.rejects(account.deleteVaultItem(item.id, as(lee)), { statusCode: 403, code: "account_vault_delete_forbidden" });
  const second = (await account.addVaultItem({ kind: "contact", data: { fullName: "Courier" } }, as(lee))).item;
  assert.deepEqual(await account.deleteVaultItem(second.id, as(lee)), { deleted: second.id }, "who added it deletes it");
  assert.deepEqual(await account.deleteVaultItem(item.id, owner), { deleted: item.id }, "an owner deletes anyone's");
  assert.deepEqual((await account.vault(as(kim))).items, []);
  // Another home's Vault is another home's.
  const other = await homeOfPeople(kit, ["Sam"]);
  await account.addVaultItem({ kind: "contact", data: { fullName: "Elsewhere" } }, memberOptions({ userId: other.people[0], homeId: other.homeId }));
  assert.deepEqual((await account.vault(as(kim))).items, []);
});
