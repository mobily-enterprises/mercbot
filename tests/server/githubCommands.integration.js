import assert from "node:assert/strict";
import test from "node:test";
import { turnPerson } from "../../packages/bots/src/server/connectedApps.js";
import { memberOptions } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";

// A bot's commands signed in to GitHub (D-128), against the disposable test database: a command names a repository,
// and gets a key for it only once the person the bot works for let the bot use it on its card (just this task, or
// always for this bot); only that person answers the card; in a room, a bot uses the asker's own GitHub and the
// asker's own yeses, never another person's; and a yes removed asks again. The person's GitHub is a stand-in (the
// GitHub App's side is tests/server/githubAccess.integration.js), and so is the command line, which keeps what each
// command was started with; no provider and no model.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const ALWAYS = "Always for this bot";
const TASK = "Just this task";

/**
 * Each person's own GitHub as the app reaches it, by person: `{ [userId]: { "owner/name": repository } }`. Every key
 * made is kept, with the repository it was for, and every key withdrawn.
 */
function standInGithub(theirs) {
  const made = [];
  const withdrawn = [];
  const looked = [];
  return {
    made,
    withdrawn,
    looked,
    ready: () => true,
    installUrl: () => "https://github.test/apps/my-mercbot/installations/new",
    botLogin: () => "my-mercbot[bot]",
    repository: async (call, name) => {
      const person = turnPerson(call);
      looked.push({ person, name });
      const found = theirs[person]?.[name];
      return found ? { repository: found, accountId: `account-of-${person}` } : null;
    },
    commandKey: async (found) => {
      const token = `ghs_key${made.length + 1}for${found.id}`;
      made.push({ repository: found.fullName, token });
      return { token, revoke: async () => withdrawn.push(token) };
    }
  };
}

/** Anna (the home's owner) and Ben in a room with Ada, and Anna alone with Ada; each turn's stand-in runs one command. */
async function githubHome(context) {
  let asking = null;
  const turns = [];
  const started = [];
  const shell = {
    available: () => true,
    start: async (request) => {
      started.push(request);
      return { status: "done", run: String(started.length), exitCode: 0, output: "pushed", changed: [] };
    }
  };
  const people = {};
  const github = standInGithub(people);
  const kit = await startChatTurns(context, {
    writeMemory: async () => "",
    integrations: { connections: { github } },
    files: { shell },
    reply: async (_bot, _history, tools, state) => {
      const ran = asking ? await tools.runCommand.execute({ why: "Pushing the fix", script: "git push", github: asking }) : null;
      asking = null;
      turns.push({ state, ran, tools: Object.keys(tools) });
      return { text: "On it.", transcript: [] };
    }
  });
  const { homeId, people: [anna, ben] } = await homeOfPeople(kit, ["Anna", "Ben"]);
  const [ada] = await botsOf(kit, homeId, anna, ["Ada"]);
  const room = await seedChat(kit.knex, { homeId, title: "Website", people: [anna, ben], bots: [ada] });
  const alone = await seedChat(kit.knex, { homeId, kind: "private", title: "Anna and Ada", people: [anna], bots: [ada] });
  const repo = (id, fullName, write = true) => ({ id: String(id), fullName, write, private: true });
  // Anna's GitHub reaches her site and her notes; Ben's reaches the same site (he's a collaborator) and his own app.
  people[anna] = { "anna/site": repo(101, "anna/site"), "anna/notes": repo(102, "anna/notes", false) };
  people[ben] = { "anna/site": repo(101, "anna/site"), "ben/app": repo(201, "ben/app") };
  const as = (person) => memberOptions({ userId: person, homeId });
  /** `person` asks Ada in `chatId` to run a command on `repository`; what run_command answered. */
  const ask = async (person, chatId, repository) => {
    asking = repository;
    const sent = await kit.turns.chat.sendMessage(chatId, { text: "Ada, push it" }, as(person));
    await kit.turns.chat.reply(chatId, { afterMessageId: sent.messages.at(-1).id }, undefined, as(person));
    await kit.drain();
    return turns.at(-1).ran;
  };
  const cardIn = (chatId) => kit.knex("messages").where({ conversation_id: chatId, kind: "choice" }).orderBy("id", "desc").first();
  const grants = () => kit.knex("bot_github_repos").where({ workspace_id: homeId }).orderBy("id");
  return { kit, homeId, anna, ben, ada, room, alone, github, started, turns, as, ask, cardIn, grants };
}

