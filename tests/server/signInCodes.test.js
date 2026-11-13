import assert from "node:assert/strict";
import test from "node:test";
import { baseDomain, buildSignInCodeTools, namesSite, SIGN_IN_CODE_ACTIONS, signInCodeIn } from "../../packages/bots/src/server/signInCodes.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { turnDoubles } from "../support/botDoubles.mjs";

// Sign-in codes a site emails the person, which the bot fetches itself from an inbox it can read, against
// stand-ins for Gmail's and Graph's APIs.

test("the code in a sign-in email is found near the words that name it, and nothing else is taken for one", () => {
  assert.equal(signInCodeIn({ subject: "482913 is your Example verification code", text: "" }), "482913");
  assert.equal(signInCodeIn({ subject: "Sign in to Example", text: "Hi Pat,\n\nYour one-time code is:\n\n  731 044\n\nIt expires in 10 minutes." }), "731044");
  assert.equal(signInCodeIn({ subject: "Your code", text: "G-582913 is your Google verification code." }), "582913");
  assert.equal(signInCodeIn({ subject: "Confirm your email", text: "Enter AB12CD on the page to confirm." }), "AB12CD");
  assert.equal(signInCodeIn({ subject: "Security alert", text: "Use code 4821-7730 to log in." }), "48217730");
  assert.equal(
    signInCodeIn({ subject: "Your order 2026-11-11", text: "Order 55512345 ships on 12/11/2026. Total $1234.50.\nThanks!" }),
    null,
    "an email with no code in it gives none, not any number"
  );
  assert.equal(signInCodeIn({ subject: "Login code", text: "Your code is 2026-11-11" }), null, "a date isn't a code");
});

test("a site's domain is the one it's registered as, by the Public Suffix List", () => {
  assert.equal(baseDomain("accounts.example.com"), "example.com");
  assert.equal(baseDomain("mail.example.co.uk"), "example.co.uk");
  assert.equal(baseDomain("login.shop.com.au"), "shop.com.au");
  assert.equal(baseDomain("auth.abc.io"), "abc.io");
  assert.equal(baseDomain("example.com"), "example.com");
  // Where anyone can register a site, each is its own: one can't pass for another.
  assert.equal(baseDomain("login.bank.ltd.uk"), "bank.ltd.uk");
  assert.equal(baseDomain("someone.github.io"), "someone.github.io");
  assert.equal(baseDomain("shop.tokyo.jp"), "shop.tokyo.jp");
  for (const nothing of ["co.uk", "com", "github.io", "localhost", "127.0.0.1", ""]) assert.equal(baseDomain(nothing), null, nothing);
});

/** fetch answering Gmail's and Graph's paths; every URL asked for is kept, with the key it carried. */
function fakeMail(context, routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), key: options.headers?.authorization || options.headers?.Authorization || "" });
    const match = Object.entries(routes).find(([part]) => String(url).includes(part));
    return new Response(JSON.stringify(match ? match[1] : { error: { message: "not found" } }), { status: match ? 200 : 404 });
  };
  context.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

const header = (name, value) => ({ name, value });
const now = Date.now();

/**
 * The tools with the person's Gmail and the home's Outlook connected, the page in front on `url` (in an open sign-in
 * chain unless `inChain` is false), and what they typed, asked and ended kept.
 */
function signInTool({
  url = "https://login.example.com/verify",
  inChain = true,
  startedFrom = `${new URL(url).origin}/`,
  accounts,
  said = ["Please sign in to example.com for me"]
} = {}) {
  const typed = [];
  const before = [];
  const after = [];
  const read = [];
  const started = [];
  const ended = [];
  const computer = {
    signInPage: async () => ({ url, inChain, startedFrom: inChain ? startedFrom : "" }),
    startSignIn: async (_computerId, address) => {
      started.push(address);
      return { url: address, title: "Sign in", text: "Sign in", screenshot: "shot" };
    },
    endSignIn: async (computerId) => {
      ended.push(computerId);
    },
    fill: async (_computerId, values) => {
      typed.push(values);
      return { filled: ["code"], url, screenshot: "shot" };
    }
  };
  const integrations = {
    reachableAccounts: async () =>
      accounts || [
        { id: "1", pluginId: "gmail", label: "pat@example.org", name: "Pat", home: false },
        { id: "2", pluginId: "outlook", label: "office@example.org", name: "Office", home: true }
      ],
    connections: {
      accessToken: async (_reach, id) => {
        read.push(id);
        return { accessToken: `key-${id}` };
      }
    },
    toolSwitches: async () => ({ skip: {}, removed: [], turnedOff: [] })
  };
  const reach = { userId: "7", homeId: "3", personal: true };
  const appFor = () => ({ integrations, reach, skip: [], call: {} });
  const turns = { messages: async () => said.map((text) => ({ body: { text } })) };
  const signIns = buildSignInCodeTools({
    appFor,
    computer,
    computerId: "11",
    conversationId: "11",
    turns,
    call: {},
    inTime: (work) => work,
    before,
    after,
    askFirst: (card) => after.push({ kind: "choice", role: "bot", body: { purpose: "approval", ...card } }),
    screenshots: [],
    untrusted: (text) => text,
    wait: { minutes: 10, tries: 1, everyMs: 0 }
  });
  // The approved card's action runs with the person's reach, on the same computer (botCards.answerChoice).
  const approve = (args) => SIGN_IN_CODE_ACTIONS.fill_sign_in_code.run({ integrations, reach, call: {}, computer, conversationId: "11" }, args);
  return { tool: signIns.tools.fillSignInCode, start: signIns.tools.startSignIn, finished: signIns.finished, approve, typed, before, after, read, started, ended };
}

