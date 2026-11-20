import { describe, expect, it } from "vitest";
import { changedParts, diffExcerpt, useTemplateDraft, wordDiff } from "../../src/components/mercbot/templateDraft.js";

// The draft screen's state (D-98, amended 20 November): every drafting call takes a whole new draft, what changed is
// highlighted against the draft before, Undo steps back through the earlier drafts kept on the page only, hand edits
// change the draft directly, each problem shows at its part, and Save stays off while there are any.
const setup = { name: "Setup interview", description: "What to ask first.", instructions: "1. Ask which plants they have." };
const draftOf = (extra = {}) => ({
  tag: "garden",
  description: "Keeps the garden watered.",
  greeting: "Hi {firstName}, I'll keep your garden watered.",
  instructions: "You keep the garden watered. Ask before buying anything.",
  skills: [setup],
  ...extra
});

/** The state with a stand-in drafting call answering each draft in turn, and what it was asked. */
function screen(answers, options = {}) {
  const asked = [];
  const queue = [...answers];
  const ask = async (body) => {
    asked.push(JSON.parse(JSON.stringify(body)));
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return { draft: next, problems: [] };
  };
  return { asked, state: useTemplateDraft({ ask, taken: () => ["meals", "general"], ...options }) };
}

describe("the draft screen", () => {
  it("highlights the parts a change made, word by word in long parts", async () => {
    const { asked, state } = screen([draftOf(), draftOf({ instructions: "You keep the garden and the pond watered. Ask before buying anything.", skills: [setup, { ...setup, name: "Pond" }] })]);
    await state.draftNew("keep our garden watered");
    expect(asked[0]).toEqual({ purpose: "new", describe: "keep our garden watered" });
    expect(state.changes.value.size).toBe(0);
    expect(state.earlier.value).toEqual([]);

    await state.askForChanges("Add the pond.");
    expect(asked[1]).toEqual({ purpose: "change", draft: draftOf(), request: "Add the pond." });
    expect([...state.changes.value]).toEqual(["instructions", "skills.1.name", "skills.1.description", "skills.1.instructions", "skills"]);
    expect(wordDiff("You keep the garden watered.", "You keep the garden and the pond watered.")).toEqual([
      { text: "You keep the garden ", change: "kept" },
      { text: "and the pond ", change: "added" },
      { text: "watered.", change: "kept" }
    ]);
    expect(wordDiff("Water on Mondays.", "Water on Fridays.")).toEqual([
      { text: "Water on ", change: "kept" },
      { text: "Mondays.", change: "removed" },
      { text: "Fridays.", change: "added" }
    ]);
    const long = `${"word ".repeat(30)}old ${"tail ".repeat(30)}`;
    expect(diffExcerpt(wordDiff(long, long.replace("old", "new"))).map((part) => part.text)).toEqual([
      `… ${"word ".repeat(8)}`,
      "old ",
      "new ",
      `${"tail ".repeat(8)}… `
    ]);
    expect(changedParts(draftOf(), draftOf({ tag: "pond" }))).toEqual(new Set(["tag"]));
  });

  it("Undo steps back through the drafts kept on the page, asking nothing", async () => {
    const first = draftOf();
    const second = draftOf({ greeting: "Hello {firstName}." });
    const third = draftOf({ greeting: "Hello {firstName}.", description: "Waters the garden and the pond." });
    const { asked, state } = screen([first, second, third]);
    await state.draftNew("keep our garden watered");
    await state.askForChanges("Shorter greeting.");
    await state.askForChanges("Add the pond.");
    expect(state.earlier.value).toEqual([first, second]);
    state.undo();
    expect(state.draft.value).toEqual(second);
    expect([...state.changes.value]).toEqual(["greeting"]);
    state.undo();
    expect(state.draft.value).toEqual(first);
    expect(state.earlier.value).toEqual([]);
    state.undo();
    expect(state.draft.value).toEqual(first);
    expect(asked).toHaveLength(3);
    // A new screen keeps nothing of this one's drafts.
    expect(screen([]).state.draft.value).toBe(null);
  });

  it("takes hand edits of any part, and a change request sends the draft as edited", async () => {
    const { asked, state } = screen([draftOf(), draftOf({ instructions: "Changed." })]);
    await state.draftNew("keep our garden watered");
    state.edit("tag", "plants");
    state.edit("skills.0.instructions", "1. Ask what grows.");
    state.addSkill();
    state.edit("skills.1.name", "Weekly check");
    state.edit("skills.1.description", "A look round on Sundays.");
    state.edit("skills.1.instructions", "1. List what needs doing.");
    expect(state.draft.value.tag).toBe("plants");
    expect(state.dirty.value).toBe(true);
    await state.askForChanges("Change the instructions.");
    expect(asked[1].draft).toMatchObject({ tag: "plants", skills: [{ instructions: "1. Ask what grows." }, { name: "Weekly check" }] });
    state.removeSkill(1);
    expect(state.draft.value.skills.map((skill) => skill.name)).toEqual(["Setup interview"]);
    // An edit starts from the template as it is, and isn't changed until a part is.
    const editing = screen([], { start: draftOf(), templateId: "7" }).state;
    expect([editing.draft.value, editing.dirty.value]).toEqual([draftOf(), false]);
  });

  it("shows each problem at its part and keeps Save off while there are any", async () => {
    const { state } = screen([draftOf(), new Error("Couldn't write a template from that. Try different words.")]);
    expect(state.canSave.value).toBe(false);
    await state.draftNew("keep our garden watered");
    expect(state.canSave.value).toBe(true);
    state.edit("tag", "meals");
    state.edit("greeting", "Hello.");
    state.edit("skills.0.name", "Questions");
    expect(Object.fromEntries(state.problemsAt.value)).toEqual({
      tag: "Another template already has this tag.",
      greeting: "At most 600 characters, with {firstName} where the person's name goes.",
      setup: "The setup questions are missing: a skill named Setup interview."
    });
    expect(state.canSave.value).toBe(false);
    state.edit("tag", "garden");
    state.edit("greeting", "Hi {firstName}.");
    state.addSkill({ setup: true });
    expect(state.problemsAt.value.get("skills.0.description")).toBe("Up to 160 characters.");
    state.edit("skills.0.description", "What to ask.");
    state.edit("skills.0.instructions", "1. Ask what grows.");
    expect([state.problems.value, state.canSave.value]).toEqual([[], true]);
    // The server's own refusal shows at its part until the draft changes, and a failed call leaves the draft as it was.
    state.refuse([{ field: "tag", text: "Another template already has this tag." }]);
    expect([state.problemsAt.value.get("tag"), state.canSave.value]).toEqual(["Another template already has this tag.", false]);
    state.edit("tag", "plants");
    expect(state.canSave.value).toBe(true);
    const before = JSON.stringify(state.draft.value);
    expect(await state.askForChanges("Anything.")).toBe(false);
    expect([state.failure.value, JSON.stringify(state.draft.value)]).toEqual(["Couldn't write a template from that. Try different words.", before]);
  });
});
