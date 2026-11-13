import knexLib, { type Knex } from "knex";
import { MADE_UP, expect, test, testDatabaseName, type Page } from "./harness";

// The final sweep's finishing touches, on the Test Preview target: the "new messages" pill while scrolled up,
// the right-click menus on messages and pictures, how the person's own messages lay out on a phone and on a
// computer, and the Library's ages, hover cards and page actions. Each test makes its own bot, writes what it
// needs straight to the database or through the API, and deletes the bot after. Run with: vibe64-helper playwright --target test-app test
// tests/e2e/final-sweep.spec.ts
const HOME = "/w/you";
// The test target's AI is the stand-in model (tools/standInModel.mjs): a reply says so in the chat.
const STAND_IN_REPLY = /runs on a stand-in model, which only plays the bot templates/u;
// Any refused API call from the page, or JSKIT's error dialog, fails the test (harness.ts). Copy reads the clipboard.
test.use({ apiGuard: true, permissions: ["clipboard-read", "clipboard-write"] });

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

const chat = (page: Page) => page.getByRole("main", { name: "Chat" });
const sidebarBot = (page: Page, name: string) => page.getByRole("navigation", { name: "Bots" }).getByRole("button", { name, exact: true });
const menuItems = (page: Page) => page.locator(".v-overlay--active .mb-menu .mb-menu__text");
const clipboardText = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

type Made = { bot: { id: string }; name: string; headers: { "csrf-token": string }; knex: Knex };

// A new bot for one test, past its first-run interview, deleted afterwards.
async function withBot(page: Page, label: string, run: (made: Made) => Promise<void>) {
  await openHome(page);
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const headers = { "csrf-token": csrfToken };
  const name = `${label} ${Date.now().toString(36)}`;
  const created = await page.request.post(`/api${HOME}/bots`, { headers, data: { name, color: "#1E86FC" } });
  expect(created.ok()).toBe(true);
  const { bot } = await created.json();
  const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });
  try {
    await knex("bot_conversations").where({ bot_id: bot.id }).whereNotNull("user_id").update({ onboarding_step: null });
    await run({ bot, name, headers, knex });
  } finally {
    await knex.destroy();
    // Left first, so the page doesn't go on reading the bot once it's gone (the API guard would see that).
    await page.goto("about:blank");
    await page.request.delete(`/api${HOME}/bots/${bot.id}`, { headers });
  }
}

// Messages written into the person's chat with the bot, oldest first: [kind, role, body, and when, if not now]. Their ids.
async function seed({ bot, knex }: Made, rows: Array<[string, string, object, Date?]>) {
  const conversation = await knex("bot_conversations").where({ bot_id: bot.id }).whereNotNull("user_id").first();
  const written = await knex("bot_messages").insert(rows.map(([kind, role, body, createdAt]) => ({
    bot_id: bot.id,
    conversation_id: conversation.id,
    workspace_id: conversation.workspace_id,
    kind,
    role,
    body,
    ...(createdAt ? { created_at: createdAt } : {})
  }))).returning("id");
  return written.map((row: { id: number }) => String(row.id));
}

// A file put in the bot's folder, as the chat's attach does; its path.
async function upload(page: Page, { bot, headers }: Made, name: string, mimeType: string, buffer: Buffer) {
  const response = await page.request.post(`/api${HOME}/bots/${bot.id}/files/upload`, { headers, multipart: { file: { name, mimeType, buffer } } });
  expect(response.ok()).toBe(true);
  return String((await response.json()).path);
}

// An orange picture, drawn by the page: a small one unless a size is given.
async function pictureBytes(page: Page, width = 160, height = 120) {
  const data = await page.evaluate(({ w, h }) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const pen = canvas.getContext("2d") as CanvasRenderingContext2D;
    pen.fillStyle = "#F2994A";
    pen.fillRect(0, 0, w, h);
    return canvas.toDataURL("image/png");
  }, { w: width, h: height });
  return Buffer.from(data.split(",")[1], "base64");
}

async function openChat(page: Page, name: string) {
  await openHome(page);
  await sidebarBot(page, name).click();
}

