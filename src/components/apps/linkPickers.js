import { reactive } from "vue";
import { appsApi } from "./appsApi.js";

// How many records a link picker offers at once: the target table's first ones, or those whose text
// has what the person typed.
export const LINK_CHOICES = 100;

/**
 * The link fields' pickers of a record form (RecordDialog): `choices[fieldId]` are { title, value }
 * items, and `loading[fieldId]` is true while that field's page is being read. Each picker reads a
 * page of its target table, all of them at once, and searches the server as the person types (the
 * records route's `search`), so any record can be picked, however many the table holds. The record a field links to now is always offered, under the label its read gave it.
 * @param {{ delayMs?: number }} [settings] how long typing pauses before the search goes out
 */
export function useLinkPickers({ delayMs = 300 } = {}) {
  const choices = reactive({});
  const loading = reactive({});
  const targets = new Map();
  const asked = {};
  const timers = {};
  let opened = 0;

  const choiceOf = (target, record) => ({ title: String(record[target.titleFieldId] ?? `#${record.id}`), value: String(record.id) });
  // A link as the records route answers it: { id, label }.
  const linkedNow = (link) => (link && typeof link === "object" && link.id != null ? { title: String(link.label ?? `#${link.id}`), value: String(link.id) } : null);
  // The page, with `kept` (the field's link or choice) first when the page lacks it.
  const withKept = (items, kept) => (kept && !items.some((item) => item.value === kept.value) ? [kept, ...items] : items);

  async function page(fieldId, text) {
    const target = targets.get(fieldId);
    const { records } = await appsApi.records(target.key, { size: LINK_CHOICES, search: text || undefined });
    return records.map((record) => choiceOf(target, record));
  }

  /** Every link field's first page, together, with what each links to now in `record`. */
  async function open(fields, tables, record) {
    const run = (opened += 1);
    targets.clear();
    for (const key of Object.keys(choices)) delete choices[key];
    for (const key of Object.keys(loading)) delete loading[key];
    const links = fields
      .filter((field) => field.type === "link")
      .map((field) => [field, tables.find((table) => table.id === field.options?.target)])
      .filter(([, target]) => target);
    await Promise.all(links.map(async ([field, target]) => {
      targets.set(field.id, target);
      const now = linkedNow(record?.[field.id]);
      if (now) choices[field.id] = [now];
      loading[field.id] = true;
      const items = await page(field.id, "").catch(() => null);
      if (run !== opened) return;
      loading[field.id] = false;
      if (items) choices[field.id] = withKept(items, now);
    }));
  }

  /**
   * The records whose text has `text`, once typing pauses; the one chosen now (`selected`) stays
   * offered. Choosing a record puts its title in the box, which searches for nothing new.
   */
  function search(fieldId, text, selected = null) {
    if (!targets.has(fieldId)) return Promise.resolve();
    const kept = (choices[fieldId] || []).find((item) => item.value === String(selected ?? "")) || null;
    const wanted = kept && text === kept.title ? "" : String(text || "").trim();
    const run = opened;
    const sequence = (asked[fieldId] = (asked[fieldId] || 0) + 1);
    clearTimeout(timers[fieldId]);
    return new Promise((resolve) => {
      timers[fieldId] = setTimeout(async () => {
        loading[fieldId] = true;
        const items = await page(fieldId, wanted).catch(() => null);
        if (run === opened && sequence === asked[fieldId]) {
          loading[fieldId] = false;
          if (items) choices[fieldId] = withKept(items, kept);
        }
        resolve();
      }, delayMs);
    });
  }

  return { choices, loading, open, search };
}
