import { describe, expect, it } from "vitest";
import { sidebarApps } from "../../src/components/apps/usePinnedApps.js";

// The sidebar's Apps section (D-147): the person's pinned apps in their order, then the apps they've talked to the bot
// of, newest chat first; one row an app, with its chat's news. A row opens the app, with its chat open when it was the
// chat that put it there or the chat has something new.

const app = (id, name) => ({ id, slug: name.toLowerCase().replace(/ /gu, "-"), name, icon: "school", color: "#335599", picture: null });
const APPS = [app("a_budget", "Budget"), app("a_learn", "Learn to program"), app("a_study", "Study"), app("a_gone", "Gone")];
const chat = (id, botAppId, { unread = false, preview = "", lastActivityAt = "2026-11-28T10:00:00Z" } = {}) => ({ id, botAppId, unread, mentioned: false, preview, lastActivityAt, bots: [{ name: "Coach" }] });

describe("the sidebar's Apps section", () => {
  it("lists the pinned apps first, then the apps whose bot the person talks to, newest first, each app once", () => {
    const rows = sidebarApps({
      apps: APPS,
      pins: ["a_budget", "a_learn"],
      chats: [chat("9", "a_learn", { preview: "Try n * 2" }), chat("8", "a_study", { lastActivityAt: "2026-11-28T09:00:00Z" }), chat("7", "a_missing")],
      here: "/w/home/apps/study/lesson/4",
      addressOf: (entry) => `/w/home/apps/${entry.slug}`
    });
    expect(rows.map((row) => [row.name, row.chatId, row.detail, row.opensChat, row.selected])).toEqual([
      ["Budget", null, "", false, false],
      ["Learn to program", "9", "Try n * 2", false, false],
      ["Study", "8", "", true, true]
    ]);
  });

  it("opens a pinned app with its chat when the chat has something new, and marks it", () => {
    const [row] = sidebarApps({ apps: APPS, pins: ["a_learn"], chats: [chat("9", "a_learn", { unread: true, preview: "Lesson 4 is ready" })], here: "/", addressOf: (entry) => `/apps/${entry.slug}` });
    expect([row.unread, row.opensChat, row.detail]).toEqual([true, true, "Lesson 4 is ready"]);
  });
});
