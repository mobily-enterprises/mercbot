import { describe, expect, it } from "vitest";
import { privateChatWith } from "../../src/components/mercbot/chatView.js";

// [Message] on a person (plan 4.2) opens your private chat with just them: the two of you, no bots, not an app's chat;
// the newest when there are several. With none, the shell makes one.
const ANNA = { userId: "1", name: "Anna Rossi" };
const BEN = { userId: "2", name: "Ben Rossi" };
const CARLA = { userId: "3", name: "Carla Rossi" };
const CHEF = { chatBotId: "70", botId: "7", name: "Chef" };
const chat = (id, extra) => ({ id, kind: "private", appId: null, people: [ANNA, BEN], bots: [], lastActivityAt: "2026-11-22T10:00:00.000Z", ...extra });

describe("[Message] on a person", () => {
  it("opens the newest private chat of just the two of you", () => {
    const older = chat("4");
    const newer = chat("5", { people: [BEN, ANNA], lastActivityAt: "2026-11-22T11:00:00.000Z" });
    const others = [
      chat("6", { kind: "public", lastActivityAt: "2026-11-22T12:00:00.000Z" }),
      chat("7", { bots: [CHEF], lastActivityAt: "2026-11-22T12:00:00.000Z" }),
      chat("8", { people: [ANNA, BEN, CARLA], lastActivityAt: "2026-11-22T12:00:00.000Z" }),
      chat("9", { appId: "3", lastActivityAt: "2026-11-22T12:00:00.000Z" })
    ];
    expect(privateChatWith([older, ...others, newer], "1", "2")?.id).toBe("5");
    expect(privateChatWith(others, "1", "2"), "a public chat, one with a bot, three people, an app's").toBeNull();
    expect(privateChatWith([older, newer], "1", "3"), "someone you have none with").toBeNull();
  });
});
