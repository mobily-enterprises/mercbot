import knexLib from "knex";
import { expect, test, testDatabaseName, type Locator, type Page } from "./harness";

// One account workflow for every app (D-110), on the Test Preview target, whose Google is a local stand-in
// (tests/support/fakeDrive.mjs) that signs in as pat@example.com at once. In Connect apps exactly one control starts a
// sign-in, on the account step: Add to this home and + Add account only open it. The sign-in opens in a window of its
// own, which closes by itself once this tab has the result; on a phone it takes this tab and comes back. Every account is
// the home's (D-111): its line says in words that everyone in the home and their bots use it, and who added it, with no
// switch; its bin, Rename and Sign in again are for the person who added it and the home's owners and admins. The page a
// sign-in ends on has Close (or Try again) and a small Back to Mercbot. Run on Chromium, Firefox and WebKit (`--browser`).
const HOME = "/w/you";
const APP = "google-drive";
const ADDRESS = "pat@example.com";
// The controls that would start a sign-in, by what they say; the breadcrumb "Connect apps" only goes back.
const STARTS_SIGN_IN = /^(Sign in\b|Authorize$|Connect$|Reconnect$|Retry$)/u;
test.describe.configure({ mode: "serial" });
// Any refused API call from the page, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const database = () => knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });

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

/** Connect apps, on Google Drive's page. */
async function openDrive(page: Page) {
  await page.keyboard.press("Control+Shift+m");
  const modal = page.locator(".mb-apps-modal");
  await modal.getByRole("textbox", { name: "Search apps and skills" }).fill("Google Drive");
  await modal.getByRole("listbox").getByRole("button", { name: "Google Drive", exact: true }).click();
  await expect(modal.locator(".mb-detail__head").getByRole("heading", { level: 2 })).toContainText("Google Drive");
  return modal;
}

/** Every control in Connect apps that would start a sign-in, and those of them on the Add account step. */
async function signInControls(modal: Locator) {
  return [await modal.getByRole("button", { name: STARTS_SIGN_IN }).count(), await modal.locator(".mb-add-account").getByRole("button", { name: STARTS_SIGN_IN }).count()];
}

/**
 * The home's Google Drive accounts and its mark for the app set aside for the test and put back after it, so the other
 * specs on this Test Preview find them as they left them.
 */
async function asideDrive(knex: ReturnType<typeof database>) {
  const { id: homeId, owner_user_id: person, name: homeName } = await knex("workspaces").where({ slug: "you" }).first("id", "owner_user_id", "name");
  const mine = { workspace_id: homeId, plugin_id: APP };
  const accounts = await knex("plugin_accounts").where(mine);
  const marks = await knex("home_plugins").where(mine);
  await knex("plugin_accounts").where(mine).del();
  await knex("home_plugins").where(mine).del();
  return {
    homeId: String(homeId),
    homeName: String(homeName),
    person: String(person),
    restore: async () => {
      await knex("plugin_accounts").where(mine).del();
      await knex("home_plugins").where(mine).del();
      if (accounts.length) await knex("plugin_accounts").insert(accounts);
      if (marks.length) await knex("home_plugins").insert(marks);
    }
  };
}