test("a reply that arrives while scrolled up shows in a new messages pill, which goes down to it or is dismissed", async ({ page }) => {
  await withBot(page, "Pill", async (made) => {
    await seed(made, Array.from({ length: 60 }, (_, index): [string, string, object] => ["text", index % 2 ? "bot" : "user", { text: `Line ${index + 1}` }]));
    await openChat(page, made.name);
    await expect(chat(page).getByText("Line 60", { exact: true })).toBeVisible();
    const scroller = chat(page).locator(".mb-chat__scroller");
    const pill = chat(page).locator(".mb-new-pill");
    const pillCount = pill.locator(".mb-new-pill__jump");
    const toLatest = chat(page).getByRole("button", { name: "Scroll to the latest message" });
    // A question and its answer, from elsewhere (the API): the page hears of them from the server.
    const askElsewhere = async (text: string) => {
      const sent = await page.request.post(`/api${HOME}/bots/${made.bot.id}/messages`, { headers: made.headers, data: { text } });
      expect(sent.ok()).toBe(true);
      const [question] = (await sent.json()).messages;
      const replied = await page.request.post(`/api${HOME}/bots/${made.bot.id}/reply`, { headers: made.headers, data: { afterMessageId: question.id, timeZone: "UTC", language: "en" } });
      expect(replied.ok()).toBe(true);
    };

    // Up to the top, once the chat's own glide down has ended: a scroll during it (900 ms, useChatScroll) counts as the chat's.
    const scrollUp = async () => {
      await page.waitForTimeout(1000);
      await scroller.evaluate((element) => element.scrollTo({ top: 0 }));
    };

    await scrollUp();
    await expect(toLatest).toBeVisible();
    await askElsewhere(`Pill question ${Date.now()}`);
    await expect(pillCount, "the person's own question isn't counted, the answer is").toHaveText("1 new message");
    await expect(chat(page).getByText(STAND_IN_REPLY).last()).not.toBeInViewport();
    expect(await scroller.evaluate((element) => element.scrollTop), "the view stays where it was").toBeLessThan(80);
    await pillCount.click();
    await expect(chat(page).getByText(STAND_IN_REPLY).last()).toBeInViewport();
    await expect(pill).toBeHidden();

    await scrollUp();
    await askElsewhere(`Pill question again ${Date.now()}`);
    await expect(pillCount).toHaveText("1 new message");
    await pill.getByRole("button", { name: "Dismiss new messages" }).click();
    await expect(pill).toBeHidden();
    await expect(toLatest, "dismissed, the plain button is back").toBeVisible();
    await expect(chat(page).getByText(STAND_IN_REPLY).last()).not.toBeInViewport();
  });
});

test("right-clicking a message offers Reply, Copy and Copy request ID, a bot's adds reactions, and a picture copies or saves", async ({ page }) => {
  await withBot(page, "Menus", async (made) => {
    const path = await upload(page, made, "cake.png", "image/png", await pictureBytes(page));
    const [question, answer, pictures] = await seed(made, [
      ["text", "user", { text: "What's for dinner?" }],
      ["text", "bot", { heading: "Dinner", bullets: ["Soup", "Bread"] }],
      ["pictures", "bot", { images: [{ path, title: "Cake", caption: "A cake" }] }]
    ]);
    await openChat(page, made.name);
    const message = (id: string) => chat(page).locator(`[data-message-id="${id}"]`);
    const reactions = page.locator(".v-overlay--active .mb-menu__reactions").getByRole("button");
    await expect(message(answer)).toBeVisible();

    await message(answer).locator(".mb-bubble").click({ button: "right" });
    await expect(reactions).toHaveCount(6);
    await expect(menuItems(page)).toHaveText(["Reply", "Copy", "Copy request ID"]);
    await menuItems(page).filter({ hasText: /^Copy$/u }).click();
    await expect.poll(() => clipboardText(page)).toBe("Dinner\nSoup\nBread");
    await expect(page.getByText("Message copied")).toBeVisible();

    await message(answer).locator(".mb-bubble").click({ button: "right" });
    await menuItems(page).filter({ hasText: "Copy request ID" }).click();
    await expect.poll(() => clipboardText(page)).toBe(`req_${answer}`);

    await message(answer).locator(".mb-bubble").click({ button: "right" });
    await page.getByRole("button", { name: "React with 🙏" }).click();
    await expect(message(answer).locator(".mb-reaction")).toHaveText("🙏");
    await message(answer).locator(".mb-bubble").click({ button: "right" });
    await expect(page.getByRole("button", { name: "React with 🙏" }), "the chosen reaction shows as chosen").toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");

    await message(question).locator(".mb-bubble").click({ button: "right" });
    await expect(menuItems(page)).toHaveText(["Reply", "Copy", "Copy request ID"]);
    await expect(reactions, "the person's own message has no reactions row").toHaveCount(0);
    await menuItems(page).filter({ hasText: "Reply" }).click();
    await expect(chat(page).locator(".mb-composer__reply")).toHaveText("What's for dinner?");

    const picture = message(pictures).locator("img");
    await expect(picture).toBeVisible();
    await picture.click({ button: "right" });
    await expect(menuItems(page)).toHaveText(["Copy image", "Save image"]);
    await expect(reactions).toHaveCount(0);
    const download = page.waitForEvent("download");
    await menuItems(page).filter({ hasText: "Save image" }).click();
    expect((await download).suggestedFilename(), "saved under its file's own name").toBe("cake.png");
    await picture.click({ button: "right" });
    await menuItems(page).filter({ hasText: "Copy image" }).click();
    await expect(page.getByText("Image copied")).toBeVisible();
    expect(await page.evaluate(async () => (await navigator.clipboard.read())[0].types)).toContain("image/png");
  });
});

