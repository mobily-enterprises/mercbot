import { HOME, botNamed, directChat, expect, openShell, shell, test, type Page } from "./harness";

// Leaving an app (D-106), on the Test Preview target: its fixtures give the owner's home the bots Otto and Vera, the
// person's direct chat with Vera, and a published Contacts app pinned in the sidebar, whose list (Ana Ruiz, Ben Okafor,
// Carla Mendes) opens each person's record and whose tabs are People and Stages. Every place opened in the app adds a
// history entry, as before; the shell's button first in the app's bar is the app's close, named for where it goes (a
// chat by its name: a direct chat's is its bot's), and one click leaves for the Mercbot place the app was opened from,
// however many places were opened in it. The tests only move around: they change no records. Screenshots of the
// close, its name showing, light, dark and at a phone's width, are the output.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/app-exit.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

// The app's close: the shell's button in the app's bar, a close named for where it goes.
const close = (page: Page) => page.getByTestId("jskit-shell-back");
const position = (page: Page) => page.evaluate(() => Number(window.history.state?.position));

async function expectClose(page: Page, name: string) {
  await expect(close(page)).toHaveAttribute("aria-label", name);
  await expect(close(page)).toHaveAttribute("data-action", "close");
}

// The close with its name showing, for the screenshots.
async function showName(page: Page, name: string) {
  await close(page).hover();
  await expect(page.locator(".v-tooltip .v-overlay__content").filter({ hasText: name })).toBeVisible();
}

// `count` places a person opens in the app, one after another: a person's record, and the People and Stages tabs, from
// step `from` of the round (1 starts on a record). Each is a place of its own, with its own history entry.
async function useTheApp(page: Page, count: number, from = 0) {
  const row = (name: string) => page.getByRole("row", { name: new RegExp(name, "u") });
  const tab = (name: string) => page.getByRole("tab", { name });
  const record = (name: string) => [() => row(name).click(), /\/apps\/contacts\/edit\/\w+$/u] as const;
  const people = () => [() => tab("People").click(), /\/apps\/contacts\/list$/u] as const;
  const stages = () => [() => tab("Stages").click(), /\/apps\/contacts\/stages$/u] as const;
  const round = [record("Ana Ruiz"), people(), record("Ben Okafor"), stages(), people(), record("Carla Mendes"), stages(), people()];
  const steps = [...round, ...round, ...round].slice(from, from + count);
  for (const [act, address] of steps) {
    const before = page.url();
    await act();
    await expect(page).toHaveURL(address);
    expect(page.url()).not.toBe(before);
  }
}

test("opened from a chat, an app is left for that chat in one click after 16 places, a reload among them", async ({ page }, testInfo) => {
  // Otto's direct chat as well as Vera's, so the chat the app was opened from is the second one opened.
  await directChat(page, String((await botNamed(page, "Otto")).id));
  await openShell(page);
  await shell.chatRow(page, "Otto").click();
  await expect(page).toHaveURL(/[?&]chat=/u);
  await shell.chatRow(page, "Vera").click();
  await expect(shell.chat(page).getByRole("textbox", { name: "Message Vera" })).toBeVisible();
  const chatUrl = page.url();
  expect(new URL(chatUrl).searchParams.get("chat")).toBeTruthy();
  const atChat = await position(page);

  await page.locator(".mb-apps-entry__app").filter({ hasText: "Contacts" }).click();
  await expect(page).toHaveURL(/\/apps\/contacts$/u);
  await expectClose(page, "Back to Vera");
  await useTheApp(page, 8);
  // A reload keeps the place, and the way out.
  await page.reload();
  await expect(page.getByRole("row", { name: /Ana Ruiz/u })).toBeVisible();
  await useTheApp(page, 8);
  // The app's own navigation is as before: an entry for each place.
  expect(await position(page)).toBe(atChat + 17);
  await expectClose(page, "Back to Vera");
  await showName(page, "Back to Vera");
  await page.screenshot({ path: testInfo.outputPath("app-exit-light.png"), animations: "disabled" });

  await close(page).click();
  // Vera's chat, its query and all, in one click.
  await expect(page).toHaveURL(chatUrl);
  await expect(page.locator(".mb-shell")).toBeVisible();
  await expect(shell.chat(page).getByRole("textbox", { name: "Message Vera" })).toBeVisible();
  // One step: the chat took the place of the entry the click was on.
  expect(await position(page)).toBe(atChat + 17);
});

