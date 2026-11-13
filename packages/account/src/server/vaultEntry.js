import { VAULT_FIELDS, cardDigits, vaultProblem, vaultText as text } from "../shared/vault.js";
import { AccountError } from "./accountError.js";
import { seal } from "./vaultCrypto.js";

// The Vault (D-17). Contact info is kept as plain fields. A login's password and notes,
// and a card's number, code and billing address, are sealed with the vault key; only what's
// needed to recognise an item (website and username, card ending and expiry) is plain. What makes
// an item complete is in ../shared/vault.js, which the Vault's forms check too.

// vault_items.label's length.
const LABEL_LIMIT = 120;

/**
 * The card's brand, from its first digits.
 * @param {string} digits
 */
function cardBrand(digits) {
  if (/^4/u.test(digits)) return "Visa";
  if (/^(5[1-5]|2[2-7])/u.test(digits)) return "Mastercard";
  if (/^3[47]/u.test(digits)) return "Amex";
  return "Card";
}

/**
 * A Vault item as it is stored: its label and its data, with the secret parts sealed.
 * @param {{ kind?: string, data?: Record<string, unknown> }} input
 * @param {Buffer | null} key
 */
export function vaultEntry(input, key) {
  const data = input.data || {};
  if (input.kind !== "contact" && !key) {
    throw new AccountError(503, "The vault isn't set up to keep passwords and cards on this server.", {
      code: "account_vault_unavailable"
    });
  }
  const problem = vaultProblem(input.kind, data);
  if (problem) throw new AccountError(400, problem.message, { code: problem.code });
  if (input.kind === "contact") {
    const fields = Object.fromEntries(VAULT_FIELDS.contact.map((field) => [field, text(data[field])]));
    return { label: text(fields.label || fields.fullName, LABEL_LIMIT) || "Contact", data: fields };
  }
  if (input.kind === "login") {
    const website = text(data.website);
    return {
      label: text(website, LABEL_LIMIT),
      data: {
        website,
        username: text(data.username),
        secret: seal({ password: String(data.password).slice(0, 500), notes: text(data.notes, 2000) }, key)
      }
    };
  }
  const digits = cardDigits(data.number);
  const brand = cardBrand(digits);
  const last4 = digits.slice(-4);
  const nickname = text(data.nickname, 60);
  return {
    label: nickname || `${brand} •••• ${last4}`,
    data: {
      brand,
      last4,
      expiry: text(data.expiry, 5),
      name: text(data.name),
      nickname,
      secret: seal({
        number: digits,
        code: cardDigits(data.code).slice(0, 4),
        billing: text(data.billing, 500)
      }, key)
    }
  };
}
