import { HOME, botNamed, directChat, expect, openShell, shell, test, type Page } from "./harness";

// The file browsers (D-47, D-112 R6), on the Test Preview target: in Otto's direct chat, his card's Files shows the
// chat's own folder (This chat), his own and the home's; a file uploaded into This chat is moved to the whole home, seen
// on the home's Files page, renamed and deleted there; the Files page's Otto (?bot=<id>&files=1) opens his direct chat
// with his card at its Files. Run with:
// vibe64-helper playwright --target test-app test tests/e2e/files.spec.ts
test.describe.configure({ mode: "serial" });
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const section = (page: Page, label: string | RegExp) => page.locator(".mb-files__section").filter({ has: page.locator(".mb-files__crumb", { hasText: label }) });
const row = (page: Page, name: string) => page.locator(".mb-files__row").filter({ hasText: name });

async function chooseFromMenu(page: Page, name: string, item: string) {
  await row(page, name).getByRole("button", { name: `More for ${name}` }).click();
  await page.locator(".v-overlay--active .v-list-item").filter({ hasText: item }).click();
}

test("a file moves from a chat's folder to the whole home, is renamed there and deleted", async ({ page }, info) => {
  const otto = await botNamed(page, "Otto");
  const chat = await directChat(page, String(otto.id));
  await openShell(page, `?chat=${chat.id}`);

  // In a direct chat Details is the bot's card, with this chat's folder first.
  const card = shell.details(page, "Otto's card");
  if (!(await card.isVisible())) await shell.chat(page).getByRole("button", { name: "Otto details" }).click();
  await card.getByRole("tab", { name: "Files" }).click();
  const here = section(page, "This chat");
  await expect(here).toBeVisible();
  await expect(section(page, "Otto's files")).toBeVisible();
  // The home's folder isn't listed on a bot's card (D-119): a link leads to the Files page.
  await expect(card.locator(".mb-files__section")).toHaveCount(2);
  await expect(card.getByRole("link", { name: "Home files →" })).toBeVisible();
  await expect(card).not.toContainText(/Just me|Everyone using Otto/u);

  // Upload into This chat.
  const name = `notes-${Date.now()}.txt`;
  const chooser = page.waitForEvent("filechooser");
  await here.getByRole("button", { name: "Upload to This chat" }).click();
  await (await chooser).setFiles({ name, mimeType: "text/plain", buffer: Buffer.from("hello from the test") });
  await expect(here.locator(".mb-files__row").filter({ hasText: name })).toBeVisible();
  await page.screenshot({ path: info.outputPath("chat-files.png") });

  // Move it to the whole home: Move to… still offers Home files, though the tab doesn't list it.
  await chooseFromMenu(page, name, "Move to…");
  await page.locator(".v-dialog .v-select").click();
  await page.getByRole("option", { name: "Home files", exact: true }).click();
  await page.locator(".v-dialog").getByRole("button", { name: "Move" }).click();
  await expect(here.locator(".mb-files__row").filter({ hasText: name })).toHaveCount(0);

  // The home's Files page, from the sidebar's Files button: there, renamed, then deleted. The card is left on Details,
  // so the Files page's Otto is what opens it at Files.
  await card.getByRole("tab", { name: "Details" }).click();
  await page.locator(".mb-files-entry__link").click();
  await expect(page).toHaveURL(new RegExp(`${HOME}/files$`, "u"));
  await expect(row(page, name)).toBeVisible();
  const ottoLink = page.getByRole("link", { name: "Otto" });
  await expect(ottoLink).toBeVisible();
  await page.screenshot({ path: info.outputPath("home-files.png") });
  await chooseFromMenu(page, name, "Rename");
  const renamed = `renamed-${name}`;
  await page.locator(".v-dialog input").fill(renamed);
  await page.locator(".v-dialog").getByRole("button", { name: "Rename" }).click();
  await expect(row(page, renamed)).toBeVisible();
  await chooseFromMenu(page, renamed, "Delete");
  await page.getByRole("button", { name: /^Delete$/u }).click();
  await expect(row(page, renamed)).toHaveCount(0);

  // The same page on a phone.
  const desk = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("home-files-phone.png") });
  if (desk) await page.setViewportSize(desk);

  // Otto on the Files page opens his direct chat with his card at its Files: the chat's folder and his own.
  await ottoLink.click();
  await expect(page).toHaveURL(new RegExp(`[?&]chat=${chat.id}$`, "u"));
  await expect(shell.chat(page)).toHaveAttribute("aria-label", "Otto");
  await expect(card.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
  await expect(section(page, "This chat")).toBeVisible();
  await expect(section(page, "Otto's files")).toBeVisible();
  await expect(card.locator(".mb-files__section")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("bot-card-files.png") });
});
