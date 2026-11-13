import { expect, test, type Page } from "./harness";

// Settings lists Mercbot's own sections, the same for everyone in a home; the API guard fails the test on any of
// the page's calls that the server refuses or leaves unanswered.
test.use({ apiGuard: true });

/** Opens the person's home (past the intro, for a new account) and Settings from the search palette. */
async function openSettings(page: Page) {
  const next = page.getByRole("button", { name: "Next" });
  const shell = page.locator(".mb-shell");
  await expect(shell.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shell).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Settings: General");
  await page.keyboard.press("Enter");
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections.getByRole("button", { name: "General" })).toBeVisible();
  return sections;
}

test("a home's owner gets Mercbot's own Settings sections, and General has no Sign out", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/w\/[^/?]+/u);
  const sections = await openSettings(page);
  await expect(sections.getByRole("button")).toHaveText([
    "General",
    "Computer",
    "Permissions",
    "Files",
    "Website",
    "Memory",
    "Vault",
    "Spending",
    "Mercbot account",
    "About"
  ]);
  // Nobody signs in to or out of a person's own copy (D-81): General has no Sign out.
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("button", { name: "Account details" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});