test("a repository not yet allowed gets no key, only a card for the person who asked, which only they answer", async (context) => {
  const f = await githubHome(context);
  const waiting = await f.ask(f.anna, f.room.id, "anna/site");
  assert.equal(waiting.status, "waiting_for_approval");
  assert.match(waiting.note, /card asking whether you may use anna\/site/u);
  assert.deepEqual(f.github.made, [], "no key was made for a repository nobody allowed");
  assert.deepEqual(f.started, [], "and nothing ran");
  const card = await f.cardIn(f.room.id);
  assert.equal(card.body.purpose, "github-repo");
  assert.equal(card.body.question, "Let Ada use anna/site?");
  assert.deepEqual(card.body.options, ["Just this task", "Always for this bot", "No"]);
  assert.deepEqual(card.body.for, { id: String(f.anna), name: "Anna" }, "the card is for the person who asked");
  assert.equal(card.body.repository.fullName, "anna/site");

  // Ben, in the same room, can't answer Anna's card, nor choose another repository on it.
  await assert.rejects(f.kit.turns.chat.answerChoice(f.room.id, String(card.id), [ALWAYS], f.as(f.ben)), { statusCode: 403, code: "bots_waiting_for_other" });
  await assert.rejects(f.kit.turns.chat.answerChoice(f.room.id, String(card.id), { selected: [ALWAYS], repository: "ben/app" }, f.as(f.ben)), { statusCode: 403, code: "bots_waiting_for_other" });
  assert.deepEqual(await f.grants(), [], "Ben's answers let Ada use nothing");
  assert.ok(f.github.looked.every((entry) => entry.person === String(f.anna)), "and his GitHub wasn't even asked");
  assert.equal((await f.cardIn(f.room.id)).body.chosen, null, "the card is still open for Anna");

  // Anna says always: the next command runs with a key for that repository alone, which goes when it ends.
  await f.kit.turns.chat.answerChoice(f.room.id, String(card.id), [ALWAYS], f.as(f.anna));
  const [grant] = await f.grants();
  assert.deepEqual([String(grant.user_id), String(grant.bot_id), String(grant.repository_id), grant.full_name, grant.chat_bot_id, grant.expires_at],
    [String(f.anna), String(f.ada), "101", "anna/site", null, null]);
  const ran = await f.ask(f.anna, f.room.id, "anna/site");
  assert.equal(ran.status, "done", JSON.stringify(ran));
  assert.deepEqual(f.github.made, [{ repository: "anna/site", token: "ghs_key1for101" }]);
  const { secret } = f.started.at(-1);
  assert.ok(secret.env.includes("GH_TOKEN=ghs_key1for101"), "gh signs in with the key");
  assert.ok(secret.env.includes("GIT_CONFIG_KEY_0=credential.https://github.com.helper"), "and git, at github.com");
  assert.deepEqual(secret.hide, ["ghs_key1for101"], "the key is hidden in the command's output");
  await secret.ended();
  assert.deepEqual(f.github.withdrawn, ["ghs_key1for101"], "ending the command withdraws its key");
  // Another repository of hers is asked for on its own card.
  assert.equal((await f.ask(f.anna, f.room.id, "anna/notes")).status, "waiting_for_approval");
  assert.equal(f.github.made.length, 1);
});

test("in a room, a bot uses the asker's own GitHub and the asker's own yeses, never another person's", async (context) => {
  const f = await githubHome(context);
  assert.equal((await f.ask(f.anna, f.room.id, "anna/site")).status, "waiting_for_approval");
  await f.kit.turns.chat.answerChoice(f.room.id, String((await f.cardIn(f.room.id)).id), [ALWAYS], f.as(f.anna));

  // Ben asks Ada for the same repository in the same room: Anna's yes isn't his, so he gets a card of his own and no key.
  const bens = await f.ask(f.ben, f.room.id, "anna/site");
  assert.equal(bens.status, "waiting_for_approval");
  assert.deepEqual(f.github.made, [], "no key from Anna's yes");
  assert.deepEqual(f.github.looked.at(-1), { person: String(f.ben), name: "anna/site" }, "his own GitHub was asked, not Anna's");
  const card = await f.cardIn(f.room.id);
  assert.deepEqual(card.body.for, { id: String(f.ben), name: "Ben" });

  // Ben says yes for this task (before he writes again, which would set his open card aside): his own row, and his
  // next command there gets a key.
  await f.kit.turns.chat.answerChoice(f.room.id, String(card.id), [TASK], f.as(f.ben));
  const bensGrant = (await f.grants()).find((row) => String(row.user_id) === String(f.ben));
  assert.equal(String(bensGrant.chat_bot_id), f.room.chatBotIds.get(String(f.ada)), "for Ada's seat in this room");
  assert.ok(new Date(bensGrant.expires_at) > new Date(Date.now() + 3.9 * 3600000), "for four hours");
  assert.equal((await f.ask(f.ben, f.room.id, "anna/site")).status, "done");
  assert.equal(f.github.made.length, 1);

  // A repository only Anna's GitHub reaches is out of Ben's reach altogether: no card, no key.
  const notes = await f.ask(f.ben, f.room.id, "anna/notes");
  assert.match(notes.error, /anna\/notes isn't a repository Mercbot's GitHub App reaches with their GitHub/u);
  assert.match(notes.error, /https:\/\/github\.test\/apps\/my-mercbot\/installations\/new/u);
  assert.equal((await f.cardIn(f.room.id)).id, card.id, "no new card");
  assert.equal(f.github.made.length, 1, "and no key");
  // Just this task is this room's: Anna's always still counts for her alone, in her private chat too.
  assert.equal((await f.ask(f.anna, f.alone.id, "anna/site")).status, "done");
  assert.equal((await f.ask(f.ben, f.room.id, "ben/app")).status, "waiting_for_approval");
});

