import knexLib from "knex";
import { expect, expectRefusal, test, testDatabaseName, type Page } from "./harness";

// Sedna connected with the home's API credentials (D-93), on the Test Preview target, whose Sedna is a local stand-in
// (tests/support/fakeSedna.mjs, the `acme` organisation): the owner enters the credentials in Connect apps, a wrong
// secret is refused in the form, the right ones connect it, and the owner, whom no Sedna user knows by this copy's
// address, picks their own Sedna user. Bots reading Sedna, and members' picks waiting for an owner or admin, are proven
// in the server tests (sednaTools.test.js, sednaCredentials.integration.js).
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
    await knex("user_plugins").where({ plugin_id: "sedna" }).del();
  };
  try {
    await clear();
    await openHome(page);
    await page.keyboard.press("Control+Alt+w");
    const modal = page.locator(".mb-apps-modal");
    await modal.getByRole("textbox", { name: "Search apps and skills" }).fill("Sedna");
    await modal.getByRole("listbox").getByRole("button", { name: "Sedna", exact: true }).click();
    const head = modal.locator(".mb-detail__head");
    await expect(head.getByRole("heading", { level: 2 })).toContainText("Sedna");
    await head.getByRole("button", { name: "Connect", exact: true }).click();

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

    // Disconnecting clears the credentials.
    const row = modal.locator(".mb-detail__row").filter({ hasText: "Acme Shipping" });
    await row.getByRole("button", { name: "Disconnect" }).click();
    await modal.locator(".mb-detail__row").getByRole("button", { name: "Disconnect" }).click();
    await expect(modal.locator(".mb-detail__row").getByRole("button", { name: "Enter API credentials" })).toBeVisible();
    const cleared = await knex("plugin_accounts").where({ id: accountId }).first();
    expect([cleared.status, cleared.tokens]).toEqual(["needs-auth", null]);
    await expect(people).toBeHidden();
  } finally {
    await clear();
    await knex.destroy();
  }
});
