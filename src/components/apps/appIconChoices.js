// The app picture picker's choices (D-141): the pictures by group, narrowed by the words searched for.
import { APP_ICON_GROUPS } from "@local/apps/shared";

/** A picture's name as words: "receiptLong" is "receipt long". */
export const iconWords = (name) => String(name || "").replace(/([A-Z0-9])/gu, " $1").toLowerCase().trim();

/** The groups of pictures whose name or group has every word searched for, each with its pictures; empty groups go. */
export function iconGroups(search = "") {
  const words = String(search).toLowerCase().split(/\s+/u).filter(Boolean);
  return Object.entries(APP_ICON_GROUPS)
    .map(([group, names]) => ({
      group,
      names: names.filter((name) => words.every((word) => `${iconWords(name)} ${group.toLowerCase()}`.includes(word)))
    }))
    .filter((entry) => entry.names.length);
}
