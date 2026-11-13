// The Vault's items (D-17), with the rules for saving one: the server checks them before it
// keeps an item, and the Vault's forms and its CSV import check them as the person types or chooses
// a file, so both always agree. Contact info is kept plain; a login's password and notes, and a
// card's number, security code and billing address, are what the server seals.

/** Each kind's fields, in the order its form shows them. */
export const VAULT_FIELDS = Object.freeze({
  login: Object.freeze(["website", "username", "password", "notes"]),
  card: Object.freeze(["number", "expiry", "code", "name", "nickname", "billing"]),
  contact: Object.freeze(["label", "fullName", "address", "address2", "city", "region", "postalCode", "country", "phone", "email"])
});

/** The fields the server seals: never shown again once saved. */
export const SECRET_FIELDS = Object.freeze(["password", "notes", "number", "code", "billing"]);

/** The most items one import call adds; the Vault sends a longer file in turns. */
export const VAULT_IMPORT_LIMIT = 100;

/**
 * A field as the Vault keeps it: trimmed text of at most `limit` characters.
 * @param {unknown} value
 * @param {number} [limit]
 */
export function vaultText(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

/**
 * A card number's digits, whatever spaces or dashes it was written with.
 * @param {unknown} value
 */
export const cardDigits = (value) => String(value || "").replace(/\D/gu, "");

/**
 * Whether a card number passes the Luhn check.
 * @param {string} digits
 */
function luhn(digits) {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * Why an item can't be saved, as the sentence the person sees and its code, or null when it can.
 * @param {string} kind "login", "card" or "contact"
 * @param {Record<string, unknown>} [data]
 * @returns {{ message: string, code: string } | null}
 */
export function vaultProblem(kind, data = {}) {
  if (kind === "contact") {
    return ["fullName", "address", "email", "phone"].some((field) => vaultText(data[field]))
      ? null
      : { message: "Add at least a name, an address, an email or a phone number.", code: "account_vault_contact_empty" };
  }
  if (kind === "login") {
    return vaultText(data.website) && data.password
      ? null
      : { message: "A login needs a website and a password.", code: "account_vault_login_incomplete" };
  }
  if (kind === "card") {
    const digits = cardDigits(data.number);
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) {
      return { message: "That card number isn't valid.", code: "account_vault_card_number_invalid" };
    }
    return /^(0[1-9]|1[0-2])\/\d{2}$/u.test(vaultText(data.expiry, 5))
      ? null
      : { message: "Give the expiry as MM/YY.", code: "account_vault_card_expiry_invalid" };
  }
  return { message: "Choose a login, a card or contact info.", code: "account_vault_kind_unknown" };
}
