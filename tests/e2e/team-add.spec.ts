import type { Locator, Page, TestInfo } from "@playwright/test";
import { connectTestDb, expect, homeApi, openShell, shell, test } from "./harness";

// Add bots' A ready-made team (D-105, D-109) as a person meets it, on the Test Preview target, in a home of the test's
// own. Team's Add bots opens on its two ways to choose; A ready-made team lists the teams under For home and life and
// For work; Small shop shows its five bots, all ticked, and adds the three left ticked to Team, in the team's order.
// They make no chats of their own (D-112): the welcome chat introduces them, and a [Message] there opens a bot's direct
// chat. Opened again, Small shop says which three are already in this home and adds only the other two. Screenshots
// light, dark and phone. The test deletes the home it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/team-add.spec.ts
const SHOP = ["Restock", "Chorus", "Kindly", "Docket", "Rapport"];
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const addBotsDialog = (page: Page) => page.getByRole("dialog", { name: "Add bots" });
const teamBots = (page: Page) => shell.team(page).getByRole("list", { name: "Members" }).locator('li[data-member="bot"]');
const appsRead = (page: Page) => page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/apps-templates"));
const teamAdded = (page: Page) =>
  page.waitForResponse((response) => response.request().method() === "POST" && /\/teams\/shop$/u.test(new URL(response.url()).pathname));

