import { SECRET_FIELDS, VAULT_FIELDS, VAULT_IMPORT_LIMIT, cardDigits, vaultProblem } from "@local/account/shared/vault";

// Settings → Vault → Import from a CSV file. The file is read here, in the browser: its first row
// names the columns, which are matched to the chosen kind's fields by the names password managers,
// browsers and address books give them (and the person can change any match), and the preview
// shows what will be saved, secrets hidden, with the rows that can't be and why, by the same rules
// the server checks (@local/account/shared/vault). Only the matched fields of the rows that can be
// saved go to the server, a batch at a time, where they're sealed like items added by hand.

/** The most rows a file may have. */
export const ROW_LIMIT = 5000;
// The largest file read, so a huge one is refused before the page reads it all: 5,000 rows of a
// password manager's export, notes and all, fit many times over.
const FILE_LIMIT = 10 * 1024 * 1024;

export const KIND_TITLES = Object.freeze({ login: "Logins", card: "Cards", contact: "Contact info" });

export const FIELD_TITLES = Object.freeze({
  website: "Website",
  username: "Username or email",
  password: "Password",
  notes: "Notes",
  number: "Card number",
  expiry: "Expiry",
  code: "Security code",
  name: "Name on card",
  nickname: "Nickname",
  billing: "Billing address",
  label: "Label",
  fullName: "Full name",
  address: "Address",
  address2: "Address line 2",
  city: "City",
  region: "State or region",
  postalCode: "Postal code",
  country: "Country",
  phone: "Phone",
  email: "Email"
});

// Column names each field goes by, in order of preference, written as compareAs() leaves them.
const KNOWN = Object.freeze({
  login: {
    website: ["url", "website", "loginuri", "loginurl", "uri", "site", "webaddress", "origin", "hostname", "name", "title"],
    username: ["username", "loginusername", "user", "login", "email", "emailaddress", "userid", "account"],
    password: ["password", "loginpassword", "pass", "passwd", "pwd"],
    notes: ["notes", "note", "extra", "comments", "comment", "memo"]
  },
  card: {
    number: ["cardnumber", "number", "ccnumber", "creditcardnumber", "cardno"],
    expiry: ["expiry", "expirydate", "expiration", "expirationdate", "exp", "expdate", "expires", "validthru"],
    code: ["securitycode", "cvv", "cvc", "cvv2", "csc", "code", "cardcode", "verificationcode"],
    name: ["nameoncard", "cardholder", "cardholdername", "holder", "name"],
    nickname: ["nickname", "label", "title", "description"],
    billing: ["billingaddress", "billing", "address"]
  },
  contact: {
    label: ["label"],
    fullName: ["fullname", "name", "displayname", "contactname", "fileas"],
    address: ["address", "streetaddress", "street", "address1", "addressline1", "address1street", "homestreet", "businessstreet"],
    address2: ["address2", "addressline2", "street2", "homestreet2", "businessstreet2"],
    city: ["city", "town", "locality", "address1city", "homecity", "businesscity"],
    region: ["region", "state", "province", "county", "stateorregion", "stateregion", "address1region", "homestate", "businessstate"],
    postalCode: ["postalcode", "postcode", "zip", "zipcode", "address1postalcode", "homepostalcode", "businesspostalcode"],
    country: ["country", "countryregion", "address1country", "homecountryregion", "businesscountryregion"],
    phone: ["phone", "phonenumber", "telephone", "tel", "mobile", "mobilephone", "cell", "phone1value", "primaryphone", "homephone", "businessphone"],
    email: ["email", "emailaddress", "email1value", "mail"]
  }
});

/** A column name as it's compared: lower case, letters and digits only ("E-mail Address" → "emailaddress"). */
const compareAs = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]/gu, "");

/**
 * The file's rows as arrays of text, its first row (the column names) first.
 * @param {File} file
 * @returns {Promise<string[][]>}
 */
export async function readCsvFile(file) {
  if (!/\.csv$/iu.test(file.name)) throw new Error("Choose a .csv file.");
  if (file.size > FILE_LIMIT) throw new Error("That file is larger than 10 MB. Split it into smaller files.");
  const { parse } = await import("csv-parse/browser/esm/sync");
  const text = await file.text();
  try {
    return parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true, relax_quotes: true });
  } catch (error) {
    // The parser's own words ("Quote Not Closed: …") are for programmers; the person gets the line.
    throw new Error(`That file isn't valid CSV${error.lines ? ` around line ${error.lines}` : ""}. Export it again, or open it in a spreadsheet and save it as CSV.`);
  }
}

