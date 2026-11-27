import assert from "node:assert/strict";
import test from "node:test";
import { createAppMessages } from "../../packages/bots/src/server/appMessages.js";
import { accessOf } from "../support/appKey.mjs";

// What apps send without a button press (D-137), as the bots make it: a notice is the home's main bot's message in each
// person's own chat with it, as that person; an email goes from the chosen mailbox, logged instead in a test copy. Stand-ins
// for the bots' records, the home's integrations and Gmail.
const system = (reason) => ({ forWorkspace: (home, { actorId } = {}) => ({ reason, home, actorId }) });
const call = { context: { workspace: { id: "5" } } };

function parts({ connected = true } = {}) {
  const posted = [];
  const records = {
    directory: { homeBotFaces: async () => [{ id: "3", name: "Otto", main: true, archived: false }, { id: "4", name: "Ida", main: false }] },
    chats: {
      direct: async (botId, options) => ({ id: `chat-${botId}-${options.context.actorId}` }),
      everyoneIn: async () => ["7", "8"],
      managersIn: async () => ["7"]
    },
    messages: { append: async (chatId, list, options) => posted.push({ chatId, list, as: options.context.actorId }) }
  };
  const integrations = {
    reachableAccounts: async () => [{ id: "9", pluginId: "gmail", label: "office@acme.example", status: connected ? "connected" : "broken" }],
    connections: { accessToken: async (id) => accessOf(`key-${id}`) }
  };
  return { posted, records, integrations };
}

test("a notice is the main bot's message in each person's own chat with it, as them", async () => {
  const { posted, records, integrations } = parts();
  const messages = createAppMessages({ records, integrations, env: { APP_ENV: "test" }, systemContext: system });
  assert.equal(await messages.notifyMembers(call, { userIds: ["7", "8"], text: "From Leave: Kim asked for Friday off" }), 2);
  assert.deepEqual(posted.map((entry) => [entry.chatId, entry.as, entry.list[0].role, entry.list[0].authorBotId, entry.list[0].body.text]), [
    ["chat-3-7", "7", "bot", "3", "From Leave: Kim asked for Friday off"],
    ["chat-3-8", "8", "bot", "3", "From Leave: Kim asked for Friday off"]
  ]);
});

test("a notice to owners reaches the home's owners and admins, one to everyone every member", async () => {
  const { records, integrations } = parts();
  const messages = createAppMessages({ records, integrations, env: { APP_ENV: "test" }, systemContext: system });
  assert.deepEqual([await messages.managers(call), await messages.members(call)], [["7"], ["7", "8"]]);
});

test("an app may send from the home's connected Gmail and Outlook mailboxes, each by its address", async () => {
  const { records } = parts();
  const asked = [];
  const integrations = {
    reachableAccounts: async (_call, { pluginIds }) => {
      asked.push(pluginIds);
      return [
        { id: 9, pluginId: "gmail", label: "office@acme.example", status: "connected" },
        { id: 10, pluginId: "outlook", label: "old@acme.example", status: "broken" },
        { id: 11, pluginId: "outlook", name: "sales@acme.example", status: "connected" }
      ];
    }
  };
  const messages = createAppMessages({ records, integrations, env: { APP_ENV: "test" }, systemContext: system });
  assert.deepEqual(await messages.mailboxes(call), [
    { id: "9", app: "gmail", address: "office@acme.example" },
    { id: "11", app: "outlook", address: "sales@acme.example" }
  ]);
  assert.deepEqual(asked, [["gmail", "outlook"]], "only the mail apps' accounts are asked for");
});

test("an email goes from the chosen mailbox in a live copy, is logged in a test copy, and needs that mailbox connected", async (context) => {
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    sent.push({ url: String(url), raw: Buffer.from(JSON.parse(options.body).raw, "base64url").toString() });
    return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
  };
  context.after(() => { globalThis.fetch = original; });
  const mail = { account: "9", to: ["sam@example.com"], subject: "Your booking", text: "See you Friday." };

  const { records, integrations } = parts();
  const logged = await createAppMessages({ records, integrations, env: { APP_ENV: "test" }, systemContext: system }).sendEmail(call, mail);
  assert.equal(logged.simulated, true);
  assert.deepEqual(sent, [], "a test copy sends nothing");

  await createAppMessages({ records, integrations, env: { APP_ENV: "production" }, systemContext: system }).sendEmail(call, mail);
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /gmail\.googleapis\.com/u);
  assert.match(sent[0].raw, /To: sam@example\.com/u);

  const broken = parts({ connected: false });
  await assert.rejects(
    createAppMessages({ records: broken.records, integrations: broken.integrations, env: { APP_ENV: "production" }, systemContext: system }).sendEmail(call, mail),
    { code: "apps_email_mailbox_gone" }
  );
});