test("a code the site emailed is typed into its page from the person's own inbox, never shown, and only the site's own mail counts", async (context) => {
  const calls = fakeMail(context, {
    "/messages?q=after": { messages: [{ id: "m-phish" }, { id: "m-code" }, { id: "m-old" }] },
    "/messages/m-phish?format=metadata": {
      internalDate: String(now - 30_000),
      payload: { headers: [header("From", "Example Support <help@example-login.net>"), header("Subject", "Your Example code")] }
    },
    "/messages/m-code?format=metadata": {
      internalDate: String(now - 60_000),
      payload: { headers: [header("From", "Example <no-reply@mail.example.com>"), header("Subject", "Your sign-in code")] }
    },
    "/messages/m-old?format=metadata": {
      internalDate: String(now - 60 * 60_000),
      payload: { headers: [header("From", "Example <no-reply@example.com>"), header("Subject", "Your sign-in code")] }
    },
    "/messages/m-code?format=full": {
      payload: {
        mimeType: "text/plain",
        headers: [header("Subject", "Your sign-in code")],
        body: { data: Buffer.from("Your verification code is 604217.").toString("base64url") }
      }
    }
  });
  const { tool, typed, before, read } = signInTool();
  const result = await tool.execute({ site: "example.com" });
  assert.equal(result.status, "filled");
  assert.deepEqual(typed, [{ site: "example.com", code: "604217", inChain: true }], "the newest code from the site itself, only into the sign-in's chain");
  assert.ok(!JSON.stringify(result).includes("604217"), "the bot never sees the code");
  assert.deepEqual(before.map((message) => message.body.text), ["Typed in the sign-in code from your email"]);
  assert.ok(!JSON.stringify(before).includes("604217"), "nor does the chat");
  assert.deepEqual(read, ["1"], "only the person's own mailbox is opened, never the home's");
  assert.ok(!calls.some((call) => call.url.includes("m-phish?format=full")), "mail from another domain isn't read");
  const after = Number(/after%3A(\d+)/u.exec(calls[0].url)?.[1]);
  assert.ok(Math.abs(after - (now - 10 * 60_000) / 1000) < 30, "only the last few minutes' mail");
});