/**
 * What a file holds, from its column names: logins if one is a password, cards if one is a card
 * number (a bare "number" could be anything's), otherwise contact info.
 * @param {string[]} header
 */
export function guessKind(header) {
  const names = new Set(header.map(compareAs));
  if (KNOWN.login.password.some((name) => names.has(name))) return "login";
  if (KNOWN.card.number.some((name) => name !== "number" && names.has(name))) return "card";
  return "contact";
}

/**
 * Which column fills each of the kind's fields, by name: { field: column index, or -1 for none }.
 * A column fills one field at most.
 * @param {string} kind
 * @param {string[]} header
 */
export function matchColumns(kind, header) {
  const names = header.map(compareAs);
  const taken = new Set();
  const columns = {};
  for (const field of VAULT_FIELDS[kind]) {
    const index = (KNOWN[kind][field] || []).map((name) => names.findIndex((candidate, at) => candidate === name && !taken.has(at))).find((at) => at >= 0);
    columns[field] = index ?? -1;
    if (index !== undefined) taken.add(index);
  }
  return columns;
}

// A website's address as the Vault keeps a site: "https://www.example.com/login" → "example.com".
function siteOf(value) {
  if (!/^https?:\/\//iu.test(value)) return value;
  return value.replace(/^https?:\/\//iu, "").replace(/^www\./iu, "").split(/[/?#]/u)[0].toLowerCase();
}

// An expiry written as 7/28, 07-28, 07/2028 or 2028-07 → "07/28"; anything else stays as it is.
function expiryOf(value) {
  const monthFirst = /^(\d{1,2})\s*[/.-]\s*(?:20)?(\d{2})$/u.exec(value);
  const yearFirst = /^20(\d{2})\s*[/.-]\s*(\d{1,2})$/u.exec(value);
  const [month, year] = monthFirst ? [monthFirst[1], monthFirst[2]] : yearFirst ? [yearFirst[2], yearFirst[1]] : [];
  return month ? `${month.padStart(2, "0")}/${year}` : value;
}

/**
 * The items the file's rows make: those that can be saved, each with its row in the file (the
 * column names are row 1), and those that can't, with why. Rows with nothing in the matched
 * columns are left out, and so are the rows in `saved`, added by an import that stopped part way.
 * Values are trimmed, apart from passwords, which are kept exactly.
 * @param {string} kind
 * @param {string[][]} rows the rows after the column names
 * @param {Record<string, number>} columns matchColumns' answer, as the person left it
 * @param {Set<number>} [saved]
 */
export function itemsFrom(kind, rows, columns, saved = new Set()) {
  const items = [];
  const skipped = [];
  rows.forEach((cells, index) => {
    if (saved.has(index + 2)) return;
    const data = {};
    for (const field of VAULT_FIELDS[kind]) {
      const cell = columns[field] >= 0 ? String(cells[columns[field]] ?? "") : "";
      const value = field === "password" ? cell : cell.trim();
      if (value) data[field] = field === "website" ? siteOf(value) : field === "expiry" ? expiryOf(value) : value;
    }
    if (!Object.keys(data).length) return;
    const row = index + 2;
    const problem = vaultProblem(kind, data);
    if (problem) skipped.push({ row, problem: problem.message });
    else items.push({ row, data });
  });
  return { items, skipped };
}

/**
 * A value as the preview shows it: secrets hidden, a card number by its last four digits.
 * @param {string} field
 * @param {string} [value]
 */
export function previewValue(field, value) {
  if (!value) return "";
  if (field === "number") return `•••• ${cardDigits(value).slice(-4)}`;
  return SECRET_FIELDS.includes(field) ? "••••••" : value;
}

/**
 * Sends the items a batch at a time. Each batch is saved whole or not at all, so if one is refused
 * the import stops there, with the number added before it.
 * @param {string} kind
 * @param {Array<{ row: number, data: Record<string, string> }>} items
 * @param {(kind: string, items: object[]) => Promise<unknown>} send accountApi.importVaultItems
 * @returns {Promise<{ added: number, error?: Error }>}
 */
export async function importItems(kind, items, send) {
  let added = 0;
  for (let start = 0; start < items.length; start += VAULT_IMPORT_LIMIT) {
    const batch = items.slice(start, start + VAULT_IMPORT_LIMIT);
    try {
      await send(kind, batch);
    } catch (error) {
      return { added, error };
    }
    added += batch.length;
  }
  return { added };
}
