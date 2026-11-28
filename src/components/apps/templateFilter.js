// The Templates tab's filter (D-141): the four kinds of use a template serves, and the words a person searches for.
import { iconWords } from "./appIconChoices.js";

/** The kinds of use, in the filter's order. */
export const TEMPLATE_AUDIENCES = Object.freeze([
  Object.freeze({ key: "corporate", label: "Corporate" }),
  Object.freeze({ key: "business", label: "Small business" }),
  Object.freeze({ key: "family", label: "Family" }),
  Object.freeze({ key: "personal", label: "Personal" })
]);

/**
 * Whether a template is shown: it serves the chosen kind of use ("all" is every one), and each word searched for is in
 * its name, description, tables or picture, whatever its case.
 */
export function matchesTemplate(template, audience, search) {
  if (audience !== "all" && !(template.audiences || []).includes(audience)) return false;
  const text = [template.name, template.description, ...(template.tables || []), iconWords(template.icon)].join(" ").toLowerCase();
  return String(search || "").toLowerCase().split(/\s+/u).filter(Boolean).every((word) => text.includes(word));
}