test("one control starts a sign-in; its window closes by itself; the line says who uses it and who added it, and has its bin", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const knex = database();
  const aside = await asideDrive(knex);
  const everyone = (what: string) => `Everyone in ${aside.homeName}, and their bots, can use ${what}.`;
  let kimId = "";
  try {
    await openHome(page);
    const modal = await openDrive(page);
    const head = modal.locator(".mb-detail__head");

    // Not added: nothing on the page signs in; Add to this home adds it and opens the Add account step, whose one button
    // does. The step says plainly who will use the account, and asks nothing about it.
    await expect.poll(() => signInControls(modal)).toEqual([0, 0]);
    await expect(head.getByRole("button", { name: "Add to my apps" })).toHaveCount(0);
    await head.getByRole("button", { name: "Add to this home", exact: true }).click();
    const step = modal.locator(".mb-add-account");
    await expect(step).toBeVisible();
    await expect.poll(() => signInControls(modal)).toEqual([1, 1]);
    await expect(head.getByRole("button", { name: "Remove from this home" })).toBeVisible();
    await expect(step).toContainText("A Google window opens so you can pick the account.");
    await expect(step).toContainText(everyone("the account you connect"));
    await expect(step.getByRole("textbox", { name: "Label for the new account (optional)" })).toHaveValue("");
    await expect(step.getByRole("radiogroup")).toHaveCount(0);
    await expect(step.getByRole("radio")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("add-account-step.png") });

    // Signed in in a window of its own, which closes by itself; this tab shows the account connected, the home's.
    const opened = page.context().waitForEvent("page");
    await step.getByRole("button", { name: "Sign in with Google" }).click();
    const signIn = await opened;
    await expect.poll(() => signIn.isClosed(), { timeout: 15_000 }).toBe(true);
    expect(page.context().pages().length, "no other window stays open").toBe(1);
    const line = modal.getByTestId("account-line").filter({ hasText: ADDRESS });
    await expect(line).toContainText("Connected");
    await expect(line).toContainText(`${everyone(ADDRESS)} Added by you.`);
    await expect(line.getByRole("radio")).toHaveCount(0);
    await expect(modal.locator(".mb-apps-toast")).toContainText(`Google Drive is connected as ${ADDRESS}.`);
    const row = await knex("plugin_accounts").where({ user_id: aside.person, plugin_id: APP, label: ADDRESS }).first();
    expect(String(row.workspace_id)).toBe(aside.homeId);
    await page.screenshot({ path: info.outputPath("account-line.png") });

    // Added and connected: still nothing signs in until + Add account opens the step again.
    await expect.poll(() => signInControls(modal)).toEqual([0, 0]);
    await modal.getByRole("button", { name: "+ Add account" }).click();
    await expect.poll(() => signInControls(modal)).toEqual([1, 1]);
    await step.getByRole("button", { name: "Cancel" }).click();

    // Needing sign-in again: its line's Sign in again is the one control, and it hides while the Add account step is open.
    await knex("plugin_accounts").where({ id: row.id }).update({ status: "needs-auth", tokens: null, connected_at: null });
    await page.keyboard.press("Escape");
    await openDrive(page);
    await expect(line).toContainText("Needs sign-in");
    await expect.poll(() => signInControls(modal)).toEqual([1, 0]);
    await expect(line.getByRole("button", { name: "Sign in again" })).toBeVisible();
    await modal.getByRole("button", { name: "+ Add account" }).click();
    await expect.poll(() => signInControls(modal)).toEqual([1, 1]);
    await step.getByRole("button", { name: "Cancel" }).click();

    // Kim, a member, added a Drive of hers in the home: its line names her, and the owner may rename it, sign it in again
    // or remove it.
    const stamp = Date.now().toString(36);
    const [kim] = await knex("users").insert({
      auth_provider: "test", auth_provider_user_sid: `kim-${stamp}`, email: `kim-${stamp}@example.com`, username: `kim${stamp}`, display_name: "Kim"
    }).returning("id");
    kimId = String(kim.id);
    await knex("workspace_memberships").insert({ workspace_id: aside.homeId, user_id: kimId, role_sid: "member", status: "active" });
    await knex("plugin_accounts").insert({ user_id: kimId, workspace_id: aside.homeId, plugin_id: APP, name: "", label: "kim@example.com", status: "needs-auth" });
    await page.keyboard.press("Escape");
    await openDrive(page);
    const kims = modal.getByTestId("account-line").filter({ hasText: "kim@example.com" });
    await expect(kims).toContainText(`${everyone("kim@example.com")} Added by Kim.`);
    await expect(kims.getByRole("button", { name: "Remove kim@example.com" })).toBeVisible();
    await expect(kims.getByRole("button", { name: "Rename kim@example.com" })).toBeEnabled();
    await expect(kims.getByRole("button", { name: "Sign in again" })).toBeVisible();

    // Anyone who may not change it (a member who didn't add it: the list says canChange false) sees its words, and
    // no bin, Rename or Sign in again. Public's Test Preview has one person, so the list's answer is the member's here.
    await page.keyboard.press("Escape");
    const list = (url: URL) => url.pathname === `/api${HOME}/plugins`;
    await page.route(list, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const plugin of body.plugins) {
        for (const account of plugin.accounts) if (account.label === "kim@example.com") account.canChange = false;
      }
      await route.fulfill({ response, json: body });
    });
    await openDrive(page);
    await expect(kims).toContainText(`${everyone("kim@example.com")} Added by Kim.`);
    await expect(kims.getByRole("button", { name: "Remove kim@example.com" })).toHaveCount(0);
    await expect(kims.getByRole("button", { name: "Rename kim@example.com" })).toBeDisabled();
    await expect(kims.getByRole("button", { name: STARTS_SIGN_IN })).toHaveCount(0);
    await expect(line.getByRole("button", { name: `Remove ${ADDRESS}` })).toBeVisible();
    await page.screenshot({ path: info.outputPath("someone-elses-line.png") });
    await page.unroute(list);
    await page.keyboard.press("Escape");
    await openDrive(page);

    // Remove from this home asks first, saying what goes; Keep keeps it.
    const removing = modal.getByRole("group", { name: "Remove from this home" });
    await head.getByRole("button", { name: "Remove from this home" }).click();
    await expect(removing).toContainText(`Remove Google Drive from ${aside.homeName}, with its 2 accounts? Everyone's bots stop using it.`);
    await removing.getByRole("button", { name: "Keep" }).click();

    // A line's bin asks once more in the line, then the account goes; the app, and Kim's account, stay.
    await line.getByRole("button", { name: `Remove ${ADDRESS}` }).click();
    await expect(line).toContainText(`Remove it for everyone in ${aside.homeName}? Their bots stop using it.`);
    await line.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(line).toHaveCount(0);
    expect(await knex("plugin_accounts").where({ id: row.id }).first()).toBeUndefined();
    await expect(kims).toHaveCount(1);
    await expect(head.getByRole("button", { name: "Remove from this home" })).toBeVisible();

    // Removing the app from the home takes its last account with it.
    await head.getByRole("button", { name: "Remove from this home" }).click();
    await expect(removing).toContainText(`Remove Google Drive from ${aside.homeName}, with its account? Everyone's bots stop using it.`);
    await removing.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(head.getByRole("button", { name: "Add to this home", exact: true })).toBeVisible();
    await expect(modal.getByTestId("account-line")).toHaveCount(0);
    expect(await knex("plugin_accounts").where({ workspace_id: aside.homeId, plugin_id: APP })).toEqual([]);
    expect(await knex("home_plugins").where({ workspace_id: aside.homeId, plugin_id: APP })).toEqual([]);

    // Added again after that: the same step, saying who uses it, with nothing to choose.
    await head.getByRole("button", { name: "Add to this home", exact: true }).click();
    await expect(step).toContainText(everyone("the account you connect"));
    await expect(step.getByRole("radio")).toHaveCount(0);
    await step.getByRole("button", { name: "Cancel" }).click();
  } finally {
    await aside.restore();
    if (kimId) {
      await knex("workspace_memberships").where({ user_id: kimId }).del();
      await knex("users").where({ id: kimId }).del();
    }
    await knex.destroy();
  }
});

