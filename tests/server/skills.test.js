import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { __testables, catalogue, findSkill, pickable, useAddedSkills } from "../../packages/bots/src/server/skills.js";

const { library } = __testables;

// The skill library: every skill has a name, a description and guidance; some are
// background-only; the person's own skills sit beside Mercbot's.
test("every skill in the library is complete", () => {
  assert.ok(library().length >= 20);
  for (const skill of library()) {
    assert.ok(skill.name && skill.description && skill.instructions, skill.id);
    assert.ok(catalogue().includes(skill.name));
  }
});

test("the picker offers the person's skills and Mercbot's pickable ones, not background ones", () => {
  const own = [{ id: "12", name: "Weekly report", description: "Builds my weekly report", instructions: "1. …" }];
  const offered = pickable(own);
  assert.equal(offered[0].id, "u-12");
  assert.ok(offered.some((skill) => skill.name === "Shopping"));
  for (const background of library().filter((skill) => !skill.pickable)) {
    assert.ok(!offered.some((skill) => skill.id === background.id), background.name);
  }
  assert.equal(findSkill("u-12", own).name, "Weekly report");
  assert.equal(findSkill("weekly report", own).id, "u-12");
  assert.equal(findSkill("b-shopping").name, "Shopping");
  assert.equal(findSkill("nothing like it"), null);
});

// A copy built on Mercbot adds skills of its own (mercbot.added-skills): listed with Mercbot's by file name, in the
// standing instructions' list, the picker and read_skill, and never in place of one of Mercbot's.
test("a copy's added skills join Mercbot's by file name; one with a skill's file name is refused", async (t) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mercbot-added-skills-"));
  t.after(async () => {
    useAddedSkills([]);
    await rm(folder, { recursive: true, force: true });
  });
  const file = path.join(folder, "stocktaking.md");
  await writeFile(file, "name: Stocktaking\ndescription: Count what's on the shelves.\npickable: yes\n---\n- Count each shelf.\n");
  const before = library().map((skill) => skill.id);

  useAddedSkills([{ file }]);
  const ids = library().map((skill) => skill.id);
  assert.deepEqual(ids, [...before, "b-stocktaking"].sort(), "listed with Mercbot's, by file name");
  assert.ok(catalogue().split("\n").includes("- Stocktaking: Count what's on the shelves."));
  assert.deepEqual(findSkill("b-stocktaking"), { id: "b-stocktaking", name: "Stocktaking", description: "Count what's on the shelves.", pickable: true, instructions: "- Count each shelf." });
  assert.equal(findSkill("stocktaking").id, "b-stocktaking");
  assert.ok(pickable().some((skill) => skill.id === "b-stocktaking" && !skill.own));

  const shopping = path.join(folder, "shopping.md");
  await writeFile(shopping, "name: Another shopping\ndescription: Not Mercbot's.\npickable: yes\n---\n- Buy.\n");
  assert.throws(() => useAddedSkills([{ file: shopping }]), /has the file name of a skill already listed/u);
  assert.throws(() => useAddedSkills([{ file }, { file }]), /has the file name of a skill already listed/u);
  assert.equal(findSkill("b-shopping").name, "Shopping", "a refused list changes nothing");
  assert.equal(findSkill("b-stocktaking").name, "Stocktaking");

  useAddedSkills([]);
  assert.deepEqual(library().map((skill) => skill.id), before, "none added: Mercbot's own alone");
  assert.equal(findSkill("b-stocktaking"), null);
});
