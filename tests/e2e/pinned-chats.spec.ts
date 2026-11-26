import type { Knex } from "knex";
import type { TestInfo } from "@playwright/test";
import { connectTestDb, expect, focusRing, homeApi, homeWithBen, openShell, seedChat, seedMessage, shell, test, textContrast, type Page } from "./harness";

// Pinned chats in the sidebar (D-112, D-135), on the Test Preview target, in a home of each test's own. The person's own
// pins are a block above Rooms, "Pinned chats": each a chip of one line, no taller than a Rooms row, with its face, its
// name and its marks; one across the sidebar, two or more in two columns. A chip opens its chat, shows it selected,
// previews its latest message on hover, has a pinned chat's menu, drags to reorder the pins (the new order shown as it
// goes, the block marked as where it drops), takes the keyboard's focus with a ring, and works in the phone's drawer.
// The home's everyone chat is no chip: it's the first row under Rooms, with a pin mark, never dragged, and while it's
// the only pinned chat there is no Pinned chats block. A room's Move to, in its menu, shows the person's sections beside
// the menu, which stays open, and a section picked there closes both and files the room in it. Screenshots of 1, 2 and 4 pins, light and dark, desktop and
// phone (390 by 844), are the output. Each test deletes the home and the person it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/pinned-chats.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

type Home = Awaited<ReturnType<typeof homeWithBen>>;
type Room = { id: string; title: string };

const pinnedBlock = (page: Page) => shell.sidebar(page).getByRole("region", { name: "Pinned chats" });
// Each chip's name, in order (its text would add its face's initials).
const chipNames = (page: Page) => pinnedBlock(page).locator(".mb-tile__name");
const chipNamed = (page: Page, title: string) => pinnedBlock(page).getByRole("button", { name: title, exact: true });
const roomsRows = (page: Page) => shell.section(page, "Rooms").locator("button.mb-row");
const roomRow = (page: Page, title: string) => shell.section(page, "Rooms").getByRole("button", { name: title, exact: true });
const chatNamed = (chatId: string) => new RegExp(`[?&]chat=${chatId}(&|$)`, "u");

async function box(target: ReturnType<Page["locator"]>) {
  const found = await target.boundingBox();
  expect(found, "it's laid out").toBeTruthy();
  return found!;
}

/**
 * A home of the test's own (homeWithBen) with a room for each of `pins`, pinned in that order by the owner, and the
 * unpinned rooms Garden and Bathroom; with `everyone`, the home's everyone chat too, as the welcome chat makes it. Ben
 * wrote the latest message in each pinned room. Runs `body`, then deletes the home.
 */
async function withPins(page: Page, pins: string[], body: (home: Home, rooms: Record<string, Room>) => Promise<void>, { everyone = false } = {}) {
  const knex: Knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const made = home;
    const rooms: Record<string, Room> = {};
    const room = async (title: string, extra: Record<string, unknown> = {}) => {
      const { id } = await seedChat(knex, { homeId: made.homeId, title, people: [made.owner, made.ben], bots: [made.chef], ...extra });
      rooms[title] = { id, title };
      return id;
    };
    if (everyone) await room(made.name, { everyone: true });
    for (const title of ["Garden", "Bathroom"]) await room(title);
    const api = await homeApi(page, made.path);
    for (const title of pins) {
      const id = await room(title);
      await seedMessage(knex, { homeId: made.homeId, chatId: id, userId: made.ben, body: { text: `${title}: tiles arrive Monday` } });
      await api.patch(`/chats/${id}/place`, { pinned: true });
    }
    await body(made, rooms);
  } finally {
    await home?.remove();
    await knex.destroy();
  }
}

test("one pinned chat is a chip across the sidebar, no taller than a Rooms row in the same list", async ({ page }) => {
  await withPins(page, ["Kitchen"], async (home) => {
    await openShell(page, "", home.path);
    await expect(chipNames(page)).toHaveText(["Kitchen"]);
    const block = await box(pinnedBlock(page));
    const chip = await box(chipNamed(page, "Kitchen"));
    const row = await box(roomRow(page, "Garden"));
    expect(block.height, "the Pinned chats block, against Garden's row").toBeLessThanOrEqual(row.height);
    expect(chip.height).toBeLessThanOrEqual(row.height);
    expect(Math.abs(chip.width - row.width), "as wide as a row").toBeLessThanOrEqual(1);
  });
});

