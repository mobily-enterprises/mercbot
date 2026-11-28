import { isObject } from "./definitions.js";

// What an app's bot is told for it and offers on each screen (D-147): the definition's `brief`, a few plain sentences
// an app author or the Builder writes (what the bot is for here, how it helps), which goes into the cached start of the
// bot's prompt; and `suggestions`, questions by screen that the app's chat offers as chips. Both are versioned with the
// app's screens, so a template's follow its template and fork with it (D-141).

/** The longest brief: a few sentences. */
export const BRIEF_LIMIT = 1000;
/** A screen's suggestions: at most this many, each at most this long. */
export const SUGGESTION_LIMITS = Object.freeze({ perScreen: 4, length: 80 });
// What a screen with none of its own offers.
const ANY_SCREEN = Object.freeze(["What can I do here?", "How does this app work?"]);

/** The save check's part for them (check.js): plain words, a few of them, on screens the app has. */
export function checkBrief(definition, { report }) {
  const { brief, suggestions, screens } = definition;
  if (brief !== undefined && (typeof brief !== "string" || !brief.trim())) {
    report("brief", "is a few plain sentences: what the app's bot is for in this app and how it helps.");
  } else if (typeof brief === "string" && brief.length > BRIEF_LIMIT) {
    report("brief", `is at most ${BRIEF_LIMIT} characters: a few sentences.`);
  }
  if (suggestions === undefined) return;
  if (!isObject(suggestions)) return report("suggestions", 'is { "<screen>": ["A question people may ask there"] }.');
  for (const [screen, list] of Object.entries(suggestions)) {
    const at = `suggestions.${screen}`;
    if (!screens?.[screen]) report(at, `screen "${screen}" doesn't exist.`);
    if (!Array.isArray(list) || !list.length) {
      report(at, "is a list of questions in plain words.");
      continue;
    }
    if (list.length > SUGGESTION_LIMITS.perScreen) report(at, `has at most ${SUGGESTION_LIMITS.perScreen} questions.`);
    list.forEach((text, index) => {
      if (typeof text !== "string" || !text.trim()) report(`${at}[${index}]`, "is a question in plain words.");
      else if (text.length > SUGGESTION_LIMITS.length) report(`${at}[${index}]`, `is at most ${SUGGESTION_LIMITS.length} characters.`);
    });
  }
}

/**
 * The brief the app's bot gets: the app's own, else one written from its name and what it's for, the same words every
 * time (no AI), so the prompt's start stays the same.
 * @param {object | null} definition
 * @param {{ name: string, description?: string }} app
 */
export function briefOf(definition, { name, description = "" }) {
  const own = typeof definition?.brief === "string" ? definition.brief.trim() : "";
  if (own) return own;
  const what = description ? `, which is for this: ${description.trim()}` : "";
  return `You're the bot of the app "${name}"${what}. Help the person with what they're doing in it: answer questions about ` +
    "what's on their screen, explain how the app works, and look up or change its records for them when they ask.";
}

/** The questions the app's chat offers on one screen: the app's own for it, else two that fit any screen. */
export function suggestionsFor(definition, screen) {
  const own = definition?.suggestions?.[screen];
  return Array.isArray(own) && own.length ? own.slice(0, SUGGESTION_LIMITS.perScreen) : [...ANY_SCREEN];
}
