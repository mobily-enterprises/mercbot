// Private tables (D-138): for each table, the home's owners and admins choose who may read its records and who may
// change them: everyone in the home (as before), owners and admins only, or named people (owners and admins too).
// Changing needs no less than reading. A public app's visitors reach what its visitor access lists (D-66), and the data
// gate keeps to this for everyone else, whatever way they come in.
export const ACCESS_LEVELS = ["everyone", "managers", "people"];
const MANAGERS = new Set(["owner", "admin"]);

/** A table's access, filled in: { read, change, people }. */
export const accessOf = (table) => ({
  read: table?.access?.read || "everyone",
  change: table?.access?.change || "everyone",
  people: (table?.access?.people || []).map(String)
});

/** Whether a table is anything but open to everyone. */
export const isPrivate = (table) => {
  const access = accessOf(table);
  return access.read !== "everyone" || access.change !== "everyone";
};

/**
 * Whether `who` ({ person, role }, or { visitor: true }) may `mode` ("read" or "change") a table's records. Someone the
 * call names no person for (a job whose person left) reaches only tables open to everyone.
 */
export function allows(table, who, mode) {
  const access = accessOf(table);
  const level = mode === "change" ? access.change : access.read;
  if (level === "everyone" || who?.visitor) return true;
  if (!who?.person) return false;
  if (MANAGERS.has(who.role)) return true;
  return level === "people" && access.people.includes(String(who.person));
}

/** Who a level lets in, in words: "owners and admins", "owners, admins and 2 people". */
export const levelWords = (level, people = []) =>
  level === "managers" ? "owners and admins" : level === "people" ? `owners, admins and ${people.length === 1 ? "1 person" : `${people.length} people`}` : "everyone";

// Personal tables (D-145): a table made "each person's own" has one owner field, "whose" (a person), that only the data
// gate sets: to the person acting when a record is made, and never to anything else after. The gate then reaches only
// that person's records for them, everywhere.
export const OWNER_KEY = "whose";

/** A personal table's owner field, or null for a table everyone shares. */
export const ownerFieldOf = (table) => table?.fields?.find((field) => !field.obsolete && field.options?.owner === true) || null;

/** Whether a table is each person's own. */
export const isPersonal = (table) => Boolean(ownerFieldOf(table));
