import { HOME, botNamed, directChat, expect, openShell, shell, test, type Page } from "./harness";

// The file browser (D-47, D-112 R6), on the Test Preview target: in Otto's direct chat, his card's Files opens at his
// own files, with the places as a picker (the card is narrow); a file uploaded into This chat is moved to Home files
// with Move to…, seen on the home's Files page with the places column beside it, renamed, copied to Otto's files with
// Copy to… (the original staying), dragged onto Otto (a move), and deleted. Run with:
// vibe64-helper playwright --target test-app test tests/e2e/files.spec.ts
test.describe.configure({ mode: "serial" });
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const row = (page: Page, name: string) => page.locator(".mb-files__row").filter({ hasText: name });
const crumbHere = (page: Page) => page.locator(".mb-files__crumb--here");
const place = (page: Page, label: string) => page.getByRole("navigation", { name: "Places" }).getByRole("button", { name: label, exact: true });

async function chooseFromMenu(page: Page, name: string, item: string) {
  await row(page, name).getByRole("button", { name: `More for ${name}` }).click();
  await page.locator(".v-overlay--active .v-list-item").filter({ hasText: item }).click();
}

/** The place picker's place, then its button ("Copy here", "Move here"). */
async function pick(page: Page, placeLabel: string, action: string) {
  const dialog = page.locator(".v-dialog").filter({ has: page.locator(".mb-picker") });
  await dialog.locator(".v-select").click();
  await page.getByRole("option", { name: placeLabel, exact: true }).click();
  await expect(dialog.locator(".mb-picker__crumb--here")).toHaveText(placeLabel);
  await dialog.getByRole("button", { name: action }).click();
}

test("a file moves from a chat's folder to Home files, is renamed, copied, dragged to a bot's files and deleted", async ({ page }, info) => {
  const otto = await botNamed(page, "Otto");
  const chat = await directChat(page, String(otto.id));
  await openShell(page, `?chat=${chat.id}`);

  // In a direct chat Details is the bot's card: its Files opens at Otto's own files, the places a picker above them.
  const card = shell.details(page, "Otto's card");
  if (!(await card.isVisible())) await shell.chat(page).getByRole("button", { name: "Otto details" }).click();
  await card.getByRole("tab", { name: "Files" }).click();
  await expect(card.locator(".mb-files__crumb--here")).toHaveText("Otto");
  await card.locator(".mb-files__place-picker").click();
  for (const label of ["This chat", "Home files", "Otto"]) await expect(page.getByRole("option", { name: label, exact: true })).toBeVisible();
  await page.getByRole("option", { name: "This chat", exact: true }).click();
  await expect(card.locator(".mb-files__crumb--here")).toHaveText("This chat");
  await expect(card).not.toContainText(/Just me|Everyone using Otto/u);

  // Upload into This chat.
  const name = `notes-${Date.now()}.txt`;
  const chooser = page.waitForEvent("filechooser");
  await card.getByRole("button", { name: "Upload to This chat" }).click();
  await (await chooser).setFiles({ name, mimeType: "text/plain", buffer: Buffer.from("hello from the test") });
  await expect(row(page, name)).toBeVisible();
  await page.screenshot({ path: info.outputPath("chat-files.png") });

  // Move it to Home files: the place picker, then Move here.
  await chooseFromMenu(page, name, "Move to…");
  await pick(page, "Home files", "Move here");
  await expect(row(page, name)).toHaveCount(0);

  // The home's Files page, from the sidebar's Files button: the places column, at Home files, with the file there.
  await card.getByRole("tab", { name: "Details" }).click();
  await page.locator(".mb-files-entry__link").click();
  await expect(page).toHaveURL(new RegExp(`${HOME}/files$`, "u"));
  await expect(place(page, "Home files")).toHaveAttribute("aria-current", "true");
  await expect(place(page, "Otto")).toBeVisible();
  await expect(row(page, name)).toBeVisible();
  await page.screenshot({ path: info.outputPath("home-files.png") });
  await chooseFromMenu(page, name, "Rename");
  const renamed = `renamed-${name}`;
  await page.locator(".v-dialog input").fill(renamed);
  await page.locator(".v-dialog").getByRole("button", { name: "Rename" }).click();
  await expect(row(page, renamed)).toBeVisible();

  // Copy to… Otto's files: the original stays.
  await chooseFromMenu(page, renamed, "Copy to…");
  await pick(page, "Otto", "Copy here");
  await expect(row(page, renamed)).toBeVisible();
  await place(page, "Otto").click();
  await expect(crumbHere(page)).toHaveText("Otto");
  await expect(row(page, renamed)).toBeVisible();
  await chooseFromMenu(page, renamed, "Delete");
  await page.getByRole("button", { name: /^Delete$/u }).click();
  await expect(row(page, renamed)).toHaveCount(0);

  // Dragged onto Otto, without a key held: a move.
  await place(page, "Home files").click();
  await expect(row(page, renamed)).toBeVisible();
  await row(page, renamed).dragTo(place(page, "Otto"));
  await expect(row(page, renamed)).toHaveCount(0);
  await place(page, "Otto").click();
  await expect(row(page, renamed)).toBeVisible();
  await chooseFromMenu(page, renamed, "Delete");
  await page.getByRole("button", { name: /^Delete$/u }).click();
  await expect(row(page, renamed)).toHaveCount(0);

  // The same page on a phone: the places are a picker at the top.
  const desk = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".mb-files__place-picker")).toBeVisible();
  await page.screenshot({ path: info.outputPath("home-files-phone.png") });
  if (desk) await page.setViewportSize(desk);
});