test("a page on another site gets no code, and with nothing found the bot uses the secure form", async (context) => {
  const calls = fakeMail(context, { "/messages?q=after": { messages: [] } });
  const elsewhere = signInTool({ url: "https://evil.example.net/login" });
  const refused = await elsewhere.tool.execute({ site: "example.com" });
  assert.match(refused.error, /isn't on example\.com/u);
  assert.equal(calls.length, 0, "no mail is read for a site the page isn't on");
  assert.deepEqual(elsewhere.typed, []);

  const empty = signInTool();
  const none = await empty.tool.execute({ site: "example.com" });
  assert.equal(none.status, "no code found");
  assert.match(none.note, /ask_for_login with kind code/u);
  assert.deepEqual(empty.typed, []);

  const noInbox = signInTool({ accounts: [{ id: "2", pluginId: "outlook", label: "office@example.org", home: true }] });
  const without = await noInbox.tool.execute({ site: "example.com" });
  assert.equal(without.status, "no inbox to check", "a home's mailbox isn't the person's own");
});

test("the code is typed only into a page of the site that sent it, whatever site the bot names", async (context) => {
  const calls = fakeMail(context, {
    "/messages?q=after": { messages: [{ id: "m-bank" }] },
    "/messages/m-bank?format=metadata": {
      internalDate: String(now - 30_000),
      payload: { headers: [header("From", "Bank <codes@bank.ltd.uk>"), header("Subject", "Your sign-in code")] }
    },
    "/messages/m-bank?format=full": {
      payload: { mimeType: "text/plain", headers: [header("Subject", "Your sign-in code")], body: { data: Buffer.from("Your code is 604217.").toString("base64url") } }
    }
  });
  // A page on a site registered beside the bank's, under the same public suffix, gets none of its codes.
  const beside = signInTool({ url: "https://attacker.ltd.uk/verify" });
  assert.equal((await beside.tool.execute({ site: "attacker.ltd.uk" })).status, "no code found");
  assert.ok(!calls.some((call) => call.url.includes("m-bank?format=full")), "the bank's mail isn't opened for it");
  // Naming a suffix, or a site the page isn't registered as, gets nothing either.
  for (const site of ["ltd.uk", "uk", "bank.ltd.uk"]) {
    assert.match((await beside.tool.execute({ site })).error, /isn't on/u, site);
  }
  assert.deepEqual(beside.typed, []);
  // On the bank's own page, the code is typed in for the bank's site, the one its mail came from.
  const bank = signInTool({ url: "https://login.bank.ltd.uk/verify" });
  assert.equal((await bank.tool.execute({ site: "https://www.login.bank.ltd.uk/verify" })).status, "filled");
  assert.deepEqual(bank.typed, [{ site: "bank.ltd.uk", code: "604217", inChain: true }]);
});

/** Gmail holding one code email from `from`, and one from another sender of the same site. */
function codeMail(context, from = "Forms <no-reply@example.com>") {
  return fakeMail(context, {
    "/messages?q=after": { messages: [{ id: "m-code" }, { id: "m-other" }] },
    "/messages/m-code?format=metadata": {
      internalDate: String(now - 30_000),
      payload: { headers: [header("From", from), header("Subject", "Your verification code")] }
    },
    "/messages/m-other?format=metadata": {
      internalDate: String(now - 10_000),
      payload: { headers: [header("From", "Someone <someone@example.com>"), header("Subject", "Your code")] }
    },
    "/messages/m-code?format=full": {
      payload: { mimeType: "text/plain", headers: [header("Subject", "Your verification code")], body: { data: Buffer.from("Your code is 604217.").toString("base64url") } }
    },
    "/messages/m-other?format=full": {
      payload: { mimeType: "text/plain", headers: [header("Subject", "Your code")], body: { data: Buffer.from("Your code is 111222.").toString("base64url") } }
    }
  });
}

test("a page the sign-in didn't lead to gets a card with its full address and the sender, and nothing is typed until they say yes", async (context) => {
  codeMail(context);
  // A form someone published on the same site, which the bot opened itself: registered as example.com like the codes.
  const url = "https://docs.example.com/forms/d/e/1FAIpQLSf-form/viewform?usp=sf_link";
  const outside = signInTool({ url, inChain: false });
  const asked = await outside.tool.execute({ site: "example.com" });
  assert.equal(asked.status, "waiting_for_approval");
  assert.deepEqual(outside.typed, [], "nothing is typed");
  const [card] = outside.after;
  assert.equal(card.body.question, "Shall I type the sign-in code from someone@example.com into this page?", "the newest code's sender");
  assert.equal(card.body.subline, url, "the page's full address");
  assert.deepEqual(card.body.action, { id: "fill_sign_in_code", args: { url, site: "example.com", from: "someone@example.com" } });
  assert.ok(!JSON.stringify([asked, outside.after]).includes("111222"), "the code is in neither the card nor the bot's answer");
  assert.equal((await outside.tool.execute({ site: "example.com" })).note, "The card asking them is already there; stop here.", "one card");

  // Yes: the newest code from that sender, read again, goes into that page only.
  const said = await outside.approve(card.body.action.args);
  assert.equal(said.body.text, "Typed in the sign-in code from your email");
  assert.deepEqual(outside.typed, [{ site: "example.com", code: "111222", onlyAt: url }]);
  assert.ok(!JSON.stringify(said).includes("111222"));
  // A yes for one sender never types another sender's code from the same site.
  const other = signInTool({ url, inChain: false });
  await other.approve({ url, site: "example.com", from: "no-reply@example.com" });
  assert.deepEqual(other.typed, [{ site: "example.com", code: "604217", onlyAt: url }]);
  // A page in the chain of a sign-in to another site (where "Sign in with Google" led): its own site's code needs a yes too.
  const elsewhere = signInTool({ url, startedFrom: "https://www.example.org/" });
  assert.equal((await elsewhere.tool.execute({ site: "example.com" })).status, "waiting_for_approval");
  assert.deepEqual(elsewhere.typed, []);
  // With nothing from that sender any more, nothing is typed and the chat says so.
  const none = signInTool({ url, inChain: false });
  const missed = await none.approve({ url, site: "example.com", from: "nobody@example.com" });
  assert.equal(missed.body.text, "Couldn't type in the sign-in code");
  assert.deepEqual(none.typed, []);
});

test("a sign-in starts its chain only for a site the person named, from its front page, and ends with the turn unless they're needed", async () => {
  const named = signInTool({ said: ["Can you sign in to my Origin Energy account and get the last bill?"] });
  const opened = await named.start.execute({ address: "https://www.originenergy.com.au/" });
  assert.equal(opened.url, "https://www.originenergy.com.au/");
  assert.match(
    (await named.start.execute({ address: "https://www.originenergy.com.au/login" })).error,
    /front page, https:\/\/originenergy\.com\.au\//u,
    "deeper in the site, where someone else could have published the page, it doesn't start"
  );
  assert.deepEqual(named.started, ["https://www.originenergy.com.au/"]);
  await named.finished();
  assert.deepEqual(named.ended, ["11"], "nothing waits on the person, so the sign-in is over");

  // An address the person wrote themselves starts one wherever it is.
  const written = signInTool({ said: ["Log in at originenergy.com.au/my-account/login please"] });
  await written.start.execute({ address: "originenergy.com.au/my-account/login" });
  assert.deepEqual(written.started, ["https://originenergy.com.au/my-account/login"]);

  // A site the person never named doesn't start one: an email or a page can't have the bot open a chain for it. Nor
  // does a page someone published on a site they did name.
  const unnamed = signInTool({ said: ["Check my mail for anything urgent"] });
  assert.match((await unnamed.start.execute({ address: "https://docs.google.com/forms/d/e/1FAIpQL/viewform" })).error, /hasn't asked for a sign-in to google\.com/u);
  const google = signInTool({ said: ["Sign in to Google and check my storage"] });
  assert.match((await google.start.execute({ address: "https://docs.google.com/forms/d/e/1FAIpQL/viewform" })).error, /front page/u);
  assert.deepEqual([...unnamed.started, ...google.started], []);
  await unnamed.finished();
  assert.deepEqual(unnamed.ended, [], "a turn that never worked on a sign-in leaves the computer alone");

  // Waiting on the person (the secure form here) keeps the chain for the next turn.
  const waiting = signInTool();
  await waiting.start.execute({ address: "example.com" });
  assert.deepEqual(waiting.started, ["https://example.com"]);
  waiting.after.push({ kind: "secure_form", role: "bot", body: { site: "example.com", form: "login", status: "pending" } });
  await waiting.finished();
  assert.deepEqual(waiting.ended, []);
});

test("the person's words name a site by its address or its name", () => {
  assert.ok(namesSite("sign in to example.com please", "example.com"));
  assert.ok(namesSite("Log into Example and pay the bill", "example.com"));
  assert.ok(namesSite("my Origin Energy bill", "originenergy.com.au"));
  assert.ok(namesSite("open my-bank", "my-bank.co.uk"));
  assert.ok(namesSite("check someone's site", "someone.github.io"));
  assert.ok(!namesSite("sign in to my bank", "example.com"));
  assert.ok(!namesSite("the examples folder", "example.com"), "a whole word or words, not part of one");
  assert.ok(!namesSite("", "example.com"));
});

test("sign-in codes and coding are offered only on the person's own turn in their own chat with their bot", () => {
  const offered = (options) => {
    const { tools } = buildTools(turnDoubles({ approvals: {}, computer: {}, homeId: "1", userId: "7", botId: "3", conversationId: "5", ...options }));
    return ["startSignIn", "fillSignInCode", "startCoding"].filter((name) => name in tools);
  };
  assert.deepEqual(offered({}), ["startSignIn", "fillSignInCode", "startCoding"], "their own turn");
  // A routine never types a code: without these it uses the secure form, which tells the person.
  assert.deepEqual(offered({ routineRun: true }), [], "a routine, a watch run or a button's task: they aren't there");
  assert.deepEqual(offered({ routineRun: true, appsVia: { kind: "watch" } }), [], "a watch run, which others' app data sets off");
  assert.deepEqual(offered({ viaBot: true }), [], "work another bot asked for");
  assert.deepEqual(offered({ personal: false }), [], "a shared room");
  assert.deepEqual(offered({ computerId: "9" }), ["startSignIn", "fillSignInCode"], "coding only on the computer of their own chat");
});
