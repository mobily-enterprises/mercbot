import knexLib from "knex";
import { seal } from "../../packages/account/src/server/vaultCrypto.js";
import { expect, test, testDatabaseName, type Page } from "./harness";

// The general connector's first apps in Connect apps (D-34), and unlinking this copy from Settings (D-31), on the Test
// Preview target's fixtures. Signing in to the apps themselves needs a real account (the owner's five-minute test,
// docs/apps.md); the server tests prove the sign-in against a stand-in app (tests/server/connector.integration.js).
const HOME = "/w/you";
test.describe.configure({ mode: "serial" });
// Any refused API call from the page, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

// The home page, past the first-run introduction a new account sees there once.
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

test("Connect apps offers Calendly, Notion and Todoist to connect, in beta, no longer coming soon", async ({ page }) => {
  await openHome(page);
  await page.keyboard.press("Control+Alt+w");
  const modal = page.locator(".mb-apps-modal");
  await expect(modal.getByRole("heading", { name: "Connect apps", level: 2 })).toBeVisible();
  for (const app of ["Calendly", "Notion", "Todoist"]) {
    await modal.getByRole("textbox", { name: "Search apps and skills" }).fill(app);
    await modal.getByRole("listbox").getByRole("button", { name: app, exact: true }).click();
    const head = modal.locator(".mb-detail__head");
    await expect(head.getByRole("heading", { level: 2 })).toContainText(app);
    await expect(head.locator(".mb-badge")).toHaveText("b");
    await expect(head.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
    await expect(modal.locator(".mb-detail__soon")).toHaveCount(0);
    await expect(modal.locator(".mb-detail__info").filter({ hasText: "Availability" })).toContainText("Not added yet");
    await modal.getByRole("button", { name: "Connect apps", exact: true }).click();
  }
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
});

// Reopening Connect apps reads the list again while the screen still shows the one it had, so a person can use it at
// once. An answer that comes meanwhile (here Request's; when trying the connector, Connect's, whose account then
// vanished behind "Tasks is connected") is newer than that read, and stays when the read lands. The read is held back
// here until after Request has answered; a private skill added to it shows, under Your apps and skills, when it has
// landed.
test("a read of Connect apps that lands late never undoes what was done meanwhile", async ({ page }) => {
  const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });
  try {
    await knex("app_interest").where({ plugin_id: "dropbox" }).del();
    await openHome(page);
    const modal = page.locator(".mb-apps-modal");
    const search = modal.getByRole("textbox", { name: "Search apps and skills" });
    await page.keyboard.press("Control+Alt+w");
    await search.fill("Dropbox");
    await expect(modal.getByRole("listbox").getByRole("button", { name: "Dropbox", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();

    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**/api${HOME}/plugins`, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const json = await response.json();
      json.skills = [...(json.skills || []), { id: "late-read", name: "late-read", description: "the late read has landed" }];
      await held;
      await route.fulfill({ response, json });
    });
    await page.keyboard.press("Control+Alt+w");
    await search.fill("Dropbox");
    await modal.getByRole("listbox").getByRole("button", { name: "Dropbox", exact: true }).click();
    const head = modal.locator(".mb-detail__head");
    await head.getByRole("button", { name: "Request", exact: true }).click();
    await expect(head.getByRole("button", { name: "Requested", exact: true })).toBeVisible();

    release();
    await modal.getByRole("button", { name: "Connect apps", exact: true }).click();
    await modal.getByRole("button", { name: /\d+ connected$/u }).click();
    await expect(modal.getByRole("heading", { name: "Your apps and skills", level: 2 })).toBeVisible();
    await expect(modal.getByRole("button", { name: /late-read/u })).toBeVisible();
    await modal.getByRole("button", { name: "Connect apps", exact: true }).click();
    await search.fill("Dropbox");
    await modal.getByRole("listbox").getByRole("button", { name: "Dropbox", exact: true }).click();
    await expect(head.getByRole("button", { name: "Requested", exact: true })).toBeVisible();
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await knex("app_interest").where({ plugin_id: "dropbox" }).del();
    await knex.destroy();
  }
});

// The person who linked this copy has left (their account is gone), so the home's owner may unlink it, after saying so
// in the row itself; the home's Activity trail records who did. The hub's address answers nothing, as unlinking allows.
test("a home's owner unlinks this copy from Settings, and Activity says who did", async ({ page }) => {
  const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });
  try {
    await knex("bridge_link").del();
    const key = Buffer.from(String(process.env.MERCBOT_VAULT_KEY), "base64");
    await knex("bridge_link").insert({ hub_url: "http://127.0.0.1:9", name: "Lee's laptop", linked_by: null, token: seal("e2e-install-token", key) });
    await openHome(page);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Mercbot account");
    await page.keyboard.press("Enter");
    const settings = page.getByRole("dialog", { name: "Settings" });
    const row = settings.locator(".mb-set-row").filter({ hasText: "Linked to 127.0.0.1:9" });
    await expect(row).toContainText("Linked to 127.0.0.1:9 as “Lee's laptop”");
    await row.getByRole("button", { name: "Unlink" }).click();
    await expect(row).toContainText("Sign out every account connected through 127.0.0.1:9?");
    await row.getByRole("button", { name: "Keep" }).click();
    await expect(row.getByRole("button", { name: "Keep" })).toHaveCount(0);
    await row.getByRole("button", { name: "Unlink" }).click();
    await row.getByRole("button", { name: "Unlink" }).click();
    await expect(settings.getByText("Not linked", { exact: true })).toBeVisible();
    expect(await knex("bridge_link")).toHaveLength(0);

    await page.goto(`${HOME}/apps?tab=activity`);
    const entry = page.locator(".v-card").filter({ hasText: "unlinked this copy of Mercbot" });
    await expect(entry).toContainText("unlinked this copy of Mercbot (“Lee's laptop”) from 127.0.0.1:9");
    await expect(entry).toContainText(/Settings ·/u);
  } finally {
    await knex("bridge_link").del();
    await knex("audit_events").whereRaw("changes \\? 'unlinkedCopy'").del();
    await knex.destroy();
  }
});
