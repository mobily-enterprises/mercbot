import { describe, expect, it, vi } from "vitest";

// A bot's computer has one person in control at a time (D16): when the server says someone else took over the computer
// this person has open in control, the live view goes back to watching; their own take-over, or another computer's
// news, leaves it as it is.
vi.mock("../../src/components/mercbot/computerApi.js", () => ({
  computerApi: { takeOver: async () => ({ messages: [], control: { userId: "2" } }), handBack: async () => ({ messages: [] }) }
}));
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
