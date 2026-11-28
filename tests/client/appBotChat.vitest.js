import { describe, expect, it } from "vitest";
import { chipsFor, offersChat, seesLine } from "../../src/components/apps/appBotChat.js";
import { suggestionsFor } from "../../packages/apps/src/shared/botBrief.js";

// An app's chat with its bot (D-147), at the cheapest level: when the frame offers it, and the questions it suggests.

const COACH = { id: "7", name: "Coach", color: "#0B8043", shape: "tuft" };
const live = { app: { kind: "app" }, definition: { home: "lesson", screens: { lesson: {} } }, bot: COACH };

describe("an app's chat with its bot", () => {
  it("is offered on a live app with a bot, never on a draft's preview, a view, an app not published or a home with no bot", () => {
    expect(offersChat(live, "live")).toBe(true);
    expect(offersChat(live, "draft")).toBe(false);
    expect(offersChat({ ...live, app: { kind: "view" } }, "live")).toBe(false);
    expect(offersChat({ ...live, definition: null }, "live")).toBe(false);
    expect(offersChat({ ...live, bot: null }, "live")).toBe(false);
    expect(offersChat(null, "live")).toBe(false);
  });

  it("suggests the screen's own questions, or two for any screen, and only while the message box is empty", () => {
    const definition = { suggestions: { lesson: ["What's wrong with my code?", "Give me a hint"] } };
    expect(suggestionsFor(definition, "lesson")).toEqual(["What's wrong with my code?", "Give me a hint"]);
    expect(suggestionsFor(definition, "course")).toEqual(["What can I do here?", "How does this app work?"]);
    expect(chipsFor("", suggestionsFor(definition, "lesson"))).toEqual(["What's wrong with my code?", "Give me a hint"]);
    expect(chipsFor("  ", ["A?"])).toEqual(["A?"]);
    expect(chipsFor("Why does test 2 fail?", ["A?"])).toEqual([]);
  });

  it("says in a line what the bot sees with the next message: the screen, the record open and the typed fields by size, never their text", () => {
    const code = Array.from({ length: 12 }, (_, at) => `line ${at}`).join("\n");
    const snapshot = {
      screen: { key: "lesson", title: "Lesson" },
      record: { table: "Lessons", id: "12", title: "Doubles", values: [] },
      forms: [{ about: "editing My progress #40", fields: [{ label: "Your answer", key: "code", value: code, unsaved: true }, { label: "Notes", key: "notes", value: "Ask Ada" }, { label: "Empty", key: "e", value: "" }] }],
      shown: [], lists: [], params: {}
    };
    expect(seesLine(snapshot)).toBe("Sees: Lesson · Doubles · Your answer (12 lines) · Notes (7 characters)");
    expect(seesLine({ ...snapshot, record: { table: "Lessons", id: "12", title: "", values: [] }, forms: [] })).toBe("Sees: Lesson · Lessons #12");
    const many = { ...snapshot, record: null, forms: [{ about: "", fields: ["A", "B", "C", "D", "E"].map((label) => ({ label, key: label, value: "x" })) }] };
    expect(seesLine(many)).toBe("Sees: Lesson · A (1 character) · B (1 character) · C (1 character) and 2 more");
    expect(seesLine(null)).toBe("");
  });
});
