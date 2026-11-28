import { describe, expect, it } from "vitest";
import { formOnScreen, screenSnapshot } from "../../src/components/apps/appSnapshot.js";
import { ON_SCREEN_LIMITS } from "../../packages/bots/src/shared/onScreen.js";

// What's on screen in an app, sent with each message to its bot from the app's chat (D-147): a form's typed text whole
// and character for character, saved or not, a private field left out, the screen's words and lists as shown, and the
// limits, cut with a note. The page's elements are stand-ins with the words a browser would give.

const CODE = "def double(n):\n\t# give back n times 2  \n    return n  # 🙂 not yet\n";
const progress = { id: "t2", key: "prog_progress", label: "My progress", titleFieldId: null, fields: [{ id: "f1", key: "code", label: "My code", type: "longtext", options: {} }, { id: "f2", key: "notes", label: "Notes", type: "text", options: {} }] };
const lessons = { id: "t1", key: "prog_lessons", label: "Lessons", titleFieldId: "f3", fields: [{ id: "f3", key: "title", label: "Lesson", type: "text", options: {} }, { id: "f4", key: "solution", label: "Solution", type: "longtext", options: {} }] };
const entry = (table, key, extra = {}) => ({ field: key, def: table.fields.find((field) => field.key === key), ...extra });
const asTyped = (_field, value) => value ?? "";

/** A runtime with the lesson open and the person's progress form on it, its fields as typed. */
function runtimeWith(draft, { privateNotes = false } = {}) {
  const form = () => formOnScreen({
    table: progress,
    record: { id: "40", code: "def double(n):\n    return 0", notes: "seen" },
    creating: false,
    entries: [entry(progress, "code", { label: "Your code" }), entry(progress, "notes", { private: privateNotes })],
    draft,
    toInput: asTyped
  });
  return {
    screen: { data: { lesson: { record: "prog_lessons", id: "=params.id" }, mine: { record: "prog_progress", id: "=params.mine" } } },
    data: { lesson: { id: "12", title: "Doubles", solution: "return n * 2" }, mine: { id: "40" } },
    queryTable: (name) => (name === "lesson" ? lessons : progress),
    forms: new Map([["content/5", form]])
  };
}
const where = { app: { name: "Learn to program", slug: "learn-to-program" }, screen: { key: "lesson", title: "Lesson" }, params: { id: "12", mine: "40" } };

/** A page element as a browser gives it: its words, the parts inside it, and its own data. */
function element(text, { type = "", label = "", inside = [], rows = [], head = [] } = {}) {
  const self = {
    innerText: text,
    dataset: { appType: type, appLabel: label },
    contains: (other) => other === self || inside.includes(other),
    querySelectorAll: (selector) => (selector === "thead th" ? head : selector === "tbody tr" ? rows : selector === "td" ? inside : []),
    querySelector: () => null
  };
  return self;
}

