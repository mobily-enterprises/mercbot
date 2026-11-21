import knexLib from "knex";
import { expect, expectRefusal, test, testDatabaseName, type Page } from "./harness";

// Sedna connected with the home's API credentials (D-93), on the Test Preview target, whose Sedna is a local stand-in
// (tests/support/fakeSedna.mjs, the `acme` organisation): the owner enters the credentials in Connect apps, a wrong
// secret is refused in the form, the right ones connect it, and the owner, whom no Sedna user knows by this copy's
// address, picks their own Sedna user. Bots reading Sedna, and members' picks waiting for an owner or admin, are proven
// in the server tests (sednaTools.test.js, sednaCredentials.integration.js). A Sedna draft card's Send, which a test copy
// only logs (D-94), is the second test; Sedna's other writes are in sednaWrites.test.js and sednaWrites.integration.js.
const HOME = "/w/you";
test.describe.configure({ mode: "serial" });
// Any refused API call from the page, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

async function openHome(page: Page) {
  await page.goto(HOME);
  const next = page.getByRole("button", { name: "Next" });
  const shell = page.locator(".mb-shell");
  await expect(shell.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shell).toBeVisible();
}

test("the owner enters Sedna's API credentials in Connect apps, then picks who they are in Sedna", async ({ page }) => {
  const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });
  const clear = async () => {
    await knex("plugin_accounts").where({ plugin_id: "sedna" }).del();
    await knex("home_plugins").where({ plugin_id: "sedna" }).del();
  };
  try {
    await clear();
    await openHome(page);
    await page.keyboard.press("Control+Shift+m");
    const modal = page.locator(".mb-apps-modal");
    await modal.getByRole("textbox", { name: "Search apps and skills" }).fill("Sedna");
    await modal.getByRole("listbox").getByRole("button", { name: "Sedna", exact: true }).click();
    const head = modal.locator(".mb-detail__head");
    await expect(head.getByRole("heading", { level: 2 })).toContainText("Sedna");
    await head.getByRole("button", { name: "Add to this home", exact: true }).click();

    // No sign-in tab: the form for the credentials, with where to make them.
    const form = modal.getByRole("form", { name: "Sedna API credentials" });
    await expect(form).toBeVisible();
    await expect(form).toContainText("API Credential Management");
    await form.getByRole("textbox", { name: "Sedna address" }).fill("acme");
    await expect(form.getByRole("link", { name: "Open Sedna's API Credential Management page" }))
      .toHaveAttribute("href", "https://acme.sednanetwork.com/platform/settings/api-credential-management");
    await form.getByRole("textbox", { name: "Client ID" }).fill("acme-client");
    await form.getByLabel("Client secret").fill("not-the-secret");
    const accountId = String((await knex("plugin_accounts").where({ plugin_id: "sedna" }).first()).id);
    expectRefusal(`400 POST /api${HOME}/plugin-accounts/${accountId}/credentials`);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByRole("alert")).toHaveText("Sedna didn't accept that client ID and secret for acme.sednanetwork.com. Check them in Sedna's API credential management.");
    expect((await knex("plugin_accounts").where({ id: accountId }).first()).status).toBe("needs-auth");

    await form.getByLabel("Client secret").fill("acme-secret");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(modal.locator(".mb-apps-toast")).toContainText("Sedna is connected as Acme Shipping.");
    await expect(form).toBeHidden();
    await expect(modal.locator(".mb-detail__row").filter({ hasText: "Acme Shipping" })).toContainText("Connected");

    // This copy's person is no one in Sedna by address: as the owner, their own pick is confirmed at once.
    const people = modal.getByRole("region", { name: "People in Sedna" });
    await expect(people).toContainText("No Sedna user has your email address");
    await people.getByRole("textbox", { name: "Find yourself in Sedna" }).fill("Sam");
    await people.getByRole("button", { name: "Find" }).click();
    await people.getByRole("listitem").filter({ hasText: "Sam Poe" }).getByRole("button", { name: "This is me" }).click();
    await expect(people).toContainText("Sam Poe, picked and confirmed. Your bots read only your Sedna teams: Chartering, Operations.");

    // Its Request pace (D-96): Gentle until the owner chooses another.
    const pace = modal.getByRole("region", { name: "Request pace for Sedna" });
    await expect(pace.getByRole("radio", { name: "Gentle" })).toBeChecked();
    await pace.getByRole("radio", { name: "Normal" }).click();
    await expect(pace.getByRole("radio", { name: "Normal" })).toBeChecked();
    expect((await knex("plugin_accounts").where({ id: accountId }).first()).pace).toBe("normal");

    // Its bin (D-110), after one more question in the line, forgets the credentials and who each person is in Sedna.
    const row = modal.getByTestId("account-line").filter({ hasText: "Acme Shipping" });
    await expect(row).toContainText(/Everyone in .+, and their bots, can use Acme Shipping\. Added by you\./u);
    await expect(row.getByRole("button", { name: "Change credentials" })).toBeVisible();
    await row.getByRole("button", { name: "Remove Acme Shipping" }).click();
    await expect(row).toContainText("Remove it for everyone in");
    await row.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(modal.getByTestId("account-line")).toHaveCount(0);
    expect(await knex("plugin_accounts").where({ id: accountId }).first()).toBeUndefined();
    expect(Number((await knex("plugin_account_people").where({ account_id: accountId }).count({ n: "*" }))[0].n)).toBe(0);
    await expect(people).toBeHidden();

    // Added again with the Add account step: the home's, and its credentials come next.
    await modal.getByRole("button", { name: "+ Add account" }).click();
    const step = modal.locator(".mb-add-account");
    await expect(step).toContainText(/Everyone in .+, and their bots, can use the account you connect\./u);
    await expect(step).not.toContainText("Who can use it");
    await expect(step).toContainText("You enter Sedna's API credentials next.");
    await expect(step.getByRole("radio")).toHaveCount(0);
    await step.getByRole("button", { name: "Add", exact: true }).click();
    await expect(modal.getByRole("form", { name: "Sedna API credentials" })).toBeVisible();
    await expect(modal.getByTestId("account-line")).toHaveCount(1);
  } finally {
    await clear();
    await knex.destroy();
  }
});