test("two or more pinned chats are chips in two columns, in pin order, each no taller than a Rooms row", async ({ page }) => {
  await withPins(page, ["Kitchen", "Party", "Quotes", "Boiler"], async (home) => {
    await openShell(page, "", home.path);
    await expect(chipNames(page)).toHaveText(["Kitchen", "Party", "Quotes", "Boiler"]);
    const row = await box(roomRow(page, "Garden"));
    const [kitchen, party, quotes, boiler] = await Promise.all(["Kitchen", "Party", "Quotes", "Boiler"].map((title) => box(chipNamed(page, title))));
    for (const chip of [kitchen, party, quotes, boiler]) expect(chip.height).toBeLessThanOrEqual(row.height);
    expect([party.y, boiler.y], "two to a line").toEqual([kitchen.y, quotes.y]);
    expect([quotes.x, boiler.x], "two columns").toEqual([kitchen.x, party.x]);
    expect(quotes.y).toBeGreaterThan(kitchen.y);
    expect(party.x + party.width - kitchen.x, "together as wide as a row").toBeLessThanOrEqual(row.width + 1);
    expect((await box(pinnedBlock(page))).height, "two lines").toBeLessThanOrEqual(2 * row.height + 8);
  });
});

test("the everyone chat is the first row under Rooms with a pin mark, and alone it leaves no Pinned chats block", async ({ page }) => {
  await withPins(page, [], async (home) => {
    await openShell(page, "", home.path);
    const everyone = roomRow(page, home.name);
    await expect(roomsRows(page).first()).toHaveAccessibleName(home.name);
    await expect(everyone, "what opens with no chat named").toHaveAttribute("aria-current", "page");
    await expect(everyone.locator(".mb-row__pin")).toBeVisible();
    await expect(roomRow(page, "Garden").locator(".mb-row__pin")).toHaveCount(0);
    await expect(everyone).toHaveAttribute("draggable", "false");
    expect((await box(everyone)).height).toBe((await box(roomRow(page, "Garden"))).height);
    await expect(pinnedBlock(page)).toHaveCount(0);

    // Its menu has no Pin, Unpin, Move to, Leave, Archive or Delete.
    await everyone.click({ button: "right" });
    await expect(shell.menuItems(page)).toHaveText(["Mark as unread", "Rename chat", "Copy chat ID", "Hide from sidebar"]);
    await page.keyboard.press("Escape");

    // Another room pinned is the only chip; the everyone chat stays Rooms' first row.
    await roomRow(page, "Garden").click({ button: "right" });
    await shell.menuItems(page).filter({ hasText: /^Pin$/u }).click();
    await expect(chipNames(page)).toHaveText(["Garden"]);
    await expect(roomsRows(page).first()).toHaveAccessibleName(home.name);
    await expect(roomRow(page, "Garden")).toHaveCount(0);
  }, { everyone: true });
});

test("a chip opens its chat, shows it selected, and previews its latest message on hover", async ({ page }) => {
  await withPins(page, ["Kitchen", "Party"], async (home, rooms) => {
    await openShell(page, `?chat=${rooms.Garden.id}`, home.path);
    const kitchen = chipNamed(page, "Kitchen");
    await expect(kitchen).not.toHaveAttribute("aria-current", "page");

    await kitchen.hover();
    const preview = page.locator(".mb-tile-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Kitchen");
    await expect(preview).toContainText("Kitchen: tiles arrive Monday");

    await kitchen.click();
    await expect(page).toHaveURL(chatNamed(rooms.Kitchen.id));
    await expect(kitchen).toHaveAttribute("aria-current", "page");
    await expect(chipNamed(page, "Party")).not.toHaveAttribute("aria-current", "page");
    // Selected, it keeps the tile's background with the pointer away; the other chip has none.
    await shell.composer(page).hover();
    await expect(preview).toBeHidden();
    const themed = await page.locator(".v-application").evaluate((element) => getComputedStyle(element).getPropertyValue("--v-theme-secondary-container").trim());
    const background = (target: ReturnType<Page["locator"]>) => target.evaluate((element) => getComputedStyle(element).backgroundColor.replace(/\s/gu, ""));
    expect(await background(kitchen)).toBe(`rgb(${themed.replace(/\s/gu, "")})`);
    expect(await background(chipNamed(page, "Party"))).toBe("rgba(0,0,0,0)");
  });
});