// Where a message and its parts are on the page, by message id ("stamp-<id>" for the time above a message).
async function layout(page: Page, ids: string[]) {
  return page.evaluate((wanted) => {
    const box = (element: Element | Range | null) => {
      if (!element) return null;
      const { top, bottom, left, right, width, height } = element.getBoundingClientRect();
      return { top, bottom, left, right, width, height };
    };
    const words = (element: Element | null) => {
      if (!element) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      return box(range);
    };
    const timeline = document.querySelector(".mb-timeline") as Element;
    const parts = Object.fromEntries(wanted.map((id) => {
      const item = timeline.querySelector(`[data-message-id="${id}"]`) as Element;
      const quote = item.querySelector(".mb-bubble__quote") as HTMLElement | null;
      return [id, {
        item: box(item),
        message: box(item.querySelector(".mb-message")),
        bubble: box(item.querySelector(".mb-bubble")),
        actions: box(item.querySelector(".mb-actions")),
        failed: box(item.querySelector(".mb-message__failed")),
        retry: box(item.querySelector(".mb-timeline__retry")),
        picture: box(item.querySelector(".mb-bubble__picture")),
        fileName: box(item.querySelector(".mb-bubble__file-name")),
        stamp: words(item.querySelector(".mb-timeline__centred")),
        quoteCut: quote ? quote.scrollWidth > quote.clientWidth : null
      }];
    }));
    const root = document.documentElement;
    return { timeline: box(timeline), parts, sideways: root.scrollWidth > root.clientWidth + 1 };
  }, ids);
}