test("a Sedna draft card says its team and that a reply may land outside the thread; Send in a test copy only logs it", async ({ page }) => {
  const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });
  const clear = async () => {
    await knex("plugin_accounts").where({ plugin_id: "sedna" }).del();
    await knex("home_plugins").where({ plugin_id: "sedna" }).del();
  };
  let botId = "";
  let headers = {};
  try {
    await clear();
    await openHome(page);
    // Sedna connected and the owner picked as Sam Poe, as the first test does on screen.
    headers = { "csrf-token": (await (await page.request.get("/api/session")).json()).csrfToken };
    expect((await page.request.post(`/api${HOME}/plugins/sedna/install`, { headers, data: {} })).ok()).toBe(true);
    const accountId = String((await knex("plugin_accounts").where({ plugin_id: "sedna" }).first()).id);
    const connected = await page.request.post(`/api${HOME}/plugin-accounts/${accountId}/credentials`, { headers, data: { tenant: "acme", clientId: "acme-client", clientSecret: "acme-secret" } });
    expect(connected.ok()).toBe(true);
    expect((await page.request.put(`/api${HOME}/plugin-accounts/${accountId}/people/me`, { headers, data: { appUserId: "203" } })).ok()).toBe(true);

    const name = `Sedna card ${Date.now().toString(36)}`;
    const { bot } = await (await page.request.post(`/api${HOME}/bots`, { headers, data: { name, color: "#1E86FC" } })).json();
    botId = String(bot.id);
    const conversation = await knex("bot_conversations").where({ bot_id: bot.id }).whereNotNull("user_id").first();
    await knex("bot_conversations").where({ id: conversation.id }).update({ onboarding_step: null });
    await knex("bot_messages").insert({
      bot_id: bot.id, conversation_id: conversation.id, workspace_id: conversation.workspace_id, kind: "draft", role: "bot",
      body: {
        from: "Sam Poe · Chartering (Sedna)", to: "Kim Broker <kim@brokers.example>", subject: "Re: Fixture recap VOY-101", text: "Kim, laycan works.", status: "pending",
        inReplyTo: { from: "Kim Broker", subject: "Fixture recap VOY-101" }, sedna: { team: { id: "11", name: "Chartering" }, replyTo: "1001" }
      }
    });

    await openHome(page);
    await page.getByRole("navigation", { name: "Bots" }).getByRole("button", { name, exact: true }).click();
    const card = page.getByRole("region", { name: "Draft to Kim Broker <kim@brokers.example>" });
    await expect(card.locator(".mb-draft__head")).toHaveText("Sedna");
    await expect(card).toContainText("Sam Poe · Chartering (Sedna)");
    await expect(card).toContainText("Goes out as a new message with theirs quoted below: Sedna may show it outside that conversation's thread.");
    await card.getByRole("textbox", { name: "Message" }).fill("Kim, laycan 3-5 Dec works for owners.");
    await card.getByRole("button", { name: "Send" }).click();
    await expect(card.locator(".mb-draft__fold")).toContainText("Logged, not sent (test copy) · Kim Broker <kim@brokers.example>");
    await expect(page.getByRole("main", { name: "Chat" })).toContainText("Sent from Sedna: Re: Fixture recap VOY-101");
    const saved = await knex("bot_messages").where({ conversation_id: conversation.id, kind: "draft" }).first();
    expect([saved.body.status, saved.body.simulated, saved.body.text]).toEqual(["sent", true, "Kim, laycan 3-5 Dec works for owners."]);
  } finally {
    await page.goto("about:blank");
    if (botId) await page.request.delete(`/api${HOME}/bots/${botId}`, { headers });
    await clear();
    await knex.destroy();
  }
});