test("a chip has a pinned chat's menu, and dragging it reorders the pins, showing the new order as it goes", async ({ page }) => {
  await withPins(page, ["Kitchen", "Party"], async (home, rooms) => {
    await openShell(page, `?chat=${rooms.Garden.id}`, home.path);
    await chipNamed(page, "Kitchen").click({ button: "right" });
    await expect(shell.menuItems(page)).toHaveText(["Unpin", "Mark as unread", "Rename chat", "Copy chat ID", "Hide from sidebar", "Leave chat", "Archive", "Delete"]);
    await page.keyboard.press("Escape");
    await expect(shell.menuItems(page)).toHaveCount(0);

    // Dragged over Party, Kitchen takes its place at once, and the block shows it's where the drop goes.
    await chipNamed(page, "Kitchen").hover();
    await page.mouse.down();
    const party = await box(chipNamed(page, "Party"));
    await page.mouse.move(party.x + party.width / 2, party.y + party.height / 2, { steps: 8 });
    await expect(chipNames(page)).toHaveText(["Party", "Kitchen"]);
    await expect(pinnedBlock(page)).toHaveClass(/\bmb-drop-zone\b/u);
    const saved = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === `/api${home.path}/chat-pins`);
    await page.mouse.up();
    const answer = await saved;
    expect(answer.ok()).toBe(true);
    expect(answer.request().postDataJSON()).toEqual({ chatIds: [rooms.Party.id, rooms.Kitchen.id] });
    await expect(pinnedBlock(page)).not.toHaveClass(/\bmb-drop-zone\b/u);
    await expect(chipNames(page)).toHaveText(["Party", "Kitchen"]);

    await openShell(page, "", home.path);
    await expect(chipNames(page), "kept").toHaveText(["Party", "Kitchen"]);
  });
});

test("a room's Move to shows the sections beside its menu, which stays open, and a section picked closes both and files the room", async ({ page }) => {
  await withPins(page, [], async (home, rooms) => {
    const api = await homeApi(page, home.path);
    const { sections } = await api.post("/chat-sections", { name: "Renovation" });
    const renovation = sections.find((section: { name: string }) => section.name === "Renovation");
    await openShell(page, `?chat=${rooms.Bathroom.id}`, home.path);
    await roomRow(page, "Garden").click({ button: "right" });
    const item = (name: string) => shell.menuItems(page).filter({ hasText: new RegExp(`^${name}$`, "u") });

    // A click on Move to, as on any row that only leads on, leaves the menu open, with the sections beside it.
    await item("Move to").click();
    await expect(item("Renovation")).toBeVisible();
    await expect(item("Unassigned")).toBeVisible();
    await expect(item("Move to"), "the room's menu is still open").toBeVisible();
    await expect(item("Pin")).toBeVisible();

    const moved = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api${home.path}/chats/${rooms.Garden.id}/place`);
    await item("Renovation").click();
    await expect(shell.menuItems(page), "both menus closed").toHaveCount(0);
    const answer = await moved;
    expect(answer.ok()).toBe(true);
    expect(answer.request().postDataJSON()).toEqual({ sectionId: renovation.id });
    await expect(shell.sidebar(page).locator(".mb-header__label").filter({ hasText: "Renovation" })).toBeVisible();

    await roomRow(page, "Garden").click({ button: "right" });
    await item("Move to").hover();
    const row = (name: string) => page.locator(".v-overlay--active .mb-menu .v-list-item").filter({ has: page.locator(".mb-menu__text", { hasText: new RegExp(`^${name}$`, "u") }) });
    await expect(row("Renovation").locator(".v-icon"), "the room's section is checked").toHaveCSS("opacity", "1");
    await expect(row("Unassigned").locator(".v-icon")).toHaveCSS("opacity", "0");
    await page.keyboard.press("Escape");
  });
});

test("a chip takes the keyboard's focus with a ring, and Enter opens its chat", async ({ page }) => {
  await withPins(page, ["Kitchen", "Party"], async (home, rooms) => {
    await openShell(page, `?chat=${rooms.Garden.id}`, home.path);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await shell.section(page, "Rooms").getByRole("button", { name: "Rooms", exact: true }).focus();
      await page.keyboard.press("Shift+Tab");
      const party = chipNamed(page, "Party");
      await expect(party).toBeFocused();
      const ring = await focusRing(party);
      expect(ring.style, colorScheme).toBe("solid");
      expect(ring.width, colorScheme).toBeGreaterThanOrEqual(2);
      expect(ring.ratio, `${colorScheme}: the ring against what's behind it`).toBeGreaterThanOrEqual(3);
    }
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(chatNamed(rooms.Party.id));
    await expect(chipNamed(page, "Party")).toHaveAttribute("aria-current", "page");
  });
});