test("on a phone the sign-in takes the tab and comes back to the app, connected", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const knex = database();
  const aside = await asideDrive(knex);
  try {
    await openHome(page);
    const modal = await openDrive(page);
    await modal.locator(".mb-detail__head").getByRole("button", { name: "Add to this home", exact: true }).click();
    const step = modal.locator(".mb-add-account");
    await expect(step).toContainText("Google's sign-in opens here, then brings you back.");
    await page.screenshot({ path: info.outputPath("phone-add-account-step.png") });
    let windows = 0;
    page.context().on("page", () => { windows += 1; });
    await step.getByRole("button", { name: "Sign in with Google" }).click();
    // Back on Mercbot, in this tab, with Connect apps open on the app and the account connected.
    await expect(page.locator(".mb-apps-modal").getByTestId("account-line").filter({ hasText: ADDRESS })).toContainText("Connected", { timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`${HOME}$`, "u"));
    expect(windows).toBe(0);
    await page.screenshot({ path: info.outputPath("phone-back-connected.png") });
  } finally {
    await aside.restore();
    await knex.destroy();
  }
});

test("the page a sign-in ends on: Try again from where it began, else Close, which says to close the tab when it can't", async ({ page }, info) => {
  // A sign-in link that ran out ends on the page that says it didn't connect.
  const ended = "/api/connections/callback?state=ran-out&code=late";
  await page.goto(HOME);
  await page.evaluate(() => sessionStorage.setItem("mercbot-sign-in-again", "/account/connect?plugin=google-drive&home=you"));
  await page.goto(ended);
  await expect(page.getByRole("heading", { name: "Couldn't connect" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/account/connect?plugin=google-drive&home=you");
  await expect(page.getByRole("button", { name: "Close" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Back to Mercbot" })).toHaveAttribute("href", "/");
  await page.screenshot({ path: info.outputPath("ended-try-again.png") });

  // Nothing to try again: Close. This tab wasn't opened by a page, so the browser keeps it, and the page says so.
  await page.goto(ended);
  const close = page.getByRole("button", { name: "Close" });
  await expect(close).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toBeHidden();
  await close.click();
  await expect(page.getByText("You can close this tab now.")).toBeVisible();
  await expect(close).toBeHidden();
  await expect(page.getByRole("link", { name: "Back to Mercbot" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("ended-close-refused.png") });

  // A window a page opened closes with Close.
  const opened = page.context().waitForEvent("page");
  await page.evaluate((address) => { window.open(address, "_blank", "popup,width=520,height=720,noopener"); }, ended);
  const window = await opened;
  await window.getByRole("button", { name: "Close" }).click();
  await expect.poll(() => window.isClosed()).toBe(true);
});