describe("what's on screen in an app, as its bot is sent it", () => {
  it("holds a form's unsaved code character for character, marked as not saved yet", () => {
    const snapshot = screenSnapshot({ ...where, runtime: runtimeWith({ code: CODE, notes: "seen" }), main: null });
    expect(snapshot.forms).toEqual([{
      about: "editing My progress #40",
      fields: [
        { label: "Your code", key: "code", value: CODE, unsaved: true },
        { label: "Notes", key: "notes", value: "seen" }
      ]
    }]);
    expect(snapshot.record).toEqual({ table: "Lessons", id: "12", title: "Doubles", values: [{ label: "Lesson", key: "title", value: "Doubles" }, { label: "Solution", key: "solution", value: "return n * 2" }] });
    expect(snapshot.params).toEqual({ id: "12", mine: "40" });
  });

  it("takes the record the screen is opened on, by its own first parameter, over another it reads by a parameter", () => {
    const runtime = runtimeWith({ code: CODE });
    runtime.screen = { params: { id: {}, course: {} }, data: { course: { record: "prog_lessons", id: "=params.course" }, ...runtime.screen.data } };
    runtime.data = { ...runtime.data, course: { id: "3", title: "Python from zero" } };
    expect(screenSnapshot({ ...where, runtime, main: null }).record.title).toBe("Doubles");
  });

  it("names the record open by its title as shown, a link's title too", () => {
    const linked = { ...lessons, titleFieldId: "f5", fields: [...lessons.fields, { id: "f5", key: "unit", label: "Unit", type: "link", options: {} }] };
    const runtime = { ...runtimeWith({ code: CODE }), queryTable: (name) => (name === "lesson" ? linked : progress) };
    runtime.data.lesson.unit = { value: "3", label: "First steps" };
    expect(screenSnapshot({ ...where, runtime, main: null }).record.title).toBe("First steps");
  });

  it("leaves out a field the screen marks private, in its form and in the record open", () => {
    const snapshot = screenSnapshot({ ...where, runtime: runtimeWith({ code: CODE, notes: "my secret" }, { privateNotes: true }), main: null });
    expect(snapshot.forms[0].fields.map((field) => field.key)).toEqual(["code"]);
    expect(JSON.stringify(snapshot)).not.toContain("my secret");
  });

  it("reads the screen's words and its lists' first rows as shown, each part once", () => {
    const passed = element("What the tests said:", { type: "text" });
    const inner = element("FAILED test_doubles_three", { type: "text" });
    const outer = element("Output\nFAILED test_doubles_three", { type: "field", inside: [inner] });
    const cells = [element("Doubles"), element("Done")];
    const row = element("", { inside: cells });
    row.querySelectorAll = (selector) => (selector === "td" ? cells : []);
    const list = element("", { type: "table", label: "", rows: [row], head: [element("Lesson"), element("Status")] });
    const shown = [passed, outer, inner];
    const main = {
      querySelectorAll: (selector) => (selector.includes("[data-app-type=\"table\"]") && !selector.includes(",") ? [list] : shown),
      querySelector: () => element("Exercise")
    };
    const snapshot = screenSnapshot({ ...where, runtime: runtimeWith({ code: CODE }), main, notice: "Not quite: 2 tests failed." });
    expect(snapshot.shown).toEqual(["What the tests said:", "Output\nFAILED test_doubles_three"]);
    expect(snapshot.lists).toEqual([{ name: "", table: "", total: null, rows: ["Lesson: Doubles · Status: Done"] }]);
    expect(snapshot.tab).toBe("Exercise");
    expect(snapshot.notice).toBe("Not quite: 2 tests failed.");
  });

  it("keeps a field whole up to its limit and everything to the total, cut with a note", () => {
    expect([ON_SCREEN_LIMITS.field, ON_SCREEN_LIMITS.total]).toEqual([20000, 60000]);
    const long = "x".repeat(ON_SCREEN_LIMITS.field + 5);
    const one = screenSnapshot({ ...where, runtime: runtimeWith({ code: long }), main: null });
    expect(one.forms[0].fields[0].value).toBe(`${"x".repeat(ON_SCREEN_LIMITS.field)}\n[… cut here: 5 more characters]`);
    // Four whole fields: the fourth doesn't fit in all that's sent, and the snapshot says something was left out.
    const big = "y".repeat(ON_SCREEN_LIMITS.field);
    const runtime = runtimeWith({});
    runtime.forms = new Map([["a", () => ({ about: "a", fields: [1, 2, 3, 4].map((n) => ({ label: `Box ${n}`, key: `b${n}`, value: big })), hidden: [] })]]);
    runtime.data = {};
    const all = screenSnapshot({ ...where, runtime, main: null });
    expect(all.forms[0].fields.map((field) => field.key)).toEqual(["b1", "b2", "b3"]);
    expect(all.cut).toBe(true);
  });
});