test("Rename chat on a chip names it in place, a row's height: Enter keeps the new name, Escape the old one", async ({ page }) => {
  await withPins(page, ["Kitchen", "Party"], async (home, rooms) => {
    await openShell(page, `?chat=${rooms.Garden.id}`, home.path);
    const row = await box(roomRow(page, "Bathroom"));
    const rename = async (title: string) => {
      await chipNamed(page, title).click({ button: "right" });
      await shell.menuItems(page).filter({ hasText: /^Rename chat$/u }).click();
      const field = pinnedBlock(page).getByRole("textbox", { name: "Chat name" });
      await expect(field).toBeFocused();
      await expect(field).toHaveValue(title);
      expect(await field.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]), "its name selected").toEqual([0, title.length]);
      const chip = await box(field.locator("xpath=ancestor::button[1]"));
      expect(chip.height, "the chip stays a row's height").toBeLessThanOrEqual(row.height);
      const input = await box(field);
      expect(input.x + input.width, "the field within its chip").toBeLessThanOrEqual(chip.x + chip.width);
      return field;
    };

    // Enter keeps the new name, on the chip and for the chat.
    const kitchen = await rename("Kitchen");
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api${home.path}/chats/${rooms.Kitchen.id}`);
    await kitchen.fill("Kitchen and dining");
    await kitchen.press("Enter");
    const answer = await saved;
    expect([answer.ok(), answer.request().postDataJSON()]).toEqual([true, { title: "Kitchen and dining" }]);
    await expect(kitchen).toHaveCount(0);
    await expect(chipNames(page)).toHaveText(["Kitchen and dining", "Party"]);

    // Escape leaves it as it was, asking nothing of the server.
    const asked: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH") asked.push(new URL(request.url()).pathname);
    });
    const party = await rename("Party");
    await party.fill("Nothing");
    await party.press("Escape");
    await expect(party).toHaveCount(0);
    await expect(chipNames(page)).toHaveText(["Kitchen and dining", "Party"]);
    expect(asked).toEqual([]);
  });
});

test("on a phone the pinned chats are in the drawer, within its width, and a chip opens its chat and closes the drawer", async ({ page }) => {
  await withPins(page, ["Kitchen", "Party"], async (home, rooms) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await openShell(page, `?chat=${rooms.Garden.id}`, home.path);
    await shell.chat(page).getByRole("button", { name: "Your chats" }).click();
    await expect(chipNames(page)).toHaveText(["Kitchen", "Party"]);
    const sidebar = await box(shell.sidebar(page));
    for (const title of ["Kitchen", "Party"]) {
      const chip = await box(chipNamed(page, title));
      expect(chip.x + chip.width, `${title} within the drawer`).toBeLessThanOrEqual(sidebar.x + sidebar.width);
      expect(chip.height).toBeLessThanOrEqual((await box(roomRow(page, "Garden"))).height);
    }
    await chipNamed(page, "Party").click();
    await expect(page).toHaveURL(chatNamed(rooms.Party.id));
    await expect(shell.sidebar(page)).toBeHidden();
  });
});

/** The page light and dark, then at a phone's width with the drawer open, light and dark, as `<name>-<scheme>-<size>.png`. */
async function shots(page: Page, testInfo: TestInfo, name: string) {
  const size = page.viewportSize();
  for (const phone of [false, true]) {
    if (phone) {
      await page.setViewportSize({ width: 390, height: 844 });
      await shell.chat(page).getByRole("button", { name: "Your chats" }).click();
      await expect(shell.sidebar(page)).toBeVisible();
    }
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--(workspace-)?${scheme}\\b`, "u"));
      // The pointer off the sidebar, so nothing in it shows hovered.
      const { width = 1280, height = 720 } = page.viewportSize() ?? {};
      await page.mouse.move(width - 2, height / 2);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${scheme}-${phone ? "phone" : "desktop"}.png`), animations: "disabled" });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  if (size) await page.setViewportSize(size);
}

for (const count of [1, 2, 4]) {
  test(`${count} pinned ${count === 1 ? "chat" : "chats"} beside the everyone chat, light and dark, desktop and phone`, async ({ page }, testInfo) => {
    const pins = ["Kitchen", "Saturday party", "Quotes from the builders", "Boiler"].slice(0, count);
    await withPins(page, pins, async (home, rooms) => {
      await openShell(page, `?chat=${rooms.Kitchen.id}`, home.path);
      await expect(chipNamed(page, pins.at(-1)!)).toBeVisible();
      await shots(page, testInfo, `pinned-${count}`);
      await expect(chipNames(page)).toHaveText(pins);
      await expect(roomsRows(page).first()).toHaveAccessibleName(home.name);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        for (const title of pins) expect(await textContrast(chipNamed(page, title)), `${colorScheme}: ${title}'s name`).toBeGreaterThanOrEqual(4.5);
      }
    }, { everyone: true });
  });
}
