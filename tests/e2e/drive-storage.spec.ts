import { existsSync } from "node:fs";
import path from "node:path";
import knexLib from "knex";
import { expect, expectRefusal, test, testDatabaseName, type Page } from "./harness";

// A home's files kept in Google Drive (D-80), on the Test Preview target, whose Google is a local stand-in
// (tests/support/fakeDrive.mjs): from Settings → Files the owner connects a Google Drive account in Connect apps and
// moves the home's files there; once the account needs signing in again, Settings and the Files page say so, and
// Sign in again brings it back. The mount itself, and a refused renewal signing the account out, are proven in the
// server tests (driveMount.test.js, driveStorage.integration.js).
const HOME = "/w/you";
const ACCOUNT = "pat@example.com";
// Every move runs rclone, which the Test Preview takes from the toolbox, else from PATH (remoteMounts.js): without it a
// move stops at once ("couldn't read the files where they are now"), so this test waits for a host with it, as
// fileMoves.integration.js and driveMount.test.js do.
const RCLONE = [path.resolve(process.env.MERCBOT_TOOLS_DIR || ".tools", "bin"), ...String(process.env.PATH || "").split(path.delimiter)]
  .some((dir) => Boolean(dir) && existsSync(path.join(dir, "rclone")));
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

async function openFilesSettings(page: Page) {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Settings: Files");
  await page.keyboard.press("Enter");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByText("Where this home keeps its files")).toBeVisible();
  return settings;
}

/** `click` opens the sign-in in a new tab, which signs in at the stand-in and comes back; the tab is closed after. */
async function signInAtStandIn(page: Page, click: () => Promise<void>) {
  const opened = page.context().waitForEvent("page");
  await click();
  const tab = await opened;
  await expect(tab.getByText("Connected to Google")).toBeVisible();
  await tab.close();
}

test("a home's files go to Google Drive, and a Drive that needs signing in again says so until it's signed in", async ({ page }, info) => {
  test.skip(!RCLONE, "rclone isn't installed: not in the toolbox (npm run tools:install), nor on PATH");
  // Moving the home's files back from the Drive first waits 15 s for saves on their way through mounts (fileMoves.js).
  test.setTimeout(120_000);
  const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });
  const home = knex("workspaces").select("id").where({ slug: "you" });
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const { plugins } = await (await page.request.get(`/api${HOME}/plugins`)).json();
  const wasInstalled = Boolean(plugins.find((plugin: { id: string, installed?: boolean }) => plugin.id === "google-drive")?.installed);
  try {
    await knex("file_storage").whereIn("workspace_id", home).del();
    await knex("plugin_accounts").where({ plugin_id: "google-drive", label: ACCOUNT }).del();

    // No Google Drive yet: Settings → Files leads to Connect apps, where the owner signs in.
    await openHome(page);
    let settings = await openFilesSettings(page);
    await settings.getByText("In Google Drive", { exact: true }).click();
    await expect(settings.getByText("No Google Drive account is connected yet.")).toBeVisible();
    await settings.getByRole("button", { name: "Connect Google Drive" }).click();
    const modal = page.locator(".mb-apps-modal");
    await expect(modal.locator(".mb-detail__head").getByRole("heading", { level: 2 })).toContainText("Google Drive");
    const connect = wasInstalled
      ? modal.locator(".mb-detail__row").getByRole("button", { name: /^(Sign in|Reconnect|Retry)$/u }).first()
      : modal.locator(".mb-detail__head").getByRole("button", { name: "Connect", exact: true });
    await signInAtStandIn(page, () => connect.click());
    await expect(modal.locator(".mb-detail__row").filter({ hasText: ACCOUNT })).toContainText("Connected");
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();

    // Chosen and saved: the home's files move to Mercbot's folder in that Drive, the screen following the move as it
    // copies and checks them (fileMoves.integration.js).
    settings = await openFilesSettings(page);
    await settings.getByText("In Google Drive", { exact: true }).click();
    await expect(settings.getByRole("button", { name: "Google Drive account" })).toContainText(ACCOUNT);
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(settings.getByText(`Moving this home's files from Mercbot to Google Drive (${ACCOUNT})`)).toBeVisible();
    await expect(settings.getByRole("button", { name: "Save" })).toBeDisabled();
    await page.screenshot({ path: info.outputPath("drive-moving.png") });
    await expect(page.getByText(`This home's files are now kept in Google Drive (${ACCOUNT})`)).toBeVisible({ timeout: 60000 });
    await expect(settings.getByText(`In the folder “Mercbot – `)).toContainText(`of ${ACCOUNT}'s Google Drive.`);
    // The Drive's space, looked at once the move ends, as when the page opens.
    await expect(settings.getByText(`In the folder “Mercbot – `)).toContainText(/ free of \S+ GB\./u);
    await page.screenshot({ path: info.outputPath("drive-chosen.png") });

    // Google refused the next renewal (driveStorage.integration.js): the account needs signing in again.
    await knex("plugin_accounts").where({ plugin_id: "google-drive", label: ACCOUNT }).update({ status: "needs-auth", tokens: null, connected_at: null });

    // The home's Files page says why, and links to signing in.
    expectRefusal(`409 GET /api${HOME}/files?folder=${encodeURIComponent("/files/shared")}`);
    await page.goto(`${HOME}/files`);
    const signInLink = page.locator(".mb-files__sign-in");
    await expect(page.getByText("This home's files are in Google Drive, which needs signing in again.")).toBeVisible();
    await expect(signInLink).toHaveText("Sign in again");
    await page.screenshot({ path: info.outputPath("files-sign-in-again.png") });

    // Settings → Files says so too; the choice is kept.
    await openHome(page);
    settings = await openFilesSettings(page);
    const alert = settings.locator(".mb-files-set__signed-out");
    await expect(alert).toContainText(`Google Drive (${ACCOUNT}) needs signing in again. The files are safe there`);
    await expect(alert.getByRole("button", { name: "Sign in again" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Sign in again from the Files page's link: Connect apps opens on Google Drive.
    await page.goto(`${HOME}/files`);
    await signInLink.click();
    await expect(modal.locator(".mb-detail__head").getByRole("heading", { level: 2 })).toContainText("Google Drive");
    const row = modal.locator(".mb-detail__row").filter({ hasText: ACCOUNT });
    await signInAtStandIn(page, () => row.getByRole("button", { name: "Sign in" }).click());
    await expect(row).toContainText("Connected");
    await page.keyboard.press("Escape");
    settings = await openFilesSettings(page);
    await expect(settings.getByText(`In the folder “Mercbot – `)).toBeVisible();
    await expect(settings.locator(".mb-files-set__signed-out")).toHaveCount(0);

    // Back on Mercbot: the files move back from the Drive, as the later specs on this Test Preview expect them.
    await settings.getByText("On Mercbot", { exact: true }).click();
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(settings.getByText(`Moving this home's files from Google Drive (${ACCOUNT}) to Mercbot`)).toBeVisible();
    await expect(page.getByText("This home's files are now kept on Mercbot")).toBeVisible({ timeout: 60000 });
  } finally {
    await knex("file_storage").whereIn("workspace_id", home).del();
    await knex("plugin_accounts").where({ plugin_id: "google-drive", label: ACCOUNT }).del();
    await knex.destroy();
    if (!wasInstalled) await page.request.delete(`/api${HOME}/plugins/google-drive`, { headers: { "csrf-token": csrfToken } });
  }
});