test("a person may choose another of their repositories on the card, checked with their own GitHub; No allows nothing", async (context) => {
  const f = await githubHome(context);
  await f.ask(f.anna, f.alone.id, "anna/site");
  const card = await f.cardIn(f.alone.id);
  // One their GitHub doesn't reach is refused, and the card stays open.
  await assert.rejects(
    f.kit.turns.chat.answerChoice(f.alone.id, String(card.id), { selected: [ALWAYS], repository: "ben/app" }, f.as(f.anna)),
    { statusCode: 409, code: "bots_github_repository_unreached" }
  );
  assert.equal((await f.cardIn(f.alone.id)).body.chosen, null);
  await f.kit.turns.chat.answerChoice(f.alone.id, String(card.id), { selected: [TASK], repository: "anna/notes" }, f.as(f.anna));
  const answered = await f.cardIn(f.alone.id);
  assert.equal(answered.body.question, "Let Ada use anna/notes?");
  assert.equal(answered.body.repository.write, false, "as her own GitHub sees it now: she can only read it");
  assert.deepEqual((await f.grants()).map((row) => row.full_name), ["anna/notes"]);

  await f.ask(f.anna, f.alone.id, "anna/site");
  const again = await f.cardIn(f.alone.id);
  await f.kit.turns.chat.answerChoice(f.alone.id, String(again.id), ["No"], f.as(f.anna));
  assert.deepEqual((await f.grants()).map((row) => row.full_name), ["anna/notes"], "No allows nothing");
  assert.equal((await f.ask(f.anna, f.alone.id, "anna/site")).status, "waiting_for_approval");
});

test("Remove takes a person's own yes back, never anyone else's, and the bot asks again", async (context) => {
  const f = await githubHome(context);
  for (const person of [f.anna, f.ben]) {
    await f.ask(person, f.room.id, "anna/site");
    await f.kit.turns.chat.answerChoice(f.room.id, String((await f.cardIn(f.room.id)).id), [ALWAYS], f.as(person));
  }
  const repos = f.kit.records.githubRepos;
  const annas = await repos.listFor(f.ada, f.as(f.anna));
  assert.deepEqual(annas.map((entry) => [entry.fullName, entry.chatBotId]), [["anna/site", null]], "each person lists only their own");
  const [bens] = await repos.listFor(f.ada, f.as(f.ben));
  assert.notEqual(bens.id, annas[0].id);

  assert.equal(await repos.remove(f.ada, annas[0].id, f.as(f.ben)), false, "Ben can't remove Anna's");
  assert.equal(await repos.remove("999999999", annas[0].id, f.as(f.anna)), false, "nor through another bot");
  assert.equal((await f.grants()).length, 2);
  assert.equal(await repos.remove(f.ada, annas[0].id, f.as(f.anna)), true);
  assert.deepEqual(await repos.listFor(f.ada, f.as(f.anna)), []);
  assert.equal(await repos.remove(f.ada, annas[0].id, f.as(f.anna)), false, "gone once");

  assert.equal((await f.ask(f.anna, f.room.id, "anna/site")).status, "waiting_for_approval", "Ada asks Anna again");
  assert.equal((await f.ask(f.ben, f.room.id, "anna/site")).status, "done", "Ben's own yes still stands");
});

test("on a copy without its GitHub App, a command that names a repository is refused before anyone's GitHub is asked", async (context) => {
  const f = await githubHome(context);
  f.github.ready = () => false;
  const off = await f.ask(f.anna, f.room.id, "anna/site");
  assert.deepEqual(off, { error: "Commands can't sign in to GitHub here." });
  assert.deepEqual(f.github.looked, [], "nobody's GitHub was asked");
  assert.deepEqual(f.started, [], "and nothing ran");
});
