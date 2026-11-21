import assert from "node:assert/strict";
import test from "node:test";
import { HIDDEN_CODE, HIDDEN_LINK, SECRETS_HIDDEN, hiddenInEmail, hideSignInSecrets } from "../../packages/bots/src/server/signInSecrets.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { turnDoubles } from "../support/botDoubles.mjs";
import { accessOf } from "../support/appKey.mjs";

// A bot sees sign-in codes and sign-in links only in mailboxes the person whose turn it is connected (D-111): in every
// other mailbox of the home the mail tools hide them as they read. It's a heuristic, read from the words; these are
// realistic emails of both kinds.

const hidden = (text, options) => hideSignInSecrets(text, options).text;

test("sign-in codes and links in realistic emails are hidden", () => {
  assert.equal(hidden("G-482913 is your Google verification code."), `${HIDDEN_CODE} is your Google verification code.`, "Google's, prefix and all");
  assert.equal(
    hidden("Your one-time password (OTP) is:\n\n482913\n\nDon't share this OTP with anyone. Amazon will never ask for it."),
    `Your one-time password (OTP) is:\n\n${HIDDEN_CODE}\n\nDon't share this OTP with anyone. Amazon will never ask for it.`,
    "Amazon's, on the line after the one that names it"
  );
  assert.equal(hidden("Your Microsoft account security code is 7391"), `Your Microsoft account security code is ${HIDDEN_CODE}`);
  assert.equal(hidden("Your verification code is 593 021."), `Your verification code is ${HIDDEN_CODE}.`, "a code in two groups");
  assert.equal(hidden("Enter AB12CD on the page to confirm your login."), `Enter ${HIDDEN_CODE} on the page to confirm your login.`);
  assert.equal(
    hidden("Sign in to Slack\nClick below to sign in to Acme.\nhttps://app.slack.com/t/acme/z-app-123/magic-login/aBcDeF?x=1\nThis link expires in 24 hours."),
    `Sign in to Slack\nClick below to sign in to Acme.\n${HIDDEN_LINK}\nThis link expires in 24 hours.`,
    "Slack's magic link"
  );
  assert.equal(
    hidden("We got a request to change your password.\n\nhttps://accounts.example.com/r/9f8e7d6c"),
    `We got a request to change your password.\n\n${HIDDEN_LINK}`,
    "a reset link under the line that asks"
  );
  assert.equal(hidden("Finish setting up: https://example.com/auth/callback?token=abc123"), `Finish setting up: ${HIDDEN_LINK}`, "an address that is itself a sign-in");
  // An email whose subject names a sign-in: its first lines count as following it.
  assert.equal(hidden("Here it is:\n\n839201", { primed: true }), `Here it is:\n\n${HIDDEN_CODE}`);
});

test("ordinary numbers, references and links in realistic emails stay", () => {
  for (const text of [
    "Booking reference ABC123 for your flight on 12 March at 14:30. Total $412.50.",
    "Your order #112-3456789-1234567 has shipped. Track it: https://www.amazon.com/progress-tracker/package?orderId=112",
    "Meeting moved to 10:30 in room 4021. Dial in on 0800 123 456.",
    "Invoice INV-2026-0042 for $1,250.00 is attached; it's due on 2026-12-01.",
    "This week's newsletter: https://news.example.com/articles/2026/11/winter-garden",
    "Call me on +61 412 345 678 after 5.",
    // Security alerts talk of signing in, with only dates and times in them.
    "New sign-in to your account on 21 Nov 2026 at 09:14 from Chrome on Windows.",
    "Security alert: a new device signed in at 10:42 AM, 21 November 2026",
    "Your login code expires at 14:30 on 21/11/2026.",
    "Your PIN was changed on 2026-11-21"
  ]) {
    assert.deepEqual(hideSignInSecrets(text), { text, hidden: 0 }, text);
  }
});

