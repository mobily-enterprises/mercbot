import { noteAge } from "./useBotNotebook.js";

// Archiving a conversation that's in the way (D-101): a Shared bot's shared tab, hidden for everyone in the home, or the
// person's own You only, hidden for them. What a tab's menu offers, the question asked first, and how an archived one
// is listed.

/**
 * A tab's menu, by right-click or, on a phone, a long press: Rename for a shared tab, and Archive where the server says
 * the person may (`canArchive`: not General nor an app's tab; its starter, an owner or an admin; You only, its person).
 * @param {{ own?: boolean, canArchive?: boolean }} room
 * @param {{ rename: (room: object) => void, archive: (room: object) => void }} actions
 */
export function tabMenuItems(room, { rename, archive }) {
  return [
    ...(room.own ? [] : [{ title: "Rename", icon: "$edit", run: () => rename(room) }]),
    ...(room.canArchive ? [{ title: "Archive", icon: "$archive", run: () => archive(room) }] : [])
  ];
}

/**
 * The question before archiving, naming who it's hidden for and who can bring it back.
 * @param {{ title: string, own?: boolean }} room
 */
export function archiveQuestion(room) {
  const text = room.own
    ? "It's hidden for you only, and its routines and watches pause. Only you can resume it, from Archived conversations."
    : "It's hidden for everyone in the home, and its routines and watches pause. Anyone who started it, or an owner or admin, can " +
      "resume it from Archived conversations.";
  return { title: `Archive ${room.title}?`, text, confirmLabel: "Archive" };
}

/** The tab strip's button for the archived conversations the person sees, "Archived (N)", or "" while there are none. */
export const archivedLabel = (count) => (count > 0 ? `Archived (${count})` : "");

/**
 * An archived conversation's line in Archived conversations: who archived it ("you", a name, or nobody known) and when.
 * @param {{ archivedBy: string | null, archivedAt: string }} entry
 */
export function archivedLine(entry) {
  const when = noteAge(entry.archivedAt);
  return entry.archivedBy ? `Archived by ${entry.archivedBy} · ${when}` : `Archived · ${when}`;
}
