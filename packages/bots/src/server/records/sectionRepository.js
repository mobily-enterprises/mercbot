import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { BotsError } from "../botsError.js";
import { createCallerReaders, isId } from "./recordRows.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} ResourceHandle */

/**
 * A person's sections of their chat list in a home (records.chats.sections), each a row of theirs: listed and locked
 * in their order, one of them or a 404, inserted, renamed, swapped and deleted.
 * @param {ResourceHandle} sections the conversation_sections handle
 */
export function createSectionRecords(sections) {
  const { asRow } = createCallerReaders();
  const rowsOf = (records, options) => records.map((record) => asRow(record, options));

  /** The person's sections in the home, in their order. */
  async function sectionsOf(options) {
    return rowsOf(await sections.queryAll({ sort: ["position"] }, passedOn(options)), options);
  }

  /** The person's sections, locked, in their order: a change to their order holds them all. */
  async function lockSections(txOptions) {
    const locked = await sections.lockWhere({}, { ...passedOn(txOptions), all: true, lockMode: "noKeyUpdate" });
    return rowsOf(locked, txOptions).sort((a, b) => a.position - b.position);
  }

  /** One of the person's sections, or a 404. */
  async function ownedSection(sectionId, options) {
    const section = isId(sectionId) ? asRow(await sections.get(String(sectionId), {}, { ...passedOn(options), missing: "skip" }), options) : null;
    if (!section) throw new BotsError(404, "Section not found.", { code: "bots_section_not_found" });
    return section;
  }

  /** A new section at `position`, the ones from there on moved down one, in one write each. */
  async function insertSection(name, position, existing, txOptions) {
    const below = existing.filter((section) => section.position >= position);
    if (below.length) {
      await sections.patchMany(below.map((section) => ({ id: section.id, position: section.position + 1 })), { ...passedOn(txOptions), returning: "none" });
    }
    return asRow(await sections.create({ name, position }, passedOn(txOptions)), txOptions);
  }

  async function updateSection(sectionId, changes, options) {
    return asRow(await sections.patch(String(sectionId), changes, passedOn(options)), options);
  }

  /** Two sections swap places, in one write. */
  async function swapSections(first, second, txOptions) {
    await sections.patchMany([{ id: first.id, position: second.position }, { id: second.id, position: first.position }], { ...passedOn(txOptions), returning: "none" });
  }

  async function deleteSection(sectionId, options) {
    await sections.delete(String(sectionId), passedOn(options));
  }

  return Object.freeze({
    list: sectionsOf,
    lock: lockSections,
    owned: ownedSection,
    insert: insertSection,
    update: updateSection,
    swap: swapSections,
    remove: deleteSection
  });
}
