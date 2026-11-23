import type { TestInfo } from "@playwright/test";
import { composerFits, connectTestDb, expect, homeWithBen, openShell, seedChat, shell, test, type Page } from "./harness";

// The composer's text (D-114), on the Test Preview target, in a home of each test's own with a second person, Ben Rossi,
// and the owner's bot Chef, and with scrollbars as a desktop draws them, taking room beside the text they scroll (the
// suite's headless Chromium hides them otherwise). A skill, then a mention of Ben and of Chef, are drawn once, by the
// layer behind the masked field, with the field's own glyph widths and every character where the field has it: on one
// line, wrapped, and past six lines scrolled to its end and its start, light and dark, on a wide window and a phone. And
// typed a character at a time across the point where it stops fitting beside the buttons, and deleted back, the text
// stacks above them and goes back exactly there, no frame showing a scrolled or clipped field, on a wide window and a
// phone. Screenshots of the composer close up, light and dark, wide and phone, are the output. Each test deletes the
// home and the person it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/composer-text.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true, launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

type Home = Awaited<ReturnType<typeof homeWithBen>>;

/**
 * How the composer draws its text, two frames after the last change (the layer behind it follows the field's scroll a
 * frame later): whether that layer (the mirror, there while the text has a token) draws it, whether the field's own
 * text is then masked (transparent, its caret not), the text the mirror draws (the avatars over "@" left out), the
 * mirror's parts whose glyph-sizing styles differ from the field's, and the furthest any character the mirror draws
 * sits from where the field lays it out. The field's layout is read from a copy of it: a box over it with every style
 * the field computes, holding its text, scrolled as the field is.
 */
const drawing = (page: Page) => page.locator(".mb-composer__field").evaluate(async (field) => {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const input = field.querySelector("textarea.mb-composer__input") as HTMLTextAreaElement;
  const mirror = field.querySelector(".mb-composer__mirror");
  const shown = (colour: string) => colour !== "transparent" && !/^rgba\(.*,\s*0\)$/u.test(colour);
  const look = getComputedStyle(input);
  const drawn = { value: input.value, mirror: Boolean(mirror), masked: !shown(look.color), caret: shown(look.caretColor), text: "", styles: [] as string[], furthest: 0, at: "" };
  if (!mirror) return drawn;
  const texts: Text[] = [];
  const walk = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    if (!node.parentElement?.closest(".mb-mention__avatar")) texts.push(node as Text);
  }
  drawn.text = texts.map((node) => node.data).join("");
  const SIZING = ["font-family", "font-size", "font-weight", "font-style", "font-stretch", "font-variant", "font-feature-settings", "font-variation-settings",
    "font-kerning", "letter-spacing", "word-spacing", "text-transform", "line-height", "white-space", "overflow-wrap", "tab-size"];
  for (const part of new Set(texts.map((node) => node.parentElement as Element))) {
    const style = getComputedStyle(part);
    for (const name of SIZING) {
      if (style.getPropertyValue(name) !== look.getPropertyValue(name)) drawn.styles.push(`${part.className}: ${name} ${style.getPropertyValue(name)}, the field's ${look.getPropertyValue(name)}`);
    }
  }
  const copy = document.createElement("div");
  for (const name of Array.from(look)) copy.style.setProperty(name, look.getPropertyValue(name));
  const box = input.getBoundingClientRect();
  Object.assign(copy.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, margin: "0", visibility: "hidden", pointerEvents: "none" });
  copy.textContent = input.value;
  document.body.append(copy);
  copy.scrollTop = input.scrollTop;
  const place = (node: Text, at: number) => {
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 1);
    return range.getClientRects()[0];
  };
  let index = 0;
  for (const node of texts) {
    for (let at = 0; at < node.data.length; at += 1, index += 1) {
      if (index >= input.value.length || /\s/u.test(input.value[index])) continue;
      const there = place(node, at);
      const laid = place(copy.firstChild as Text, index);
      const off = Math.max(Math.abs(there.left - laid.left), Math.abs(there.top - laid.top));
      if (off > drawn.furthest) Object.assign(drawn, { furthest: off, at: `${JSON.stringify(input.value.slice(Math.max(0, index - 16), index))} before "${input.value[index]}"` });
    }
  }
  copy.remove();
  return drawn;
});