/** Light, dark (transitions off), then light at phone width, 390 by 844, once the dialog fills the screen there. */
async function shots(page: Page, testInfo: TestInfo, name: string, atPhone?: () => Promise<unknown>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.screenshot({ path: testInfo.outputPath(`${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".mb-ctemp--phone")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`${name}-phone.png`) });
  await atPhone?.();
  if (size) await page.setViewportSize(size);
}

/** Leaves every app a team screen offers to set up unticked, once the apps it works with are read. */
async function noApps(dialog: Locator, read: Promise<unknown>) {
  await read;
  for (const box of await dialog.getByRole("checkbox", { name: /^Also set up its .+ app/u }).all()) await box.uncheck();
}

/** Team → Add bots → A ready-made team: the list of teams. */
async function openTeams(page: Page) {
  await shell.sidebar(page).getByRole("button", { name: "Team", exact: true }).click();
  await shell.team(page).getByRole("button", { name: "Add bots" }).click();
  const dialog = addBotsDialog(page);
  await dialog.getByRole("button", { name: /^A ready-made team/u }).click();
  await expect(dialog.getByRole("heading", { name: "A ready-made team" })).toBeVisible();
  return dialog;
}

test("A ready-made team adds the bots ticked to Team in the team's order, introduced in the welcome chat, and only the bots the home hasn't got", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let homeId = "";
  try {
    const { csrfToken } = await (await page.request.get("/api/session")).json();
    const made = await page.request.post("/api/workspaces", {
      headers: { "csrf-token": csrfToken, "content-type": "application/vnd.api+json", accept: "application/vnd.api+json" },
      data: JSON.stringify({ data: { type: "workspaces", attributes: { name: `Corner ${Date.now().toString(36)}` } } })
    });
    expect(made.ok(), await made.text()).toBe(true);
    const slug = String((await made.json()).data.attributes.slug);
    homeId = String((await knex("workspaces").where({ slug }).first()).id);
    // The person's welcome chat with Mercbot, as their first visit makes it, its welcome put aside for this test.
    const api = await homeApi(page, `/w/${slug}`);
    const { chat: welcome } = await api.post("/chats/welcome");
    await knex("conversations").where({ id: welcome.id }).update({ onboarding_step: null });
    await openShell(page, "", `/w/${slug}`);

    const dialog = await openTeams(page);
    // Two for home and life, then the ten for work (D-109).
    const forHome = dialog.getByRole("region", { name: "For home and life" });
    const forWork = dialog.getByRole("region", { name: "For work" });
    await expect(forHome.getByRole("heading", { name: "For home and life" })).toBeVisible();
    await expect(forHome.locator(".mb-team__choice strong")).toHaveText(["Busy household", "Personal life"]);
    await expect(forWork.locator(".mb-team__choice")).toHaveCount(10);
    await expect(forWork.getByRole("button", { name: /^Small shop/u })).toBeVisible();
    await shots(page, testInfo, "add-a-team-list");

    const shopApps = appsRead(page);
    await dialog.getByRole("button", { name: /^Small shop/u }).click();
    for (const botName of SHOP) await expect(dialog.getByRole("checkbox", { name: `Add ${botName}` })).toBeChecked();
    await expect(dialog.getByRole("button", { name: "Add 5 bots" })).toBeEnabled();
    await shopApps;
    await shots(page, testInfo, "add-a-team-detail", async () => {
      const lastApp = dialog.getByRole("checkbox", { name: /^Also set up its .+ app/u }).last();
      await lastApp.scrollIntoViewIfNeeded();
      await expect(lastApp, "the last app box clears the foot").toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath("add-a-team-detail-phone-end.png") });
    });
    await dialog.getByRole("checkbox", { name: "Add Kindly" }).uncheck();
    await dialog.getByRole("checkbox", { name: "Add Rapport" }).uncheck();
    await noApps(dialog, Promise.resolve());
    const shopAdded = teamAdded(page);
    await dialog.getByRole("button", { name: "Add 3 bots" }).click();
    const shopAnswer = await shopAdded;
    const asked = shopAnswer.request().postDataJSON();
    expect([Object.keys(asked), asked.templates.length], "the templates ticked, and no section").toEqual([["templates"], 3]);
    const shopBody = await shopAnswer.json();
    expect([shopBody.added.length, shopBody.skipped]).toEqual([3, []]);
    expect(shopBody).not.toHaveProperty("section");
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Added 3 bots to your team.")).toBeVisible();
    await expect(teamBots(page), "Mercbot and the three").toHaveCount(4);
    await expect(teamBots(page).locator(".mb-team-row__name"), "in the team's order").toContainText(["Restock", "Chorus", "Docket"]);
    await expect(shell.team(page), "no chat opens").toBeVisible();
    const chatsNow = async () => (await api.get("/chats?hidden=1&archived=1")).chats.map((chat: { id: string }) => String(chat.id));
    expect(await chatsNow(), "they make no chats: only the welcome chat").toEqual([String(welcome.id)]);

    // The welcome chat introduces them, a [Message] for each; Restock's opens its direct chat.
    await shell.chatRow(page, "Mercbot").click();
    await expect(shell.chat(page).getByText("Your team's here: Restock, Chorus and Docket. Start a chat with one of them whenever you like."))
      .toBeVisible();
    await expect.poll(() => shell.chat(page).locator(".mb-bubble__team-member").evaluateAll((all) => all.map((one) => one.getAttribute("aria-label"))))
      .toEqual(["Message Restock", "Message Chorus", "Message Docket"]);
    await shell.chat(page).getByRole("button", { name: "Message Restock" }).click();
    await expect(shell.chat(page)).toHaveAttribute("aria-label", "Restock");
    await expect(shell.chatRow(page, "Restock")).toBeVisible();

    // Small shop again: the three it has say so, and only the other two are added.
    const againApps = appsRead(page);
    const again = await openTeams(page);
    await again.getByRole("button", { name: /^Small shop/u }).click();
    for (const botName of ["Restock", "Chorus", "Docket"]) {
      const there = again.getByRole("checkbox", { name: `${botName}, already in this home` });
      await expect(there).toBeDisabled();
      await expect(there).not.toBeChecked();
    }
    await expect(again.getByText("Already in this home")).toHaveCount(3);
    await expect(again.getByRole("button", { name: "Add 2 bots" })).toBeEnabled();
    await againApps;
    await shots(page, testInfo, "small-shop-again");
    await noApps(again, Promise.resolve());
    const rest = teamAdded(page);
    await again.getByRole("button", { name: "Add 2 bots" }).click();
    const restBody = await (await rest).json();
    expect([restBody.added.length, restBody.skipped]).toEqual([2, []]);
    await expect(page.getByText("Added 2 bots to your team.")).toBeVisible();
    await expect(teamBots(page)).toHaveCount(6);
    for (const botName of SHOP) await expect(teamBots(page).locator(".mb-team-row__name").filter({ hasText: new RegExp(`^${botName}`, "u") })).toHaveCount(1);

    const kept = await knex("bots").where({ workspace_id: homeId, is_main: false }).select("id", "library_template");
    expect(kept).toHaveLength(5);
    expect(new Set(kept.map((row) => row.library_template)).size, "never two bots on one template").toBe(5);
    const directs = await knex("conversations").whereIn("direct_bot_id", kept.map((row) => row.id)).count("* as n").first();
    expect(Number(directs?.n), "a direct chat only for the bot someone messaged").toBe(1);
  } finally {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    if (homeId) {
      await knex("bots").where({ workspace_id: homeId }).del();
      await knex("workspace_settings").where({ workspace_id: homeId }).del();
      await knex("workspace_memberships").where({ workspace_id: homeId }).del();
      await knex("workspaces").where({ id: homeId }).del();
    }
    await knex.destroy();
  }
});
