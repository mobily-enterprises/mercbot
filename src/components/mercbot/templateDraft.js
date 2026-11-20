import { computed, ref } from "vue";
import { setupSkillOf, templateBody, templateProblems } from "@local/bots/shared/templateBody";

// The draft screen's state (D-98, amended 20 November): Make a new template, Start from this bot, and Settings →
// Templates → Edit. The draft on the page is the only state: every request to the bot sends it whole and takes a whole
// new draft back, the earlier drafts are kept here for Undo and lost when the screen closes, and what changed since the
// draft before is highlighted, word by word within long parts. Every draft, the bot's or edited by hand, is checked by
// the rules the server keeps it by (templateBody.js), each problem at its part.

/** The parts of a draft, as their highlights and problems name them: `skills.<n>.<part>` for a skill's. */
const PARTS = ["tag", "description", "greeting", "instructions"];
const SKILL_PARTS = ["name", "description", "instructions"];

/** A draft's text at one part, "" for none. @param {object} draft @param {string} path */
export function partOf(draft, path) {
  const [first, index, part] = path.split(".");
  return first === "skills" ? draft.skills[Number(index)]?.[part] ?? "" : draft[first] ?? "";
}

/**
 * The parts that differ between two drafts: the four of the template's own, each skill's three (a skill added or
 * removed changes all of its), and `skills` when their number changed.
 * @param {object} before
 * @param {object} after
 * @returns {Set<string>}
 */
export function changedParts(before, after) {
  const changed = new Set(PARTS.filter((part) => before[part] !== after[part]));
  const most = Math.max(before.skills.length, after.skills.length);
  for (let index = 0; index < most; index += 1) {
    for (const part of SKILL_PARTS) if (partOf(before, `skills.${index}.${part}`) !== partOf(after, `skills.${index}.${part}`)) changed.add(`skills.${index}.${part}`);
  }
  if (before.skills.length !== after.skills.length) changed.add("skills");
  return changed;
}

/**
 * Two texts compared word by word: the words of both in order, each kept, added or removed (spaces stay with the word
 * before them). The longest common run of words is kept, as a diff shows it.
 * @param {string} before
 * @param {string} after
 * @returns {Array<{ text: string, change: "kept" | "added" | "removed" }>}
 */
