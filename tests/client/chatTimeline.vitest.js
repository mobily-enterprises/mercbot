import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";
import { setCurrentHome } from "../../src/components/mercbot/homeApi.js";
import { authorOf, hasSeveral, initialsOf, mayReact, myReaction, reactionsOf } from "../../src/components/mercbot/messageAuthors.js";

// The app cards read the apps' routes as they show; none is in these chats.
vi.mock("../../src/components/apps/MercbotViewCard.vue", () => ({ default: { render: () => null } }));
vi.mock("../../src/components/apps/MercbotViewViewer.vue", () => ({ default: { render: () => null } }));
vi.mock("../../src/components/apps/MercbotAppDraftCard.vue", () => ({ default: { render: () => null } }));
vi.mock("../../src/components/apps/MercbotFieldRemovalCard.vue", () => ({ default: { render: () => null } }));
const { default: MercbotTimeline } = await import("../../src/components/mercbot/MercbotTimeline.vue");

// A chat's timeline (D-112, plan 4.4): who wrote what, by author; your own on the right, every other person's on the
// left with their name and initials, each bot's with its face and name; a card waiting for someone else says whom; and
// every file, screenshot, voice and computer address names the chat. Rendered as the server renders a page, with
// stand-ins for the browser's audio and the computer's stream, which only note the address they're given.
const opened = { audio: [], streams: [] };
beforeEach(() => {
  opened.audio = [];
  opened.streams = [];
  setCurrentHome("rossi");
  vi.stubGlobal("Audio", class {
    constructor(src) { opened.audio.push(src); }
    addEventListener() {}
    pause() {}
  });
  vi.stubGlobal("EventSource", class {
    constructor(url) { opened.streams.push(url); }
    addEventListener() {}
    close() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

const CHEF = { chatBotId: "70", botId: "7", name: "Chef", color: "#E65100", shape: "cloud", archived: false, waitingTask: null };
const SHOPPER = { chatBotId: "80", botId: "8", name: "Shopper", color: "#2E7D32", shape: "storm", archived: false, waitingTask: null };
const ANNA = { userId: "1", name: "Anna Rossi" };
const BEN = { userId: "2", name: "Ben Rossi" };
const chatOf = (extra) => ({ id: "9", kind: "public", title: null, directBotId: null, people: [ANNA], bots: [CHEF], ...extra });
const DIRECT = chatOf({ directBotId: "7" });
const KITCHEN = chatOf({ title: "Kitchen reno", people: [ANNA, BEN], bots: [CHEF, SHOPPER] });

let next = 0;
const said = (author, text, extra = {}) => ({
  id: String(++next),
  kind: "text",
  role: author.userId ? "user" : author.botId ? "bot" : author.role,
  authorUserId: author.userId ?? null,
  authorBotId: author.botId ?? null,
  body: { text },
  createdAt: "2026-11-22T10:00:00.000Z",
  ...extra
});
const card = (kind, botId, body) => ({ id: String(++next), kind, role: "bot", authorUserId: null, authorBotId: botId, body, createdAt: "2026-11-22T10:00:00.000Z" });

/** The timeline's HTML, its apostrophes and ampersands as written. */
async function timeline(props) {
  const app = createSSRApp({ render: () => h(MercbotTimeline, { me: "1", ...props }) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'").replaceAll("&amp;", "&");
}

/** One message's part of the timeline. */
function item(html, message) {
  const start = html.indexOf(`data-message-id="${message.id}"`);
  const end = html.indexOf("data-message-id=", start + 1);
  return html.slice(start, end === -1 ? undefined : end);
}
const sideIn = (part) => /mb-message--(user|other|bot|system)/u.exec(part)?.[1];
const labelIn = (part) => /class="mb-speaker"[^>]*>([^<]*)</u.exec(part)?.[1] ?? null;
const initialsIn = (part) => /class="mb-speaker__initial"[^>]*>([^<]*)</u.exec(part)?.[1] ?? null;
/** The face beside a message, which the bot's colour fills, or null. */
const faceIn = (part) => (part.includes('class="mb-speaker__avatar"') ? part.slice(part.indexOf('class="mb-speaker__avatar"')) : null);

describe("a direct chat", () => {
  it("looks as a chat with one bot always has: your own on the right, the bot's on the left, no names", async () => {
    const mine = said(ANNA, "Oak or walnut?");
    const reply = said(CHEF, "Oak: walnut scratches.");
    const html = await timeline({ chat: DIRECT, messages: [mine, reply] });
    expect(hasSeveral(DIRECT)).toBe(false);
    expect([sideIn(item(html, mine)), sideIn(item(html, reply))]).toEqual(["user", "bot"]);
    expect(html).not.toContain('class="mb-speaker"');
    expect(html).not.toContain("mb-speaker__avatar");
    expect(html, "your bubbles keep the accent").not.toContain("mb-bubble--plain");
  });
});

describe("a chat with two people and two bots", () => {
  it("names each person and bot, with their initials or face, and keeps your own on the right, unnamed", async () => {
    const mine = said(ANNA, "Oak or walnut?");
    const ben = said(BEN, "Walnut, surely");
    const chef = said(CHEF, "For 12 people:");
    const chefAgain = said(CHEF, "here's the list.");
    const shopper = said(SHOPPER, "Ordered.");
    const html = await timeline({ chat: KITCHEN, messages: [mine, ben, chef, chefAgain, shopper] });
    expect(hasSeveral(KITCHEN)).toBe(true);

    expect([sideIn(item(html, mine)), labelIn(item(html, mine)), initialsIn(item(html, mine))]).toEqual(["user", null, null]);
    expect(item(html, mine), "your bubbles are plain, not one bot's colour").toContain("mb-bubble--plain");
    expect([sideIn(item(html, ben)), labelIn(item(html, ben)), initialsIn(item(html, ben))]).toEqual(["other", "Ben Rossi", "BR"]);
    // One bot's run: its name above the first, its face beside the last.
    expect([sideIn(item(html, chef)), labelIn(item(html, chef)), faceIn(item(html, chef))]).toEqual(["bot", "Chef", null]);
    expect(labelIn(item(html, chefAgain))).toBe(null);
    expect(faceIn(item(html, chefAgain))).toContain('fill="#E65100"');
    expect(labelIn(item(html, shopper))).toBe("Shopper");
    expect(faceIn(item(html, shopper))).toContain('fill="#2E7D32"');
  });

  it("puts the new divider above the first message you hadn't seen, another person's included, never your own", async () => {
    const read = said(CHEF, "Hello");
    const mine = said(ANNA, "Back in a bit");
    const ben = said(BEN, "Fine");
    const html = await timeline({ chat: KITCHEN, messages: [read, mine, ben], unreadAfter: read.id });
    const divider = html.indexOf('class="mb-timeline__new"');
    expect(divider).toBeGreaterThan(html.indexOf(`data-message-id="${mine.id}"`));
    expect(divider).toBeLessThan(html.indexOf(`data-message-id="${ben.id}"`));
  });
});

describe("an author who has left", () => {
  const people = [{ id: "1", name: "Anna Rossi" }, { id: "3", name: "Carla Bianchi" }];
  const bots = [{ id: "8", name: "Shopper", color: "#2E7D32", shape: "storm", archivedAt: null }];

  it("keeps the name the home gives them, or reads Someone once they've left the home too", async () => {
    const carla = said({ userId: "3" }, "I'll bring the wine");
    const gone = said({ userId: "4" }, "Bye all");
    const shopper = said({ botId: "8" }, "Ordered.");
    const lost = said({ botId: "12" }, "Done.");
    const deleted = said({ role: "bot" }, "Still here.");
    const html = await timeline({ chat: DIRECT, people, bots, messages: [carla, gone, shopper, lost, deleted] });
    // Even in a direct chat, an author no longer in it is named.
    expect([labelIn(item(html, carla)), initialsIn(item(html, carla)), sideIn(item(html, carla))]).toEqual(["Carla Bianchi", "CB", "other"]);
    expect([labelIn(item(html, gone)), initialsIn(item(html, gone))]).toEqual(["Someone", "?"]);
    expect([labelIn(item(html, shopper)), sideIn(item(html, shopper))]).toEqual(["Shopper", "bot"]);
    expect(faceIn(item(html, shopper))).toContain('fill="#2E7D32"');
    expect([labelIn(item(html, lost)), labelIn(item(html, deleted))]).toEqual(["Someone", "Someone"]);
  });

  it("keeps the name a message was written under once its author has gone, the current name while they're known (R2)", async () => {
    const written = (author, text, authorName) => said(author, text, { body: { text, authorName } });
    const renamed = written({ userId: "3" }, "Wine's in the fridge", "Carla B.");
    const left = written({ userId: "4" }, "Bye all", "Dario Neri");
    const removed = written({ role: "user" }, "Thanks!", "Elena Russo");
    const lost = written({ botId: "12" }, "Done.", "Planner");
    const html = await timeline({ chat: DIRECT, people, bots, messages: [renamed, left, removed, lost] });
    expect(labelIn(item(html, renamed))).toBe("Carla Bianchi");
    expect([labelIn(item(html, left)), initialsIn(item(html, left))]).toEqual(["Dario Neri", "DN"]);
    expect([labelIn(item(html, removed)), initialsIn(item(html, removed))]).toEqual(["Elena Russo", "ER"]);
    expect(labelIn(item(html, lost))).toBe("Planner");
  });

  it("is told apart from the chat's members by the author's id alone", () => {
    expect(authorOf(said(BEN, "x"), { chat: KITCHEN, me: "1" })).toMatchObject({ key: "person-2", name: "Ben Rossi", member: true, mine: false });
    expect(authorOf(said(ANNA, "x"), { chat: KITCHEN, me: "1" })).toMatchObject({ key: "person-1", mine: true });
    expect(authorOf({ role: "system", authorUserId: null, authorBotId: null }, { chat: KITCHEN }), "Mercbot's own line").toBe(null);
    expect([initialsOf("Anna Rossi"), initialsOf("Ben"), initialsOf("")]).toEqual(["AR", "BE", "?"]);
  });
});

describe("reactions, one per person and per bot (user:<id>, bot:<id>)", () => {
  /** Each reaction shown on a message: its emoji, its count when more than one chose it, and "mine" for your own. */
  const reactionsIn = (part) => [...part.matchAll(/<span class="([^"]*)"[^>]*>([^<]*)(?:<span class="mb-reaction__count"[^>]*>(\d+)<)?/gu)]
    .map(([, classes, emoji, count]) => ({ classes: classes.split(" "), emoji, count }))
    .filter(({ classes }) => classes.includes("mb-reaction__one"))
    .map(({ classes, emoji, count }) => `${emoji.trim()}${count ? ` ${count}` : ""}${classes.includes("mb-reaction__one--mine") ? " mine" : ""}`);
  const reactButtonIn = (part) => part.includes('aria-label="React"');

  it("show everyone's, people's and bots', each emoji once with how many, your own marked, never someone else's as yours", async () => {
    const answer = said({ botId: "7" }, "Booked for 8.", { body: { text: "Booked for 8.", reactions: { "user:1": "👍", "user:2": "🎉" } } });
    const ask = said({ userId: "2" }, "Table for two?", { body: { text: "Table for two?", reactions: { "bot:7": "❤️", "bot:8": "❤️", "user:1": "👍" } } });
    const other = said({ botId: "8" }, "Done.", { body: { text: "Done.", reactions: { "user:2": "🙏" } } });
    const plain = said({ botId: "7" }, "Noted.");
    const html = await timeline({ chat: KITCHEN, messages: [answer, ask, other, plain] });
    expect(reactionsIn(item(html, answer))).toEqual(["👍 mine", "🎉"]);
    expect(reactionsIn(item(html, ask))).toEqual(["❤️ 2", "👍 mine"]);
    expect(reactionsIn(item(html, other)), "Ben's, not Anna's").toEqual(["🙏"]);
    expect(reactionsIn(item(html, plain))).toEqual([]);
    // The React menu marks your own as chosen, and choosing it again takes it off.
    expect([myReaction(answer, "1"), myReaction(answer, "2"), myReaction(answer, "")]).toEqual(["👍", "🎉", null]);
    expect(reactionsOf(ask, "2")).toEqual([{ emoji: "❤️", count: 2, mine: false }, { emoji: "👍", count: 1, mine: false }]);
  });

  it("are offered on a bot's message and on another person's, never on your own or Mercbot's lines (D-114)", async () => {
    const answer = said({ botId: "7" }, "Booked for 8.");
    const bens = said({ userId: "2" }, "Table for two?");
    const mine = said({ userId: "1" }, "Yes please.");
    const line = said({ role: "system" }, "Ben joined.", { kind: "event" });
    const html = await timeline({ chat: KITCHEN, messages: [answer, bens, mine] });
    expect([answer, bens, mine].map((message) => reactButtonIn(item(html, message)))).toEqual([true, true, false]);
    expect([answer, bens, mine, line].map((message) => mayReact(message, "1"))).toEqual([true, true, false, false]);
  });
});

describe("a room's start line and a bot's window line", () => {
  it("draws each as a small centred line, the start line's author's own (room_started) and the window's Mercbot's (bot_window)", async () => {
    const started = said({ userId: "1" }, "", { kind: "event", role: "user", body: { event: "room_started", text: "Anna Rossi started this room." } });
    const windowLine = said({ role: "system" }, "", {
      kind: "event", body: { event: "bot_window", text: "Chef joined. It reads the last 30 messages; ask it to read further back." }
    });
    const html = await timeline({ chat: KITCHEN, messages: [started, windowLine] });
    for (const [message, words] of [[started, "Anna Rossi started this room."], [windowLine, "Chef joined. It reads the last 30 messages; ask it to read further back."]]) {
      const part = item(html, message);
      const centred = /<p class="mb-timeline__centred"[^>]*>([\s\S]*?)<\/p>/u.exec(part)?.[1] ?? "";
      expect(centred.replace(/<!--[\s\S]*?-->/gu, "").trim()).toBe(words);
      expect(sideIn(part), "not a message on either side").toBeUndefined();
    }
  });
});

describe("a card waiting for someone else", () => {
  const forBen = { for: { id: "2", name: "Ben" } };

  it("says whom it waits for, and only they answer it", async () => {
    const choice = card("choice", "7", { question: "Which wood?", options: ["Oak", "Walnut"], ...forBen });
    const form = card("secure_form", "7", { site: "ikea.com", form: "login", status: "pending", ...forBen });
    const draft = card("draft", "7", { to: "joe@example.com", text: "Hi Joe", status: "pending", ...forBen });
    const messages = [choice, form, draft];
    const html = await timeline({ chat: KITCHEN, messages });
    expect(item(html, choice)).toContain("Waiting for Ben's OK");
    expect(item(html, choice)).not.toContain("mb-choice__option");
    expect(item(html, form)).toContain("Waiting for Ben");
    expect(item(html, form)).not.toContain(">Open<");
    expect(item(html, draft)).toContain("Waiting for Ben to send or discard it");

    const bens = await timeline({ chat: KITCHEN, messages, me: "2" });
    expect(item(bens, choice)).not.toContain("Waiting for");
    expect(item(bens, choice)).toContain("Walnut");
    expect(item(bens, form)).toContain(">Open<");
  });

  it("names the bot's computer, which anyone in the chat may still take over (D16)", async () => {
    const handover = card("handover", "7", { status: "pending", task: "Sign in to the bank", ...forBen });
    const html = await timeline({ chat: KITCHEN, messages: [handover] });
    const part = item(html, handover);
    expect(part).toContain("Chef's computer");
    expect(part).toContain("Ben's turn");
    expect(part).toContain("Waiting for Ben");
    expect(part).toContain("Take over");
    expect(part).not.toContain("I'm done");
    const bens = item(await timeline({ chat: KITCHEN, messages: [handover], me: "2" }), handover);
    expect([bens.includes("Your turn"), bens.includes("I'm done"), bens.includes("Take over")]).toEqual([true, true, true]);
  });
});

describe("every address in a chat", () => {
  it("names the chat, and the bot whose files, screenshots and computer they are", async () => {
    const picture = said(ANNA, "", { body: { text: "", attachments: [{ name: "cat.png", type: "image/png", size: 3, path: "/files/chat/Uploads/cat.png" }] } });
    const pictures = card("pictures", "7", { images: [{ path: "/files/chat/Pictures/menu.png", title: "Menu", caption: "The menu" }] });
    const chart = card("chart", "8", { path: "/files/bot/Charts/costs.png", title: "Costs", caption: "Costs" });
    const shots = card("screenshots", "7", { images: [{ name: "shot-1.png", caption: "The page" }] });
    const voice = card("voice", "8", { path: "/files/chat/Voice/memo.webm", seconds: 4, waveform: [0.5], words: "Hello" });
    const handover = card("handover", "7", { status: "pending", task: "Sign in", screenshot: "turn.png" });
    const html = await timeline({ chat: KITCHEN, messages: [picture, pictures, chart, shots, voice, handover] });

    expect(item(html, picture)).toContain('src="/api/w/rossi/files/content?path=%2Ffiles%2Fchat%2FUploads%2Fcat.png&chat=9"');
    expect(item(html, pictures)).toContain('src="/api/w/rossi/files/content?path=%2Ffiles%2Fchat%2FPictures%2Fmenu.png&chat=9&bot=7"');
    expect(item(html, chart)).toContain('src="/api/w/rossi/files/content?path=%2Ffiles%2Fbot%2FCharts%2Fcosts.png&chat=9&bot=8"');
    expect(item(html, shots)).toContain('src="/api/w/rossi/bots/7/screenshots/shot-1.png?chat=9"');
    expect(opened.audio).toEqual(["/api/w/rossi/files/content?path=%2Ffiles%2Fchat%2FVoice%2Fmemo.webm&chat=9&bot=8"]);
    expect(item(html, handover)).toContain('src="/api/w/rossi/bots/7/screenshots/turn.png?chat=9"');
    expect(opened.streams).toEqual(["/api/w/rossi/bots/7/computer/stream?chat=9"]);
  });
});

describe("a team's introduction (D-109)", () => {
  it("names each bot a team just added with a Message button for its direct chat", async () => {
    const intro = said(CHEF, "Your team's here: Shopper and Planner. Start a chat with one of them whenever you like.", {
      body: {
        text: "Your team's here: Shopper and Planner. Start a chat with one of them whenever you like.",
        team: [
          { botId: "8", name: "Shopper", color: "#2E7D32", shape: "storm" },
          { botId: "11", name: "Planner", color: "#1565C0", shape: "cloud" }
        ]
      }
    });
    const part = item(await timeline({ chat: DIRECT, messages: [intro] }), intro);
    expect(part).toContain('aria-label="Message Shopper"');
    expect(part).toContain('aria-label="Message Planner"');
    expect(part.match(/class="mb-bubble__team-member"/gu)).toHaveLength(2);
  });
});
