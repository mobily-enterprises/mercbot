import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "./harness";

// Settings → Website (D-84) on the Test Preview target, a person's own copy: its one person runs it from its own
// computer (`mercbot.copy-runners`), so they're offered a folder on it first, and S3-compatible storage too, and the
// server saves a folder they choose. The website and the folder go with the test. A copy where someone in a home
// doesn't run it, and is refused a folder, is for a copy built on Mercbot that has such people to test.
test.use({ apiGuard: true });

/** The person's home, past the intro a new account sees once; its address. */
async function openHome(page: Page, query = "") {
  await page.goto("/");
  await expect(page).toHaveURL(/\/w\/[^/?]+/u);
  const home = /\/w\/[^/?]+/u.exec(new URL(page.url()).pathname)![0];
  if (query) await page.goto(`${home}${query}`);
  const next = page.getByRole("button", { name: "Next" });
  const shell = page.locator(".mb-shell");
  await expect(shell.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shell).toBeVisible();
  return home;
}

test("the person who runs the copy is offered a folder on its computer for a home's website, and saves one", async ({ page }) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mercbot-e2e-site-"));
  let home = "";
  try {
    home = await openHome(page, "?settings=website");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings.getByRole("radio", { name: /^A folder on this computer/u })).toBeChecked();
    await expect(settings.getByRole("radio", { name: /^S3-compatible storage/u })).toBeVisible();
    expect((await (await page.request.get(`/api${home}/website`)).json()).canUseFolder).toBe(true);

    await settings.getByLabel("Folder", { exact: true }).fill(folder);
    await settings.getByLabel("Its address on the web").fill("http://127.0.0.1:9/pages/");
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Website saved")).toBeVisible();
    await expect(settings.getByRole("button", { name: "Remove website" })).toBeVisible();
  } finally {
    // The person's home is other specs' too: its website goes with this test.
    if (home) {
      const { csrfToken } = await (await page.request.get("/api/session")).json();
      await page.request.delete(`/api${home}/website`, { headers: { "csrf-token": csrfToken } });
    }
    await rm(folder, { recursive: true, force: true });
  }
});
