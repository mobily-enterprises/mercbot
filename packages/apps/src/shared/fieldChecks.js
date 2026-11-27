import { formatMoney } from "./formulas.js";

// A field's own checks (D-140), besides its type and `required`: `min` and `max` for a number, an amount (in cents) or
// a date ("YYYY-MM-DD"); `pattern` for a text or phone field (the whole value must match it, `patternMessage` says
// what is wanted, e.g. "a postcode like 6000"); `unique` for a text, email, phone, web address or number field (no two
// live records share a value; text compares without case). The browser warns as people type; the data gate refuses.
export const LIMITED_TYPES = new Set(["number", "money", "date"]);
export const PATTERN_TYPES = new Set(["text", "phone"]);
export const UNIQUE_TYPES = new Set(["text", "email", "phone", "url", "number"]);
// Unique values that compare without case.
export const CASELESS_TYPES = new Set(["text", "email", "url"]);
const PATTERN_MAX = 200;

const shown = (field, value) => (field.type === "money" ? formatMoney(value) : String(value));
const compiled = new Map();
const patternOf = (source) => {
  if (!compiled.has(source)) compiled.set(source, new RegExp(`^(?:${source})$`, "u"));
  return compiled.get(source);
};

/** Why a value, as stored (a number, cents, "YYYY-MM-DD" or text), breaks its field's min, max or pattern; else "". */
export function limitProblem(field, value) {
  const options = field?.options || {};
  if (value === null || value === undefined || value === "") return "";
  if (LIMITED_TYPES.has(field.type)) {
    if (options.min !== undefined && options.min !== null && value < options.min) return `must be at least ${shown(field, options.min)}.`;
    if (options.max !== undefined && options.max !== null && value > options.max) return `must be at most ${shown(field, options.max)}.`;
  }
  if (PATTERN_TYPES.has(field.type) && options.pattern && !patternOf(options.pattern).test(String(value))) {
    return options.patternMessage ? `should be ${options.patternMessage}.` : "isn't in the form this field takes.";
  }
  return "";
}

/** The value a unique field compares: text without case. */
export const uniqueKey = (field, value) => (CASELESS_TYPES.has(field.type) ? String(value).toLowerCase() : value);

/**
 * Why a pattern can't be a field's, or "": too long, not a regular expression, or one that can take very long on a
 * long value (a back-reference, or a repeat of a group that itself repeats or has alternatives, such as "(a+)+").
 */
export function patternProblem(source) {
  const text = String(source ?? "");
  if (!text || text.length > PATTERN_MAX) return `a pattern is 1 to ${PATTERN_MAX} characters.`;
  try {
    patternOf(text);
  } catch (error) {
    return `that isn't a pattern: ${error.message}.`;
  }
  if (/\\[1-9]|\\k</u.test(text)) return "a pattern can't refer back to what it matched.";
  // Each group's text, and whether a repeat follows it.
  const starts = [];
  let inClass = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
    } else if (char === "(") {
      starts.push(index);
    } else if (char === ")") {
      const inner = text.slice(starts.pop() + 1, index).replace(/\\./gu, "").replace(/\[[^\]]*\]/gu, "");
      // An optional group ("?") runs at most once, so only a repeat of one can take long.
      if (/^[*+{]/u.test(text.slice(index + 1)) && /[*+{|]/u.test(inner)) {
        return "a repeated group can't itself repeat or have alternatives (it can take very long to check): write it without the outer repeat.";
      }
    }
  }
  return "";
}