test("an email from someone else's mailbox says what was hidden; one with nothing to hide is unchanged", () => {
  const code = { id: "m1", from: "Google <no-reply@accounts.google.com>", subject: "G-482913 is your Google verification code", snippet: "G-482913 is your Google verification code", text: "Hi Pat,\n\nG-482913 is your Google verification code." };
  const shown = hiddenInEmail(code);
  assert.equal(shown.subject, `${HIDDEN_CODE} is your Google verification code`);
  assert.doesNotMatch(JSON.stringify(shown), /482913/u);
  assert.equal(shown.signInHidden, SECRETS_HIDDEN);
  assert.equal(shown.from, code.from, "who it's from stays");
  const ordinary = { id: "m2", subject: "Lunch on Friday?", snippet: "Table for 4 at 12:30", text: "Table for 4 at 12:30, booking ref ABC123." };
  assert.deepEqual(hiddenInEmail(ordinary), ordinary);
});

/** A turn of Pat's (person 7) whose home has Pat's Gmail and the Gmail Kim (person 8) connected. */
function patsTurn() {
  const accounts = [
    { id: "1", pluginId: "gmail", name: "", label: "pat@example.org", status: "connected", userId: "7" },
    { id: "2", pluginId: "gmail", name: "", label: "kim@example.org", status: "connected", userId: "8" }
  ];
  const integrations = {
    reachableAccounts: async (_call, filters = {}) => accounts.filter((entry) => !filters.pluginIds || filters.pluginIds.includes(entry.pluginId)),
    connections: { accessToken: async (id) => accessOf(`key-${id}`) }
  };
  const seat = { id: "3", workspace_id: "1", user_id: "7", chat_id: "5", chat_bot_id: "11", chat: { id: "5", kind: "public" } };
  return buildTools(turnDoubles({ approvals: {}, computer: {}, seat, integrations, call: { context: { actor: { id: "7" } } } })).tools;
}

/** Gmail's API as a stand-in, every mailbox holding the same sign-in email. */
function fakeGmail(context) {
  const original = globalThis.fetch;
  const subject = "G-482913 is your Google verification code";
  const headers = [{ name: "From", value: "Google <no-reply@accounts.google.com>" }, { name: "Subject", value: subject }, { name: "Date", value: "Fri, 21 Nov 2026 09:00:00 +0800" }];
  globalThis.fetch = async (url) => {
    const address = String(url);
    const body = address.includes("/messages?")
      ? { messages: [{ id: "m1" }] }
      : address.includes("format=metadata")
        ? { snippet: `${subject}. Don't share it.`, payload: { headers } }
        : { threadId: "t1", payload: { mimeType: "text/plain", headers, body: { data: Buffer.from(`Hi,\n\n${subject}.\n\nOr sign in here: https://accounts.google.com/signin/magic?token=abc`).toString("base64url") } } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  context.after(() => { globalThis.fetch = original; });
}

test("search_email and read_email hide sign-in codes and links in a mailbox someone else connected, not in the person's", async (context) => {
  fakeGmail(context);
  const tools = patsTurn();
  const found = await tools.searchEmail.execute({ query: "newer_than:1d" });
  const byMailbox = Object.fromEntries(found.mailboxes.map((mailbox) => [mailbox.address, mailbox.emails[0]]));
  assert.match(byMailbox["pat@example.org"].subject, /G-482913/u, "Pat's own mailbox, on Pat's turn: as it is");
  assert.equal(byMailbox["pat@example.org"].signInHidden, undefined);
  assert.doesNotMatch(JSON.stringify(byMailbox["kim@example.org"]), /482913/u, "Kim's mailbox: no code");
  assert.equal(byMailbox["kim@example.org"].signInHidden, SECRETS_HIDDEN);

  const kims = await tools.readEmail.execute({ id: "m1", account: "kim@example.org" });
  assert.doesNotMatch(JSON.stringify(kims), /482913|token=abc/u, "nor its text's code or link");
  assert.equal(kims.signInHidden, SECRETS_HIDDEN);
  const pats = await tools.readEmail.execute({ id: "m1", account: "pat@example.org" });
  assert.match(JSON.stringify(pats), /482913/u);
  assert.match(JSON.stringify(pats), /token=abc/u);
});
