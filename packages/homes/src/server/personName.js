/**
 * A person's name as the others in a home see it (D-36, D-46): who added a home's account, who wrote
 * in a shared conversation or a notebook note, who made a template. Their display name, else the
 * part of their email before the @, else "" (each place says "Someone" its own way).
 * @param {{ displayName?: string | null, email?: string | null } | null | undefined} person a users.profiles record
 * @returns {string}
 */
export function personName(person) {
  return person?.displayName || String(person?.email || "").split("@")[0] || "";
}
