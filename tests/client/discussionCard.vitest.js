import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// The Discussion card (D-115): what it says and offers as a round runs, waits or was interrupted. A round's card is
// leased while it runs; once the lease lapses (the server running it stopped) it reads as interrupted, as the server
// reads it, and waits for a press: One more round (unless it was wrapping up), Wrap up or Stop for its person, Stop for
// the chat's managers. No press is made here.
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({ chatsApi: { discussion: async () => ({}) } }));
const { default: MercbotDiscussionCard } = await import("../../src/components/mercbot/MercbotDiscussionCard.vue");
const { nanoMoney } = await import("../../src/components/mercbot/accountApi.js");
// What the card has cost, as this machine's locale writes money ("$0.002" in English, "USD 0.002" in some others).
const spent = nanoMoney(2000000);

const chat = { id: "40", madeBy: "1", bots: [{ botId: "7", name: "Ada" }, { botId: "9", name: "Bo" }] };
const later = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();
/** A card of Kim's (user 2), in round 1 of 2, as the server keeps it, with `more` over it. */
const card = (more) => ({
  id: "88",
  kind: "discussion",
  body: {
    question: "Tiles or wood?",
    status: "running",
    for: { id: "2", name: "Kim" },
    bots: [{ id: "7", name: "Ada" }, { id: "9", name: "Bo" }],
    rounds: 2,
    round: 1,
    spentNano: 2000000,
    passed: [],
    run: "a-round",
    ...more
  }
});

async function shown(message, { me = "2", manages = false } = {}) {
  const app = createSSRApp({ render: () => h(MercbotDiscussionCard, { message, chat, me, manages }) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  const html = (await renderToString(app)).replaceAll("&#39;", "'").replace(/ data-v-[0-9a-f]+/gu, "");
  const text = (part) => part.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
  return {
    status: text(/mb-discussion__status[^>]*>([\s\S]*?)<\/span>/u.exec(html)?.[1] ?? ""),
    line: text(/<p class="mb-discussion__line">([\s\S]*?)<\/p>/u.exec(html)?.[1] ?? ""),
    buttons: [...html.matchAll(/<button[^>]*class="mb-discussion__button[^"]*"[^>]*>([\s\S]*?)<\/button>/gu)].map(([, inside]) => text(inside))
  };
}

describe("Discussion card", () => {
  it("while its round's lease holds, it's talking: its person can only stop it", async () => {
    const running = await shown(card({ leaseUntil: later(60) }));
    expect(running.status).toBe("Talking");
    expect(running.line).toBe(`Round 1 of 2 · ${spent} so far`);
    expect(running.buttons).toEqual(["Stop"]);
  });

  it("once the lease has lapsed, it reads as interrupted and waits for its person's press", async () => {
    const lapsed = await shown(card({ leaseUntil: later(-1) }));
    expect(lapsed.status).toBe("Interrupted");
    expect(lapsed.line).toBe(`Round 1 of 2 was interrupted · ${spent} so far`);
    expect(lapsed.buttons).toEqual(["Stop", "One more round", "Wrap up"]);

    // As the server reads one it read lapsed, and a wrap-up that was interrupted: no other round, only Wrap up again.
    const wrapping = await shown(card({ status: "interrupted", wrapping: true }));
    expect([wrapping.status, wrapping.line]).toEqual(["Interrupted", `The wrap-up was interrupted · ${spent} so far`]);
    expect(wrapping.buttons).toEqual(["Stop", "Wrap up"]);
  });

  it("for anyone else in the chat it waits for its person; a manager can stop it", async () => {
    const lapsed = card({ leaseUntil: later(-1) });
    const other = await shown(lapsed, { me: "3" });
    expect(other.line).toBe(`Round 1 of 2 was interrupted · ${spent} so far · waiting for Kim`);
    expect(other.buttons).toEqual([]);
    expect((await shown(lapsed, { me: "3", manages: true })).buttons).toEqual(["Stop"]);
  });
});