// A person's own messages keep their actions (hidden until hovered) beside the bubble at every width, as a bot's do,
// down to a 320 px phone. They wrapped onto a line of their own under a wide message on a phone, an empty band of about
// 38 px below it.
test("a person's messages have nothing under them on a phone, and short ones, long words, pictures, files, times and Not sent. lay out as before", async ({ page }) => {
  await withBot(page, "Layout", async (made) => {
    const path = await upload(page, made, "cake.png", "image/png", await pictureBytes(page));
    const bigPath = await upload(page, made, "garden.png", "image/png", await pictureBytes(page, 480, 360));
    const wide = "A message wide enough to fill a phone's screen and more. ".repeat(3).trim();
    const ids = await seed(made, [
      ["text", "user", { text: "Hi" }, new Date(Date.now() - 3_600_000)],
      ["text", "user", { text: wide }],
      ["text", "user", { text: `https://example.com/${"averylongword".repeat(12)}` }],
      ["text", "user", { text: "Our cake", attachments: [{ name: "cake.png", type: "image/png", size: 1, path }] }],
      ["text", "user", { text: "Our garden", attachments: [{ name: "garden.png", type: "image/png", size: 1, path: bigPath }] }],
      ["text", "user", { text: "And this", replyTo: { text: wide } }],
      ["text", "user", { text: "The report", attachments: [{ name: "Quarterly_report_for_the_whole_family_budget_2026_final.pdf", type: "application/pdf", size: 120_000 }] }]
    ]);
    const [short, wideId, link, withPicture, withBigPicture, reply, report] = ids;
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${HOME}?bot=${made.bot.id}`);
      for (const id of ids) await expect(chat(page).locator(`[data-message-id="${id}"] .mb-bubble`)).toBeVisible();
      await expect.poll(() => chat(page).locator(".mb-bubble__picture").evaluateAll((images: HTMLImageElement[]) => images.map((image) => image.naturalWidth))).toEqual([160, 480]);
      const { timeline, parts, sideways } = await layout(page, [...ids, `stamp-${wideId}`]);
      expect(sideways, `nothing runs off the page's side at ${width} px`).toBe(false);
      for (const id of ids) {
        const { message, bubble, actions } = parts[id];
        expect(message!.bottom - bubble!.bottom, `nothing under message ${id} at ${width} px`).toBeLessThanOrEqual(1);
        expect(actions!.right, `its actions beside its bubble at ${width} px`).toBeLessThanOrEqual(bubble!.left);
        expect(actions!.top).toBeGreaterThanOrEqual(bubble!.top - 1);
        expect(actions!.bottom).toBeLessThanOrEqual(bubble!.bottom + 1);
        expect(actions!.left, `within the chat at ${width} px`).toBeGreaterThanOrEqual(timeline!.left - 1);
        expect(Math.abs(bubble!.right - timeline!.right), `at the chat's right at ${width} px`).toBeLessThanOrEqual(1);
      }
      expect(parts[short].bubble!.width, "a short message's bubble fits its words").toBeLessThan(60);
      expect(parts[short].bubble!.height, "on one line").toBeLessThan(40);
      expect(parts[link].bubble!.height, "a long link wraps inside its bubble").toBeGreaterThan(60);
      expect(parts[withPicture].picture!.width, "a small picture keeps its own size").toBe(160);
      // A big one is 240 px wide where there's room, and narrows with its bubble on the narrowest phones.
      const big = parts[withBigPicture];
      if (width === 320) expect(big.picture!.width, "a big picture narrows on a 320 px phone").toBeLessThan(240);
      else expect(big.picture!.width, `a big picture is 240 px wide at ${width} px`).toBe(240);
      expect(big.picture!.right, `a big picture stays inside its bubble at ${width} px`).toBeLessThanOrEqual(big.bubble!.right - 12);
      expect(parts[reply].quoteCut, "a long quoted line ends in an ellipsis").toBe(true);
      expect(parts[report].fileName!.right, "a long file name stays inside its bubble").toBeLessThanOrEqual(parts[report].bubble!.right);
      const stamp = parts[`stamp-${wideId}`].stamp!;
      expect(Math.abs(stamp.left + stamp.right - timeline!.left - timeline!.right) / 2, "the time after a gap is centred").toBeLessThanOrEqual(1);
      expect(stamp.bottom).toBeLessThanOrEqual(parts[wideId].item!.top);
    }

    // "Not sent." takes a line of its own under the bubble, at its right, with nothing under it.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(`**/api${HOME}/bots/${made.bot.id}/messages`, (route) => (route.request().method() === "POST"
      ? route.fulfill({ status: 400, contentType: "application/json", headers: { [MADE_UP]: "1" }, body: JSON.stringify({ error: "Pinned failure" }) })
      : route.fallback()));
    const composer = chat(page).getByRole("textbox", { name: `Message ${made.name}` });
    await composer.fill(wide);
    await composer.press("Enter");
    const failed = chat(page).locator(".mb-timeline__item").filter({ has: page.locator(".mb-message__failed") });
    await expect(failed.getByRole("button", { name: "Try again" })).toBeVisible();
    const failedId = String(await failed.getAttribute("data-message-id"));
    const { parts: { [failedId]: unsent } } = await layout(page, [failedId]);
    expect(unsent.failed!.top, "Not sent. under the bubble").toBeGreaterThanOrEqual(unsent.bubble!.bottom);
    expect(Math.abs(unsent.retry!.right - unsent.bubble!.right), "at its right").toBeLessThanOrEqual(1);
    expect(unsent.message!.bottom - unsent.failed!.bottom, "nothing under it").toBeLessThanOrEqual(1);
  });
});