export function wordDiff(before, after) {
  const words = (text) => String(text || "").match(/\S+\s*|\s+/gu) || [];
  const from = words(before);
  const to = words(after);
  // Past about four million comparisons (two texts of some 2,000 words each), the whole of it is shown as replaced.
  if (from.length * to.length > 4e6) return [{ text: from.join(""), change: "removed" }, { text: to.join(""), change: "added" }];
  // lengths[i][j]: the longest common run of from[i..] and to[j..], one row at a time from the end.
  const lengths = Array.from({ length: from.length + 1 }, () => new Uint16Array(to.length + 1));
  for (let i = from.length - 1; i >= 0; i -= 1) {
    for (let j = to.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = from[i].trim() === to[j].trim() ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const parts = [];
  const push = (text, change) => {
    const last = parts.at(-1);
    if (last?.change === change) last.text += text;
    else parts.push({ text, change });
  };
  let i = 0;
  let j = 0;
  while (i < from.length && j < to.length) {
    if (from[i].trim() === to[j].trim()) {
      push(to[j], "kept");
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      push(from[i], "removed");
      i += 1;
    } else {
      push(to[j], "added");
      j += 1;
    }
  }
  while (i < from.length) push(from[i++], "removed");
  while (j < to.length) push(to[j++], "added");
  return parts;
}

/**
 * A word diff with long unchanged runs cut to `around` words each side of a change, "…" where they were cut: what a
 * long part shows under it of what changed.
 * @param {ReturnType<typeof wordDiff>} parts
 * @param {number} [around]
 */
export function diffExcerpt(parts, around = 8) {
  return parts.map((part, index) => {
    const words = part.text.match(/\S+\s*/gu) || [];
    if (part.change !== "kept" || words.length <= around * 2) return part;
    const head = index > 0 ? words.slice(0, around).join("") : "";
    const tail = index < parts.length - 1 ? words.slice(-around).join("") : "";
    return { text: `${head}… ${tail}`, change: "kept" };
  });
}

const copy = (draft) => templateBody(JSON.parse(JSON.stringify(draft)));

/**
 * The draft screen's state.
 * @param {{
 *   ask: (body: Record<string, unknown>) => Promise<{ draft: object }>,
 *   taken: () => Iterable<string>,
 *   start?: object | null,
 *   templateId?: string | null
 * }} options `ask` is the drafting call (botsApi.draftTemplate); `taken`, the tags another template has; `start`, the
 *   template an edit starts from, and `templateId`, its id
 */
export function useTemplateDraft({ ask, taken, start = null, templateId = null }) {
  const first = start ? copy(start) : null;
  // The draft on the page, edited by hand, and the drafts before it, newest last: Undo's steps, kept on the page only.
  const draft = ref(first ? copy(first) : null);
  const earlier = ref([]);
  const asking = ref(false);
  const failure = ref("");
  // A save's problems, as the server found them, until the draft changes again.
  const refused = ref([]);

  const base = computed(() => earlier.value.at(-1) ?? null);
  const changes = computed(() => (base.value && draft.value ? changedParts(base.value, draft.value) : new Set()));
  const problems = computed(() => (draft.value ? [...templateProblems(draft.value, { taken: new Set(taken()) }), ...refused.value] : []));
  /** Each part's first problem, by its path ("setup" and "skills" for the setup questions and the skills' number). */
  const problemsAt = computed(() => {
    const at = new Map();
    for (const { field, text } of problems.value) if (!at.has(field)) at.set(field, text);
    return at;
  });
  const setupIndex = computed(() => (draft.value ? draft.value.skills.indexOf(setupSkillOf(draft.value)) : -1));
  const dirty = computed(() => Boolean(draft.value) && JSON.stringify(draft.value) !== JSON.stringify(first));
  const canSave = computed(() => Boolean(draft.value) && !problems.value.length && !asking.value);

  /** One drafting call: its whole new draft takes the page's place, and the page's goes onto Undo's steps. */
  async function run(body) {
    if (asking.value) return false;
    asking.value = true;
    failure.value = "";
    try {
      const { draft: next } = await ask(body);
      if (draft.value) earlier.value = [...earlier.value, copy(draft.value)];
      draft.value = copy(next);
      refused.value = [];
      return true;
    } catch (error) {
      failure.value = error?.message || "The draft couldn't be written. Try again.";
      return false;
    } finally {
      asking.value = false;
    }
  }

  const draftNew = (describe) => run({ purpose: "new", describe });
  const draftFromBot = (botId, foldAdditions) => run({ purpose: "from-bot", botId, foldAdditions });
  const askForChanges = (request) => run({ purpose: "change", draft: draft.value, request, ...(templateId ? { templateId } : {}) });

  /** Back to the draft before the latest one, on the page alone: nothing is asked. */
  function undo() {
    if (!earlier.value.length || asking.value) return;
    draft.value = earlier.value.at(-1);
    earlier.value = earlier.value.slice(0, -1);
    refused.value = [];
  }

  /** A hand edit of one part: `tag`, `instructions` or `skills.<n>.<part>`. */
  function edit(path, value) {
    const [field, index, part] = path.split(".");
    if (field === "skills") draft.value.skills[Number(index)][part] = value;
    else draft.value[field] = value;
    refused.value = [];
  }

  /** A skill added by hand: the setup questions first when there are none, else another skill at the end. */
  function addSkill({ setup = false } = {}) {
    const skill = { name: setup ? "Setup interview" : "", description: "", instructions: "" };
    draft.value.skills = setup ? [skill, ...draft.value.skills] : [...draft.value.skills, skill];
    refused.value = [];
  }

  function removeSkill(index) {
    draft.value.skills = draft.value.skills.filter((_, at) => at !== index);
    refused.value = [];
  }

  /** The problems a save was refused with (422), shown at their parts. */
  const refuse = (list) => {
    refused.value = Array.isArray(list) ? list : [];
  };

  return {
    draft,
    earlier,
    asking,
    failure,
    changes,
    problems,
    problemsAt,
    setupIndex,
    dirty,
    canSave,
    draftNew,
    draftFromBot,
    askForChanges,
    undo,
    edit,
    addSkill,
    removeSkill,
    refuse
  };
}
