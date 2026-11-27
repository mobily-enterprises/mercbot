// A bot sees sign-in codes and sign-in links only in mailboxes the person whose turn it is connected (D-111). Every
// mailbox of a home is everyone's in it, so without this anyone's bot could sign in to someone else's accounts with a
// code or a magic link from that person's mail. Reading another person's mailbox, the mail tools hide them as they read
// it: the subject, the snippet and the text, before the bot sees any of it.
//
// It is a heuristic, read from the words: a code is a number or a short code (as signInCodeIn finds one) on a line that
// talks about signing in, verifying or a code, or on one of the two lines after it, or anywhere in an email whose
// subject does; a link is one whose address speaks of signing in, verifying, a reset or a token, or that stands on or
// just after such a line. It hides too much rather than too little: a promotion's code next to "code" goes as well. A
// code written in a picture, or in words, isn't found.

// A code: 4 to 8 digits, two groups of 3 or 4 digits ("123 456", "123-456"), or 6 to 8 capitals
// and digits with a digit in them ("AB12CD"). Not part of a date ("21 Nov 2026" included), time, price, number or
// address.
export const CODE = /(?<![\w$€£#+.,:/@-])(?<!\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,? )(\d{3,4}[ -]\d{3,4}|\d{4,8}|(?=[A-Z\d]*\d)(?=[A-Z\d]*[A-Z])[A-Z\d]{6,8})(?![\w%@]|[.,:/-]\w)/gu;

/** Words of a line that talks about a sign-in code, a sign-in, or verifying someone. */
const SIGN_IN_WORDS =
  /\b(codes?|passcode|otp|one[- ]time|verification|verify|verifying|security|pin|sign[- ]?in|signing in|log[- ]?in|logging in|login|2fa|two[- ](?:factor|step)|authenticat\w*|password|magic link)\b/iu;
// "G-123456 is your Google verification code": the code's own prefix.
export const PREFIXED = /\b[A-Z]-(?=\d{4,8}\b)/gu;
const LINK = /\bhttps?:\/\/[^\s<>"'()[\]]+/giu;
/** An address that is itself a sign-in: one to sign in, verify, confirm, reset a password, or that carries a token. */
const SIGN_IN_ADDRESS =
  /(sign-?in|signin|log-?in|login|magic|verif|confirm|reset|password|passwordless|auth(?!or)|token|otp|one-?time|session|activate|invite|code=)/iu;

export const HIDDEN_CODE = "[sign-in code hidden]";
export const HIDDEN_LINK = "[sign-in link hidden]";

/**
 * `text` with its sign-in codes and links hidden, and how many were. `primed`: the first two non-empty lines count as
 * following a sign-in line (the subject was one).
 * @param {string} text
 * @param {{ primed?: boolean }} [options]
 * @returns {{ text: string, hidden: number }}
 */
export function hideSignInSecrets(text, { primed = false } = {}) {
  const value = String(text ?? "");
  if (!value) return { text: value, hidden: 0 };
  let hidden = 0;
  // How many more non-empty lines are near a sign-in line.
  let near = primed ? 2 : 0;
  const lines = value.split(/(\r?\n)/u).map((line, index) => {
    if (index % 2 === 1 || !line.trim()) return line;
    const talks = SIGN_IN_WORDS.test(line);
    const close = talks || near > 0;
    near = talks ? 2 : Math.max(0, near - 1);
    const linked = line.replace(LINK, (address) => {
      if (!close && !SIGN_IN_ADDRESS.test(address)) return address;
      hidden += 1;
      return HIDDEN_LINK;
    });
    if (!close) return linked;
    return linked.replace(PREFIXED, "").replace(CODE, () => {
      hidden += 1;
      return HIDDEN_CODE;
    });
  });
  return { text: lines.join(""), hidden };
}

/** The fields of an email or a draft a mail tool shows that may hold a code or a link. */
const SHOWN = ["subject", "snippet", "text"];

/**
 * An email (or draft) as a bot may read it from a mailbox someone else connected: its subject, snippet and text with
 * sign-in codes and links hidden, the body read as following the subject when the subject talks of a sign-in, and
 * `signInHidden` saying so when anything was.
 * @template {Record<string, any>} T
 * @param {T} email
 * @returns {T & { signInHidden?: string }}
 */
export function hiddenInEmail(email) {
  if (!email || typeof email !== "object") return email;
  const primed = SIGN_IN_WORDS.test(String(email.subject || ""));
  let hidden = 0;
  const shown = { ...email };
  for (const field of SHOWN) {
    if (typeof email[field] !== "string") continue;
    const result = hideSignInSecrets(email[field], { primed: primed && field !== "subject" });
    shown[field] = result.text;
    hidden += result.hidden;
  }
  return hidden ? { ...shown, signInHidden: SECRETS_HIDDEN } : shown;
}

/** What the bot is told where something was hidden. */
export const SECRETS_HIDDEN =
  "Sign-in codes and links in this mailbox are hidden: someone else in the home connected it, and only their own bots see them. " +
  "Don't try to find them another way; if the person needs one, they ask the person who connected the mailbox.";