test("the Library shows ages and hover cards, and a page opens, shares and is deleted after a confirmation", async ({ page }) => {
  await withBot(page, "Library", async (made) => {
    const pageText = "# Weekly plan\n\nSoup on Monday.\n";
    const pagePath = await upload(page, made, "weekly-plan.md", "text/markdown", Buffer.from(pageText));
    const picturePath = await upload(page, made, "cake.png", "image/png", await pictureBytes(page));
    await seed(made, [
      ["pictures", "bot", { images: [{ path: picturePath, title: "Cake", caption: "A cake" }] }],
      ["page", "bot", { title: "Weekly plan", path: pagePath, summary: "Meals for the week" }]
    ]);
    await openChat(page, made.name);
    await chat(page).getByRole("button", { name: `${made.name} details` }).click();
    const details = page.getByRole("complementary", { name: "Details" });
    await details.getByRole("tab", { name: "Library" }).click();
    const row = (title: string) => details.locator(".mb-library__row").filter({ hasText: title });
    await expect(row("Weekly plan").locator(".mb-library__age")).toHaveText(/^(now|\dm)$/u);
    await expect(row("Cake").locator(".mb-library__age")).toHaveText(/^(now|\dm)$/u);

    // Hovering a row shows its card: what it is, its bot, when, and for a page who can open it.
    await row("Weekly plan").hover();
    const hoverCard = page.locator(".mb-hover-card").filter({ hasText: "Weekly plan" });
    await expect(hoverCard).toBeVisible();
    for (const text of ["Page", "Weekly plan", made.name, "Only you"]) await expect(hoverCard).toContainText(text);
    await page.mouse.move(0, 0);
    await expect(hoverCard).toBeHidden();

    // A picture's menu only pins; a page's opens, shares, pins and deletes. "…" works from the keyboard: Enter
    // opens its menu, the arrows reach its rows, and Escape closes it with focus back on "…". An arrow typed
    // straight after Enter, before the menu shows and can take focus, still reaches its first row.
    const cakeMore = row("Cake").getByRole("button", { name: "More for Cake" });
    const firstRow = page.locator(".v-overlay--active .mb-menu .v-list-item").first();
    await expect(cakeMore).toHaveAttribute("aria-haspopup", "menu");
    await cakeMore.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await expect(menuItems(page)).toHaveText(["Pin"]);
    await expect(cakeMore).toHaveAttribute("aria-expanded", "true");
    await expect(firstRow).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menuItems(page)).toHaveCount(0);
    await expect(cakeMore).toBeFocused();
    await expect(cakeMore).toHaveAttribute("aria-expanded", "false");
    // And an arrow pressed once the menu shows.
    await page.keyboard.press("Enter");
    await expect(firstRow).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(firstRow).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(cakeMore).toBeFocused();
    await row("Weekly plan").getByRole("button", { name: "More for Weekly plan" }).click();
    await expect(menuItems(page)).toHaveText(["Open", "Share…", "Pin", "Delete"]);

    await menuItems(page).filter({ hasText: "Share…" }).click();
    const share = page.getByRole("region", { name: "Share Weekly plan" });
    await expect(share.getByRole("radio")).toContainText("Only you");
    await expect(share).toContainText("(you)");
    await share.getByRole("button", { name: "Copy text" }).click();
    await expect.poll(() => clipboardText(page)).toBe(pageText);
    await expect(page.getByText("Page copied")).toBeVisible();
    const download = page.waitForEvent("download");
    await share.getByRole("link", { name: "Download" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.md$/u);
    await share.getByRole("button", { name: "Close" }).click();
    await expect(share).toBeHidden();

    // A right-click opens the same menu at the pointer; Open shows the page in place of the chat (D-74).
    await row("Weekly plan").click({ button: "right" });
    await menuItems(page).filter({ hasText: "Open" }).click();
    const viewer = page.getByRole("region", { name: "Page: Weekly plan" });
    await expect(viewer).toContainText("Soup on Monday.");
    await viewer.getByRole("button", { name: "Close page" }).click();
    await expect(viewer).toBeHidden();

    await row("Weekly plan").getByRole("button", { name: "More for Weekly plan" }).click();
    await menuItems(page).filter({ hasText: "Delete" }).click();
    const confirm = page.locator(".mb-confirm");
    await expect(confirm).toContainText("Delete “Weekly plan”?");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(row("Weekly plan")).toHaveCount(0);
    await expect(row("Cake")).toBeVisible();
    await expect(chat(page).getByRole("button", { name: "Page Weekly plan, deleted" }), "its card stays, marked deleted").toBeDisabled();
    const gone = await page.request.get(`/api${HOME}/bots/${made.bot.id}/files/content?path=${encodeURIComponent(pagePath)}`);
    expect(gone.status(), "its file is deleted").toBe(404);
  });
});
