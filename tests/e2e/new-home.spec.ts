import type { Locator, TestInfo } from "@playwright/test";
import { connectTestDb, expect, homeApi, openShell, shell, test, type Page } from "./harness";

// New home (D-36, D-109, D-112) as a person meets it, on the Test Preview target. Create a home opens New home, which
// asks only the home's name: no choice of who it's for or of how bots are shared, no teams, no cards, nothing that says
// "A team" (a team is only ever a set of bots, D-105). Create home makes it and goes there, and it starts with just
// Mercbot and one chat, the person's welcome chat with it (D4): no other bot, and no chat with everyone until the person
// says other people will use it. Screenshots light, dark and phone. The test deletes the home it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/new-home.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

// The shell, past the introduction a person sees in their first home (a second home skips it, D-36).
async function pastIntro(page: Page) {
  const next = page.getByRole("button", { name: "Next" });
  const shown = page.locator(".mb-shell");
  await expect(shown.or(next).first()).toBeVisible({ timeout: 15_000 });
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shown).toBeVisible();
}

const newHomeDialog = (page: Page) => page.getByRole("dialog", { name: "New home" });

/**
 * Light, dark (transitions off), then light at phone width, 390 by 844, with `ready` waited for there; `atPhone` then
 * does what else is to be seen at that width.
 */
async function shots(page: Page, testInfo: TestInfo, name: string, ready?: Locator, atPhone?: () => Promise<unknown>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.screenshot({ path: testInfo.outputPath(`${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  if (ready) await expect(ready).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`${name}-phone.png`) });
  await atPhone?.();
  if (size) await page.setViewportSize(size);
}

/** Create a home, from the home menu: New home. */
async function openNewHome(page: Page) {
  await openShell(page);
  await shell.sidebar(page).getByRole("button", { name: /^Home: .+\. Switch home$/u }).click();
  await page.getByText("Create a home").click();
  const dialog = newHomeDialog(page);
  await expect(dialog.getByRole("heading", { name: "New home" })).toBeVisible();
  return dialog;
}

/** Deletes the home called by `slug`, if it was made; its chats go with it (ON DELETE CASCADE). */
async function removeHome(knex: ReturnType<typeof connectTestDb>, slug: string) {
  const home = slug ? await knex("workspaces").where({ slug }).first() : null;
  if (!home) return;
  await knex("bots").where({ workspace_id: home.id }).del();
  await knex("workspace_settings").where({ workspace_id: home.id }).del();
  await knex("workspace_memberships").where({ workspace_id: home.id }).del();
  await knex("workspaces").where({ id: home.id }).del();
}

test("New home asks only the name, and the home starts with just Mercbot and the welcome chat with it", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  const homeName = `Plain ${Date.now().toString(36)}`;
  let slug = "";
  try {
    const dialog = await openNewHome(page);
    await expect(dialog.getByText("Your home starts with Mercbot, which helps you add the bots you need.")).toBeVisible();
    const name = dialog.getByRole("textbox", { name: "Name of the new home" });
    await expect(name, "the name has the keyboard").toBeFocused();
    // Nothing but the name: no choice of who it's for or how bots are shared, no teams, no cards, no Something else.
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(dialog).not.toContainText(/Who's it for|Just me|Shared|Private|Mixed/u);
    await expect(dialog.locator(".mb-team__choice")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^(?:Busy household|Something else)/u })).toHaveCount(0);
    await expect(dialog).not.toContainText(/\bA team\b/u);
    const create = dialog.getByRole("button", { name: "Create home", exact: true });
    await expect(create).toBeDisabled();
    await name.fill(homeName);
    await expect(create).toBeEnabled();
    await shots(page, testInfo, "new-home", page.locator(".mb-ctemp--phone"));

    const made = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/workspaces");
    await create.click();
    const answer = await made;
    expect(answer.ok(), await answer.text()).toBe(true);
    slug = String((await answer.json()).data.attributes.slug);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}(?:[?#]|$)`, "u"), { timeout: 15_000 });
    await pastIntro(page);
    await expect(shell.sidebar(page).getByRole("button", { name: `Home: ${homeName}. Switch home` })).toBeVisible();
    await expect(newHomeDialog(page)).toHaveCount(0);

    // Just Mercbot, the home's main bot, and one chat: the person's welcome chat with it, open, its welcome under way.
    const home = await knex("workspaces").where({ slug }).first();
    await expect.poll(async () => (await knex("bots").where({ workspace_id: home.id })).map((row) => [row.name, row.is_main])).toEqual([["Mercbot", true]]);
    const [main] = await knex("bots").where({ workspace_id: home.id });
    const { chats } = await (await homeApi(page, `/w/${slug}`)).get("/chats?hidden=1&archived=1");
    expect(chats.map((chat: { directBotId: string | null, everyone: boolean }) => [String(chat.directBotId), chat.everyone]), "no chat with everyone yet")
      .toEqual([[String(main.id), false]]);
    expect(chats[0].onboardingStep, "its welcome is under way").toBeTruthy();
    await expect(shell.chatRow(page, "Mercbot")).toBeVisible();
    await expect(shell.chat(page)).toHaveAttribute("aria-label", "Mercbot");
  } finally {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    await removeHome(knex, slug);
    await knex.destroy();
  }
});
