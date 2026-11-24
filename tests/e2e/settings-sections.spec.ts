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
  // The home's main bot and Builder and its bots' common knowledge are the home's, not a bot's, so they have sections
  // of their own after Templates (D-119), and so does every recurring task in the home (D-132).
  await expect(sections.getByRole("button")).toHaveText([
    "General",
    "Computer",
    "Permissions",
    "Files",
    "Website",
    "Templates",
    "Main bot and Builder",
    "Bots' common knowledge",
    "Recurring tasks",
    "Vault",
    "Spending",
    "Mercbot account",
    "About"
  ]);
  // Nobody signs in to or out of a person's own copy (D-81): General has no Sign out.
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("button", { name: "Account details" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Sign out" })).toHaveCount(0);

  // Main bot and Builder: both rows, which the home's owner may change (no line saying only owners and admins can).
  await sections.getByRole("button", { name: "Main bot and Builder" }).click();
  await expect(settings.getByRole("heading", { name: "Main bot and Builder" })).toBeVisible();
  const choices = settings.getByRole("region", { name: "Main bot and Builder" });
  await expect(choices.locator(".mb-set-row__label")).toHaveText(["Main bot", "Builder"]);
  await expect(choices).toContainText("It can't be archived.");
  await expect(choices).toContainText("It makes and changes the home's apps.");
  await expect(choices).not.toContainText("Only the home's owners and admins can change these.");

  // Bots' common knowledge: what it is, then its entries or the line saying there are none yet, never an error.
  await sections.getByRole("button", { name: "Bots' common knowledge" }).click();
  await expect(settings.getByRole("heading", { name: "Bots' common knowledge" })).toBeVisible();
  const knowledge = settings.getByRole("region", { name: "Bots' common knowledge" });
  await expect(knowledge.locator(".mb-set-group")).toHaveText("Every bot in this home reads it in every chat.");
  await expect(knowledge.getByRole("list", { name: "Common knowledge" }).or(knowledge.getByText(/^No common knowledge yet\./u))).toBeVisible();
  await expect(knowledge.getByRole("alert")).toHaveCount(0);
});
