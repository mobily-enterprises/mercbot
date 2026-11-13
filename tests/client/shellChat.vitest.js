import { describe, expect, it } from "vitest";
import { createKeyHolds } from "../../src/components/mercbot/shellChat.js";

// A part a copy built on Mercbot adds (a shell part, a bot action, a message card) keeps the shell's keyboard shortcuts
// waiting while its own dialog is open, through the chat's holdKeys, as the shell's own dialogs do.
describe("the parts' holds on the keyboard", () => {
  it("hold while a part's dialog is open, and not once the part lets go", () => {
    const keyHolds = createKeyHolds();
    expect(keyHolds.held()).toBe(false);
    const dialogs = { feedback: false, template: false };
    const releaseFeedback = keyHolds.hold(() => dialogs.feedback);
    const releaseTemplate = keyHolds.hold(() => dialogs.template);
    expect(keyHolds.held()).toBe(false);
    dialogs.template = true;
    expect(keyHolds.held()).toBe(true);
    dialogs.template = false;
    dialogs.feedback = true;
    expect(keyHolds.held()).toBe(true);
    releaseFeedback();
    expect(keyHolds.held(), "a part that went away holds nothing, whatever its dialog says").toBe(false);
    dialogs.template = true;
    releaseTemplate();
    expect(keyHolds.held()).toBe(false);
  });
});
