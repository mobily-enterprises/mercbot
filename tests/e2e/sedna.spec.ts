import { HOME, connectTestDb, directChat, expect, expectRefusal, homeApi, openShell, seedMessage, shell, test } from "./harness";

// Sedna connected with the home's API credentials (D-93), on the Test Preview target, whose Sedna is a local stand-in
// (tests/support/fakeSedna.mjs, the `acme` organisation): the owner enters the credentials in Connect apps, a wrong
// secret is refused in the form, the right ones connect it, and the owner, whom no Sedna user knows by this copy's
// address, picks their own Sedna user. Bots reading Sedna, and members' picks waiting for an owner or admin, are proven
// in the server tests (sednaTools.test.js, sednaCredentials.integration.js). A Sedna draft card's Send in a bot's direct
// chat (D-112), which a test copy only logs (D-94), is the second test; Sedna's other writes are in sednaWrites.test.js
// and sednaWrites.integration.js. Run with: vibe64-helper playwright --target test-app test tests/e2e/sedna.spec.ts
test.describe.configure({ mode: "serial" });
// Any refused API call from the page, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

test("the owner enters Sedna's API credentials in Connect apps, then picks who they are in Sedna", async ({ page }) => {
  const knex = connectTestDb();
  const clear = async () => {
    await knex("plugin_accounts").where({ plugin_id: "sedna" }).del();
    await knex("home_plugins").where({ plugin_id: "sedna" }).del();
  };
  try {
    await clear();
    await openShell(page);
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
  const knex = connectTestDb();
  const clear = async () => {
    await knex("plugin_accounts").where({ plugin_id: "sedna" }).del();
    await knex("home_plugins").where({ plugin_id: "sedna" }).del();
  };
  const api = await homeApi(page);
  let botId = "";
  try {
    await clear();
    // Sedna connected and the owner picked as Sam Poe, as the first test does on screen.
    await api.post("/plugins/sedna/install", {});
    const accountId = String((await knex("plugin_accounts").where({ plugin_id: "sedna" }).first()).id);
    await api.post(`/plugin-accounts/${accountId}/credentials`, { tenant: "acme", clientId: "acme-client", clientSecret: "acme-secret" });
    await api.put(`/plugin-accounts/${accountId}/people/me`, { appUserId: "203" });

    // The draft a bot leaves in the person's direct chat with it, past its greeting.
    const name = `Sedna card ${Date.now().toString(36)}`;
    const { bot } = await api.post("/bots", { name, color: "#1E86FC" });
    botId = String(bot.id);
    const chat = await directChat(page, botId);
    await knex("conversations").where({ id: chat.id }).update({ onboarding_step: null });
    const { workspace_id: homeId } = await knex("conversations").where({ id: chat.id }).first();
    await seedMessage(knex, {
      homeId, chatId: chat.id, kind: "draft", botId,
      body: {
        from: "Sam Poe · Chartering (Sedna)", to: "Kim Broker <kim@brokers.example>", subject: "Re: Fixture recap VOY-101", text: "Kim, laycan works.", status: "pending",
        inReplyTo: { from: "Kim Broker", subject: "Fixture recap VOY-101" }, sedna: { team: { id: "11", name: "Chartering" }, replyTo: "1001" }
      }
    });

    await openShell(page);
    await shell.chatRow(page, name).click();
    const card = shell.chat(page).getByRole("region", { name: "Draft to Kim Broker <kim@brokers.example>" });
    await expect(card.locator(".mb-draft__head")).toHaveText("Sedna");
    await expect(card).toContainText("Sam Poe · Chartering (Sedna)");
    await expect(card).toContainText("Goes out as a new message with theirs quoted below: Sedna may show it outside that conversation's thread.");
    await card.getByRole("textbox", { name: "Message" }).fill("Kim, laycan 3-5 Dec works for owners.");
    await card.getByRole("button", { name: "Send" }).click();
    await expect(card.locator(".mb-draft__fold")).toContainText("Logged, not sent (test copy) · Kim Broker <kim@brokers.example>");
    await expect(shell.chat(page)).toContainText("Sent from Sedna: Re: Fixture recap VOY-101");
    const saved = await knex("messages").where({ conversation_id: chat.id, kind: "draft" }).first();
    expect([saved.body.status, saved.body.simulated, saved.body.text]).toEqual(["sent", true, "Kim, laycan 3-5 Dec works for owners."]);
  } finally {
    // Left first, so the page doesn't go on reading the bot once it's gone (the API guard would see that).
    await page.goto("about:blank");
    if (botId) await api.answer("DELETE", `/bots/${botId}`);
    await clear();
    await knex.destroy();
  }
});