/** The composer's text, with a token in it, is drawn once: by the mirror over the masked field, each character where the field has it. */
async function expectDrawnOnce(page: Page, where: string) {
  const drawn = await drawing(page);
  expect({ mirror: drawn.mirror, masked: drawn.masked, caret: drawn.caret, text: drawn.text, styles: drawn.styles, aligned: drawn.furthest <= 0.5 },
    `${where}: the furthest the mirror draws a character from the field's is ${drawn.furthest.toFixed(2)} px, at ${drawn.at || "none"}`)
    .toEqual({ mirror: true, masked: true, caret: true, text: `${drawn.value}\u200b`, styles: [], aligned: true });
}

/** The composer close up, light and dark, on this window and then at a phone's width (390 by 844), its text drawn once in each. */
async function composerShots(page: Page, testInfo: TestInfo, name: string) {
  const size = page.viewportSize();
  for (const phone of [false, true]) {
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--(workspace-)?${scheme}\\b`, "u"));
      await expect.poll(() => composerFits(page)).toBe(true);
      await expectDrawnOnce(page, `${name}, ${scheme}${phone ? ", on a phone" : ""}`);
      const box = await page.locator(".mb-composer").boundingBox();
      const view = page.viewportSize();
      if (!box || !view) throw new Error("no composer to photograph");
      const left = Math.max(0, box.x - 16);
      const top = Math.max(0, box.y - 16);
      const clip = { x: left, y: top, width: Math.min(view.width, box.x + box.width + 16) - left, height: Math.min(view.height, box.y + box.height + 16) - top };
      await page.screenshot({ path: testInfo.outputPath(`${name}${phone ? "-phone" : ""}-${scheme}.png`), clip, animations: "disabled" });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  if (size) await page.setViewportSize(size);
  await expect.poll(() => composerFits(page)).toBe(true);
}

/** The composer as the next frame paints it: stacked or not, the field's width, and its text. */
const composerNow = (page: Page) => shell.composer(page).evaluate((field: HTMLTextAreaElement) => new Promise<{ stacked: boolean; width: number; value: string }>((resolve) => {
  requestAnimationFrame(() => resolve({ stacked: Boolean(field.closest(".mb-composer--stacked")), width: field.getBoundingClientRect().width, value: field.value }));
}));

/** Whether `text` fits on one line beside the buttons: in a copy of the field, unstacked and `width` wide. */
const fitsBeside = (page: Page, text: string, width: number) => shell.composer(page).evaluate((field: HTMLTextAreaElement, { text: shown, width: wide }) => {
  const probe = field.cloneNode() as HTMLTextAreaElement;
  Object.assign(probe.style, { position: "fixed", left: "0", top: "0", width: `${wide}px`, height: "22px", flex: "none", visibility: "hidden" });
  field.closest(".mb-composer")?.after(probe);
  probe.value = shown;
  const fits = probe.scrollHeight <= probe.clientHeight;
  probe.remove();
  return fits;
}, { text, width });

/**
 * Types "One two three four " a character at a time into the empty composer until it stacks its text above its buttons
 * and 8 more, then deletes a character at a time until it's one line beside them again and 8 more. Every frame
 * meanwhile, the field must show its text from the first line with none hidden: resolves with the frames that didn't
 * (the first 5), and each crossing: the text that first stacked, or last did before the text went back beside the
 * buttons, and the field's width there.
 */
async function typeAcross(page: Page) {
  const composer = shell.composer(page);
  await composer.fill("");
  await composer.click();
  await expect(page.locator(".mb-composer--stacked")).toHaveCount(0);
  await composer.evaluate((field: HTMLTextAreaElement) => {
    const watch = window as unknown as { e2eClipped: string[]; e2eWatching: object | null };
    const clipped: string[] = [];
    const watching = {};
    Object.assign(watch, { e2eClipped: clipped, e2eWatching: watching });
    const look = () => {
      if (watch.e2eWatching !== watching || !field.isConnected) return;
      if (field.scrollHeight > field.clientHeight || field.scrollTop > 0) {
        clipped.push(`${JSON.stringify(field.value)}: ${field.scrollHeight} px of text in ${field.clientHeight}, scrolled ${field.scrollTop}`);
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  const phrase = "One two three four ";
  const crossings: Array<{ text: string; width: number }> = [];
  let width = 0;
  let after = -1;
  for (let typed = 0; after < 8; typed += 1) {
    expect(typed, "the text stacks within 400 characters").toBeLessThan(400);
    await page.keyboard.type(phrase[typed % phrase.length]);
    const now = await composerNow(page);
    if (!now.stacked && after < 0) width = now.width;
    else if (after < 0) crossings.push({ text: now.value, width });
    if (now.stacked || after >= 0) after += 1;
  }
  let stackedText = "";
  after = -1;
  for (let deleted = 0; after < 8; deleted += 1) {
    expect(deleted, "the text goes back beside the buttons within 400 deletions").toBeLessThan(400);
    await page.keyboard.press("Backspace");
    const now = await composerNow(page);
    if (now.stacked && after < 0) stackedText = now.value;
    else if (after < 0) crossings.push({ text: stackedText, width: now.width });
    if (!now.stacked || after >= 0) after += 1;
  }
  const clipped = await page.evaluate(() => {
    const watch = window as unknown as { e2eClipped: string[]; e2eWatching: object | null };
    watch.e2eWatching = null;
    return watch.e2eClipped;
  });
  return { clipped: clipped.slice(0, 5), crossings };
}

test("a mention of a person or a bot, and a skill, are drawn once in the composer, each character where the field has it", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const room = await seedChat(knex, { homeId: home.homeId, title: `Workshop ${home.stamp}`, people: [home.owner, home.ben], bots: [home.chef] });
    await openShell(page, `?chat=${room.id}`, home.path);
    const composer = shell.composer(page);
    await composer.click();

    // Without a token, the field draws its own text.
    await composer.pressSequentially("Plain words");
    expect(await drawing(page), "no token: the field's own text, unmasked").toMatchObject({ mirror: false, masked: false });
    await composer.fill("");

    // The room's one bot's skill, then Ben and Chef, then the owner's words: one line beside the buttons.
    await composer.pressSequentially("/Gro");
    await shell.chat(page).getByRole("listbox", { name: "Skills" }).getByRole("option", { name: /^Groceries/u }).click();
    await composer.pressSequentially("@Be");
    await shell.chat(page).getByRole("listbox", { name: "Mention" }).getByRole("option", { name: /Ben Rossi/u }).click();
    await composer.pressSequentially("and @Ch");
    await shell.chat(page).getByRole("listbox", { name: "Mention" }).getByRole("option", { name: /Chef/u }).click();
    await composer.pressSequentially("This is funky fonting.");
    await expect(composer).toHaveValue("/Groceries @Ben Rossi and @Chef This is funky fonting.");
    await expect(page.locator(".mb-composer--stacked")).toHaveCount(0);
    await expectDrawnOnce(page, "one line");
    await composerShots(page, testInfo, "composer-tokens");

    // A line of its own long enough to wrap: stacked above the buttons.
    await composer.press("Shift+Enter");
    await composer.pressSequentially("Every letter after the mentions sits where the field has it, however far the line runs on and wraps round.");
    await expect(page.locator(".mb-composer--stacked")).toHaveCount(1);
    await expectDrawnOnce(page, "two lines and a wrap");

    // More lines than the field shows: it scrolls, and so does what draws its text, at the end and back at the start.
    for (const line of ["One", "two", "three", "four", "five"]) {
      await composer.press("Shift+Enter");
      await composer.pressSequentially(line);
    }
    await expect.poll(() => composer.evaluate((field: HTMLTextAreaElement) => field.scrollHeight > field.clientHeight)).toBe(true);
    expect(await composer.evaluate((field: HTMLTextAreaElement) => field.offsetWidth - field.clientWidth), "its scrollbar takes room beside the text").toBeGreaterThan(0);
    await expectDrawnOnce(page, "more lines than it shows, at the end");
    await composer.evaluate((field: HTMLTextAreaElement) => { field.scrollTop = 0; });
    await expectDrawnOnce(page, "more lines than it shows, at the start");
    await composerShots(page, testInfo, "composer-tokens-lines");
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("the composer stacks its text the moment it no longer fits beside the buttons, never showing a scrolled line", async ({ page }) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const room = await seedChat(knex, { homeId: home.homeId, title: `Workshop ${home.stamp}`, people: [home.owner, home.ben], bots: [home.chef] });
    await openShell(page, `?chat=${room.id}`, home.path);
    for (const [where, size] of [["a wide window", { width: 1440, height: 900 }], ["a phone", { width: 390, height: 844 }]] as const) {
      await page.setViewportSize(size);
      const { clipped, crossings } = await typeAcross(page);
      expect(clipped, `on ${where}, every frame shows the field's text from its first line, none of it hidden`).toEqual([]);
      expect(crossings, `on ${where}, the text stacks once and goes back once`).toHaveLength(2);
      for (const { text, width } of crossings) {
        expect([await fitsBeside(page, text.slice(0, -1), width), await fitsBeside(page, text, width)],
          `on ${where}, ${JSON.stringify(text)} is where the text stops fitting beside the buttons, ${width.toFixed(2)} px wide`).toEqual([true, false]);
      }
    }
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});
