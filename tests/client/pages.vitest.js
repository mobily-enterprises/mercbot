import { describe, expect, it } from "vitest";
import { doorwayLocation, readPageMessage } from "../../src/components/mercbot/pageMessages.js";
import { renderRichText } from "../../src/components/mercbot/richText.js";

// What a sealed page may tell Mercbot (D-74): each message is checked for exactly its own shape and
// copied, so nothing else the page sends gets through; the doorway opens only an app the server lets
// the person open, on one of its screens, with only that screen's parameters.
const message = (fields) => ({ mercbotPage: 1, ...fields });

describe("a page's messages", () => {
  it("takes the height, ticks, a web link and an app, as copies", () => {
    expect(readPageMessage(message({ kind: "height", height: 812.4 }))).toEqual({ kind: "height", height: 813 });
    expect(readPageMessage(message({ kind: "height", height: 1e9 }))).toEqual({ kind: "height", height: 50000 });
    expect(readPageMessage(message({ kind: "ticks", items: [{ tick: 2, done: true, extra: "x" }] }))).toEqual({ kind: "ticks", items: [{ tick: 2, done: true }] });
    expect(readPageMessage(message({ kind: "link", href: "https://museum.example/visit?x=1" }))).toEqual({ kind: "link", href: "https://museum.example/visit?x=1" });
    expect(readPageMessage(message({ kind: "open-app", app: "quizzes", screen: "lesson", params: { lessonId: "12" } })))
      .toEqual({ kind: "open-app", app: "quizzes", screen: "lesson", params: { lessonId: "12" } });
  });

  it("drops anything else", () => {
    for (const data of [
      null,
      "height",
      { kind: "height", height: 10 },
      message({ kind: "height", height: Number.NaN }),
      message({ kind: "height", height: -1 }),
      message({ kind: "eval", code: "x" }),
      message({ kind: "ticks", items: [] }),
      message({ kind: "ticks", items: [{ tick: "0", done: true }] }),
      message({ kind: "ticks", items: [{ tick: 1.5, done: true }] }),
      message({ kind: "ticks", items: [{ tick: 0, done: "yes" }] }),
      message({ kind: "ticks", items: Array.from({ length: 501 }, (_, tick) => ({ tick, done: true })) }),
      message({ kind: "link", href: "javascript:alert(1)" }),
      message({ kind: "link", href: "data:text/html,<script>x</script>" }),
      message({ kind: "link", href: "/w/home/settings" }),
      message({ kind: "link", href: `https://example.com/${"x".repeat(2100)}` }),
      message({ kind: "open-app", app: "../settings" }),
      message({ kind: "open-app", app: "Quizzes" }),
      message({ kind: "open-app", app: "quizzes", screen: "../../admin" }),
      message({ kind: "open-app", app: "quizzes", params: { "a b": "1" } }),
      message({ kind: "open-app", app: "quizzes", params: { id: 12 } }),
      message({ kind: "open-app", app: "quizzes", params: { id: "x".repeat(201) } }),
      message({ kind: "open-app", app: "quizzes", params: Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`p${index}`, "1"])) }),
      message({ kind: "open-app", app: "quizzes", params: ["1"] })
    ]) {
      expect(readPageMessage(data), JSON.stringify(data)?.slice(0, 80)).toBeNull();
    }
  });
});

describe("the doorway to apps", () => {
  const quizzes = {
    app: { slug: "quizzes", name: "Quizzes" },
    definition: { home: "list", screens: { list: {}, lesson: { params: { lessonId: { type: "string" }, part: { type: "string" } } } } }
  };
  const asked = [];
  const home = {
    listApps: async () => ({ apps: [{ slug: "quizzes" }, { slug: "draft" }] }),
    getApp: async (slug) => {
      asked.push(slug);
      return slug === "quizzes" ? quizzes : { app: { slug, name: "Draft" }, definition: null };
    },
    appAddress: (slug) => `/w/home/apps/${slug}`
  };

  it("opens the app's screen with only the parameters that screen takes", async () => {
    await expect(doorwayLocation({ app: "quizzes", screen: "lesson", params: { lessonId: "12", part: "2", sneaky: "x" } }, home))
      .resolves.toEqual({ location: { path: "/w/home/apps/quizzes/lesson/12", query: { part: "2" } } });
  });

  it("opens the app's first screen when the page names one it hasn't", async () => {
    await expect(doorwayLocation({ app: "quizzes", screen: "toString", params: {} }, home)).resolves.toEqual({ location: { path: "/w/home/apps/quizzes/list", query: {} } });
  });

  it("opens nothing that isn't on the home's list, or was never published", async () => {
    asked.length = 0;
    await expect(doorwayLocation({ app: "payroll", screen: "", params: {} }, home)).resolves.toEqual({ problem: 'There\'s no app "payroll" in this home.' });
    expect(asked, "an app not on the list isn't even asked for").toEqual([]);
    await expect(doorwayLocation({ app: "draft", screen: "", params: {} }, home)).resolves.toEqual({ problem: "Draft hasn't been published yet." });
  });
});

describe("a page named in a reply", () => {
  it("opens the page instead of an address", () => {
    const html = renderRichText("Here it is: [Rainy Sunday](/files/bot/Pages/rainy-sunday.html), and [the old one](/files/mine/Pages/plan.md).");
    expect(html).toContain('<a class="mb-link mb-page-link" href="#" data-page="/files/bot/Pages/rainy-sunday.html">Rainy Sunday</a>');
    expect(html).toContain('data-page="/files/mine/Pages/plan.md"');
    expect(renderRichText("[x](/files/bot/notes.html)")).not.toContain("data-page");
  });
});
