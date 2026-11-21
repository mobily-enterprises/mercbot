import { describe, expect, it, vi } from "vitest";

// A bot's computer has one person in control at a time (D16): when the server says someone else took over the computer
// this person has open in control, the live view goes back to watching; their own take-over, or another computer's
// news, leaves it as it is.
const api = vi.hoisted(() => ({ takeOver: async () => ({ messages: [], control: { userId: "2" } }), handBack: async () => ({ messages: [] }) }));
vi.mock("../../src/components/mercbot/computerApi.js", () => ({ computerApi: api }));
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({ chatsApi: {} }));
const { useLiveView } = await import("../../src/components/mercbot/useLiveView.js");

async function inControl() {
  const live = useLiveView({
    store: { appendMessages: () => {}, updateChat: () => {} },
    work: { setWork: () => {}, requestReply: async () => {} },
    chatBotFace: () => ({ name: "Chef" }),
    reportFailure: (text, error) => { throw error || new Error(text); }
  });
  await live.takeOver({ botId: "7", chatId: "9" });
  return live;
}

describe("a take-over the server refuses", () => {
  // Someone else having it never refuses (computerControl.js takes it from them); a computer that didn't start does.
  it("says what the server said, and stays watching", async () => {
    const said = [];
    const live = useLiveView({
      store: { appendMessages: () => {} },
      work: {},
      chatBotFace: () => ({ name: "Chef" }),
      reportFailure: (text) => said.push(text)
    });
    const takeOver = api.takeOver;
    api.takeOver = async () => {
      throw Object.assign(new Error("Chef's computer couldn't start. Try again in a minute."), { status: 409, code: "computer_not_started" });
    };
    try {
      expect(await live.takeOver({ botId: "7", chatId: "9" })).toBe(false);
    } finally {
      api.takeOver = takeOver;
    }
    expect([said, live.liveView.value]).toEqual([["Chef's computer couldn't start. Try again in a minute."], null]);
  });
});

describe("someone else taking over an open computer", () => {
  it("puts this person's live view back to watching, and says so", async () => {
    const live = await inControl();
    expect(live.computerChanged({ chatId: "9", botId: "7", control: "5" }, "2")).toBe(true);
    expect(live.liveView.value.inControl).toBe(false);
  });

  it("leaves it alone for their own take-over and for another computer", async () => {
    const live = await inControl();
    expect(live.computerChanged({ chatId: "9", botId: "7", control: "2" }, "2")).toBe(false);
    expect(live.computerChanged({ chatId: "9", botId: "8", control: "5" }, "2")).toBe(false);
    expect(live.computerChanged({ chatId: "10", botId: "7", control: "5" }, "2")).toBe(false);
    expect(live.liveView.value.inControl).toBe(true);
  });
});