test("a deep link to a record is left for the home's chats in one click", async ({ page }) => {
  const response = await page.request.get(`/api${HOME}/app-data/tables/contacts/records?size=50`);
  expect(response.ok()).toBe(true);
  const { table, records } = await response.json();
  const name = table.fields.find((field: { key: string }) => field.key === "name").id;
  const ben = records.find((record: Record<string, unknown>) => record[name] === "Ben Okafor");

  await page.goto(`${HOME}/apps/contacts/edit/${ben.id}`);
  await expect(page.getByRole("textbox", { name: /Name/u })).toHaveValue("Ben Okafor");
  const opened = await position(page);
  await expectClose(page, "Back to Mercbot");
  await useTheApp(page, 5, 1);
  expect(await position(page)).toBe(opened + 5);

  await close(page).click();
  await expect(page).toHaveURL(new RegExp(`${HOME}$`, "u"));
  await expect(page.locator(".mb-shell")).toBeVisible();
  expect(await position(page)).toBe(opened + 5);
});

test("opened from Apps, the close says Back to Apps, Ctrl+[ leaves the same way, and it shows in light, dark and on a phone", async ({ page }, testInfo) => {
  // The home's apps follow the device's light or dark for this test (an app is light unless its look says otherwise),
  // in a colour that reads on both, and get their look back after it.
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const look = async (theme: Record<string, unknown>) => {
    const saved = await page.request.put(`/api${HOME}/apps-theme`, { headers: { "csrf-token": csrfToken }, data: { theme } });
    expect(saved.ok(), await saved.text()).toBe(true);
  };
  const before = (await (await page.request.get(`/api${HOME}/apps-theme`)).json()).theme;
  const kept = { color: "#1C1C1C", mode: "light", font: "system", corners: "soft", density: "comfortable", logo: null, ...(before || {}) };
  await look({ ...kept, color: "#1E86FC", mode: "system" });
  try {
    await openShell(page);
    await page.locator(".mb-apps-entry__link").click();
    await expect(page).toHaveURL(new RegExp(`${HOME}/apps$`, "u"));
    await page.locator(".apps-home__tile").filter({ has: page.getByText("Contacts", { exact: true }) }).click();
    await expect(page).toHaveURL(/\/apps\/contacts$/u);
    await expectClose(page, "Back to Apps");
    await useTheApp(page, 4);

    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expect(page.locator(".app-frame__themed")).toHaveClass(/\bv-theme--app-dark-/u);
    await showName(page, "Back to Apps");
    await page.screenshot({ path: testInfo.outputPath("app-exit-dark.png"), animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(close(page)).toBeInViewport();
    await showName(page, "Back to Apps");
    await page.screenshot({ path: testInfo.outputPath("app-exit-phone-dark.png"), animations: "disabled" });
    // The pointer off the close: the X as it looks untouched, and no tooltip open when Ctrl+[ is pressed.
    await page.mouse.move(8, 400);
    await expect(page.locator(".v-overlay--active")).toHaveCount(0);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await expect(page.locator(".app-frame__themed")).toHaveClass(/\bv-theme--app-light-/u);
    await page.screenshot({ path: testInfo.outputPath("app-exit-phone-light.png"), animations: "disabled" });

    await page.keyboard.press("Control+BracketLeft");
    await expect(page).toHaveURL(new RegExp(`${HOME}/apps$`, "u"));
  } finally {
    await look(kept);
  }
});
