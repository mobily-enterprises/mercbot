import { createTool } from "@jskit-ai/agent/server";
import { getDomain, getDomainWithoutSuffix } from "tldts";
import { z } from "zod";
import { ConnectedAppError, connectedKeys } from "./connectedApps.js";
import { eventMessage } from "./eventMessage.js";
import { MAIL } from "./mailTools.js";

// Sign-in codes a site sends by email: a code sent to an inbox the bot can read, it fetches
// itself. The bot never sees a security code: Mercbot finds
// it in the person's own connected mailbox and types it straight into the page, as the secure form
// does. Only mail that came in the last few minutes from the site the bot's page is on is read, and
// its code is typed only into a page of that site: the sender's domain has to be registered as the
// page's own, so a page can't have another site's code typed in (D-77).
//
// A site where others can publish (a form on docs.google.com, a SaaS's customer pages) is registered
// as one site with the codes its owner sends, so the site alone can't tell a sign-in from a page
// someone made to collect a code. A code therefore goes in by itself only on a page the sign-in the
// person asked for led to: the bot starts that sign-in with start_sign_in, and the computer keeps its
// chain (packages/computer/src/server/signInChain.js). Anywhere else the person is asked first, on
// a card showing the page's full address and who sent the code, and nothing is typed until they say yes.

/** How far back a code can have come, and how long the bot waits for one still on its way. */
export const CODE_MAIL = Object.freeze({ minutes: 10, tries: 12, everyMs: 5000 });

const CODE_WORDS = /\b(codes?|passcode|otp|one[- ]time|verification|verify|security|pin|sign[- ]?in|log[- ]?in|login|confirm\w*)\b/iu;
// A code: 4 to 8 digits, two groups of 3 or 4 digits ("123 456", "123-456"), or 6 to 8 capitals
// and digits with a digit in them ("AB12CD"). Not part of a date, time, price, number or address.
const CODE = /(?<![\w$€£#+.,:/@-])(\d{3,4}[ -]\d{3,4}|\d{4,8}|(?=[A-Z\d]*\d)(?=[A-Z\d]*[A-Z])[A-Z\d]{6,8})(?![\w%@]|[.,:/-]\w)/gu;

/**
 * The sign-in code in an email: the first one on a line that talks about a code (its subject
 * first), or on one of the two lines after it. Null when there's none, rather than any number.
 * "G-123456" style codes give their digits.
 * @param {{ subject?: string, text?: string }} email
 * @returns {string | null}
 */
export function signInCodeIn({ subject = "", text = "" }) {
  const lines = [subject, ...String(text).split(/\r?\n/u)]
    .map((line) => String(line).replace(/\b[A-Z]-(?=\d{4,8}\b)/gu, " ").trim())
    .filter(Boolean);
  for (const [index, line] of lines.entries()) {
    if (!CODE_WORDS.test(line)) continue;
    for (const near of lines.slice(index, index + 3)) {
      const found = [...near.matchAll(CODE)].map((match) => match[1]);
      if (found.length) return found[0].replace(/[ -]/gu, "");
    }
  }
  return null;
}

/** A site's address as a domain: "https://www.Example.co.uk/login" gives example.co.uk. */
const domainOf = (site) =>
  String(site).trim().toLowerCase().replace(/^https?:\/\//u, "").replace(/^www\./u, "").split(/[/?#:]/u)[0];

/**
 * The domain a site is registered as, by the Public Suffix List: accounts.example.com gives
 * example.com, mail.example.co.uk gives example.co.uk, and someone.github.io stays itself, since
 * anyone can register a site under github.io, as under ltd.uk. Null for an address registered as
 * nothing (an IP address, localhost, a suffix such as co.uk).
 * @param {string} domain
 * @returns {string | null}
 */
export function baseDomain(domain) {
  return getDomain(String(domain).toLowerCase().replace(/\.$/u, ""), { allowPrivateDomains: true }) || null;
}

/** The address an email came from, as written in its From line: "Example <no-reply@example.com>" gives no-reply@example.com. */
const senderOf = (email) => /[^\s<>"]+@[^\s<>"]+/u.exec(email.from || "")?.[0].toLowerCase() || "";

/** Whether an email came from the page's own site: its sender's address is registered as `base`. */
const fromSite = (email, base) => baseDomain(senderOf(email).split("@")[1] || "") === base;

/** The site an address is registered as, or null. */
function siteOf(address) {
  try {
    return baseDomain(new URL(address).hostname);
  } catch {
    return null;
  }
}

/**
 * Whether an address is a site's front page: the domain it's registered as, or its www, with nothing after the slash. A
 * sign-in started there follows the site's own links to its sign-in; one started deeper could start on a page someone
 * else published on that site.
 * @param {string} address
 * @param {string} site A registered domain, as baseDomain gives it.
 */
function isFrontPage(address, site) {
  const { hostname, pathname, search } = new URL(address);
  return (hostname === site || hostname === `www.${site}`) && pathname === "/" && !search;
}

/**
 * Whether the person's words name a site: its address ("example.co.uk"), or its name as a word or a few words run
 * together ("Example", "Origin Energy" for originenergy.com.au).
 * @param {string} text
 * @param {string} site A registered domain, as baseDomain gives it.
 */
export function namesSite(text, site) {
  const said = String(text).toLowerCase();
  if (said.includes(site)) return true;
  const name = String(getDomainWithoutSuffix(site, { allowPrivateDomains: true }) || "").replace(/-/gu, "");
  if (!name) return false;
  const words = said.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.some((_, at) => [1, 2, 3].some((count) => words.slice(at, at + count).join("") === name));
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The person's own mailboxes that may be read, or none (a mail action switched off in Connect apps stays off). */
async function ownMailboxes(access) {
  try {
    return await connectedKeys({ ...access, own: true }, Object.keys(MAIL), "email");
  } catch (error) {
    if (error instanceof ConnectedAppError) return [];
    throw error;
  }
}

/** The newest code in one mailbox since `since`, from mail that `matches` (the three newest such emails). */
async function codeIn(entry, since, matches) {
  const app = MAIL[entry.pluginId];
  const recent = (await app.recentEmails(entry.key, since)).filter(matches);
  for (const email of recent.slice(0, 3)) {
    const code = signInCodeIn(await app.readEmail(entry.key, email.id));
    if (code) return { code, date: email.date, account: entry.account, from: senderOf(email) };
  }
  return null;
}

/** The newest code in any of the mailboxes from the last `wait.minutes`, trying `wait.tries` times. */
async function newestCode(mailboxes, matches, wait) {
  const since = new Date(Date.now() - wait.minutes * 60 * 1000);
  for (let attempt = 0; attempt < wait.tries; attempt += 1) {
    if (attempt) await pause(wait.everyMs);
    const codes = await Promise.all(mailboxes.map((entry) => codeIn(entry, since, matches).catch(() => null)));
    const found = codes.filter(Boolean).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (found) return found;
  }
  return null;
}

/** The chat's line for a code typed in: where it came from and where it went, never the code. */
const typedIn = (detail) => eventMessage("Typed in the sign-in code from your email", detail);

/** Cards the person answers before the bot goes on, which a sign-in can be waiting for. */
const WAITING = new Set(["handover", "secure_form", "choice", "connect"]);

/**
 * start_sign_in and fill_sign_in_code: the start of a sign-in the person asked for (the site's front page, or an address
 * they wrote), and a sign-in code the site emailed the person, typed into the page in front on the bot's computer.
 * Offered only on the person's own turn in their own chat with their bot (botTools.js, D-77). Reads only the person's
 * own connected mailboxes (never a home's), as read_email does, so a mail action switched off in Connect apps stays off.
 * @param {object} shared
 * @param {import("./types.js").AppFor} shared.appFor
 * @param {import("@local/computer/server/types").Computer} shared.computer
 * @param {string} shared.computerId
 * @param {string} shared.conversationId
 * @param {import("./types.js").TurnRepository} shared.turns records.turns, for what the person asked
 * @param {import("./types.js").CallOptions} shared.call
 * @param {import("./types.js").InTime} shared.inTime
 * @param {object[]} shared.before
 * @param {object[]} shared.after
 * @param {(card: { question: string, subline: string, action: { id: string, args: object } }) => void} shared.askFirst
 *   Posts an approval card under the reply.
 * @param {{ name: string, caption: string }[]} shared.screenshots
 * @param {(text: string) => string} shared.untrusted
 * @param {typeof CODE_MAIL} [shared.wait]
 */
export function buildSignInCodeTools({
  appFor,
  computer,
  computerId,
  conversationId,
  turns,
  call,
  inTime,
  before,
  after,
  askFirst,
  screenshots,
  untrusted,
  wait = CODE_MAIL
}) {
  // Whether this turn worked on a sign-in, so its chain ends with the turn (finished).
  let signingIn = false;

  /** What the person wrote in their last few messages in this chat. */
  async function personSaid() {
    const said = await turns.messages(conversationId, { role: "user", kind: "text" }, { newestFirst: true, limit: 10 }, call);
    return said.map((message) => message.body.text || "").join("\n");
  }

  async function startSignIn({ address: given }) {
    const address = /^https?:\/\//iu.test(given) ? given : `https://${given}`;
    const site = siteOf(address);
    if (!site) return { error: "That isn't a website's address." };
    const said = await personSaid();
    if (!namesSite(said, site)) {
      return {
        error:
          `The person hasn't asked for a sign-in to ${site} in this chat. If it's still what they want, open it with open_web_page: ` +
          "a code it emails then needs their OK on a card first."
      };
    }
    // The sign-in starts on the site's own front page, or at an address the person wrote themselves.
    const written = address.replace(/^https?:\/\//iu, "").replace(/\/$/u, "").toLowerCase();
    if (!isFrontPage(address, site) && !said.toLowerCase().includes(written)) {
      return {
        error:
          `Start the sign-in from the site's front page, https://${site}/, and follow its own sign-in link from there with ` +
          "use_web_page; only an address the person wrote can start it anywhere else."
      };
    }
    signingIn = true;
    try {
      const page = await inTime(computer.startSignIn(String(computerId), address), "Opening the sign-in");
      screenshots.push({ name: page.screenshot, caption: page.title || page.url });
      return {
        url: page.url,
        title: page.title,
        text: untrusted(page.text),
        ...(page.covering ? { covered: untrusted(page.covering) } : {}),
        note:
          "Carry on with the sign-in on this page with use_web_page. A code the site emails goes into the pages it leads to " +
          "with fill_sign_in_code, without asking them; opening an address yourself ends that."
      };
    } catch (error) {
      return { error: `Couldn't open that page: ${error.message}` };
    }
  }

  async function fillSignInCode({ site }) {
    signingIn = true;
    const domain = domainOf(site);
    // Only for the sign-in at hand: the page in front on the bot's computer has to be on that site. The mail
    // read and the page typed into are the site the page is registered as, not the name the bot gives, so a
    // page that moves on while the code comes gets it only if it's still on that site.
    const page = (await computer.signInPage(String(computerId)).catch(() => null)) || { url: "", inChain: false };
    const pageSite = siteOf(page.url);
    if (!pageSite || baseDomain(domain) !== pageSite) {
      return { error: `Your browser isn't on ${domain}. Open its page asking for the code first, then call this again.` };
    }
    if (after.some((message) => message.body?.action?.id === "fill_sign_in_code")) {
      return { status: "waiting_for_approval", note: "The card asking them is already there; stop here." };
    }
    const mailboxes = await ownMailboxes(appFor("read_email"));
    if (!mailboxes.length) {
      return {
        status: "no inbox to check",
        note: "None of the person's own mailboxes can be read. Use ask_for_login with kind code, so they type it into the secure form."
      };
    }
    const found = await newestCode(mailboxes, (email) => fromSite(email, pageSite), wait);
    if (!found) {
      return {
        status: "no code found",
        note:
          `No email with a code from ${domain} came in the last ${wait.minutes} minutes to ` +
          `${mailboxes.map((entry) => entry.account).join("; ")}. If the site sends it by text or to another address, ` +
          "use ask_for_login with kind code; don't search their mail for it."
      };
    }
    if (!page.inChain || siteOf(page.startedFrom) !== pageSite) {
      // Not a page a sign-in to this site led to: they say yes first, seeing exactly where it would go and from whom.
      askFirst({
        question: `Shall I type the sign-in code from ${found.from} into this page?`,
        subline: page.url,
        action: { id: "fill_sign_in_code", args: { url: page.url, site: pageSite, from: found.from } }
      });
      return {
        status: "waiting_for_approval",
        note:
          "Nothing has been typed: this page wasn't reached from a sign-in they asked you to start, so they have a card " +
          "showing the page's address and the sender, to say yes first. Tell them in a line that it's waiting for their OK; then stop."
      };
    }
    let result;
    try {
      result = await inTime(computer.fill(String(computerId), { site: pageSite, code: found.code, inChain: true }), "Typing in the code");
    } catch (error) {
      return { error: `The code couldn't be typed in: ${error.message}` };
    }
    if (result.outsideChain) {
      return { status: "page moved on", note: "The page moved on while the code came, and nothing was typed. Look at the page again." };
    }
    if (!result.filled.includes("code")) {
      return { status: "no code field", note: "The page has no field for a code right now. Look at the page again." };
    }
    // The event line says where the code came from and went, never the code itself: the bot never sees security codes.
    const { result: _none, ...line } = typedIn(
      `Typed in the sign-in code ${pageSite} emailed to ${found.account}, without showing it, into ${result.url}, ` +
        `where the sign-in you asked for led from ${page.startedFrom}.`
    );
    before.push(line);
    return {
      status: "filled",
      from: found.account,
      note: "The code is typed in; you never see it. Press the site's button to go on yourself, then check it worked. Never repeat or guess the code."
    };
  }

  /**
   * The turn is over. When it worked on a sign-in and isn't waiting on the person for anything (a card to answer, a
   * secure form, the screen handed over), that sign-in has finished, and so has its chain (D-77).
   */
  async function finished() {
    if (!signingIn || after.some((message) => WAITING.has(message.kind))) return;
    await computer.endSignIn(String(computerId)).catch((error) => console.warn("Ending a sign-in's chain failed; it ends within 10 minutes.", error));
  }

  return {
    tools: {
      startSignIn: createTool(
        Object.freeze({
          id: "start_sign_in",
          description:
            "Open a site the person asked you to sign in to, at its front page or an address they gave you, instead of " +
            "open_web_page; then follow its own sign-in link with use_web_page. A code the site then emails them goes into the " +
            "pages that sign-in leads to (its redirects, forms, buttons and popups) without asking them. Only for a site they named.",
          inputSchema: z.object({
            address: z.string().min(3).max(2000).describe("The site's front page, such as https://www.example.com/, or the address they gave")
          }),
          execute: (input, options) => startSignIn(input, options)
        })
      ),
      fillSignInCode: createTool(
        Object.freeze({
          id: "fill_sign_in_code",
          description:
            "When the site open in your browser has emailed a sign-in or verification code, Mercbot finds it in the person's own " +
            "connected inbox and types it into the page; you never see it. Ask the site to send the code to their email first. " +
            "Waits up to a minute for it to arrive. On a page the sign-in you started didn't lead to, it asks them first.",
          inputSchema: z.object({ site: z.string().min(3).max(200).describe("The site whose page is asking for the code, e.g. example.com") }),
          execute: (input, options) => fillSignInCode(input, options)
        })
      )
    },
    finished
  };
}

/**
 * The person said yes on the card to a code going into a page outside a sign-in's chain (D-77): the newest code from
 * the sender the card named is read again from their own inboxes and typed into that page, only while the page in
 * front is still at the card's address.
 */
export const SIGN_IN_CODE_ACTIONS = {
  fill_sign_in_code: {
    reversible: () => false,
    describe: ({ url, from }) => `type the sign-in code from ${from} into ${url}`,
    question: ({ from }) => `Shall I type the sign-in code from ${from} into this page?`,
    async run({ integrations, reach, call, computer, conversationId, computerId = conversationId }, { url, site, from }) {
      const { skip = {} } = await integrations.toolSwitches(reach, call);
      const mailboxes = await ownMailboxes({ integrations, reach, call, skip: skip.read_email || [] });
      const found = mailboxes.length ? await newestCode(mailboxes, (email) => senderOf(email) === from, { ...CODE_MAIL, tries: 1 }) : null;
      const couldnt = (why) => eventMessage("Couldn't type in the sign-in code", why);
      if (!found) return couldnt(`No email with a code from ${from} came to their own inboxes in the last ${CODE_MAIL.minutes} minutes.`);
      let result;
      try {
        result = await computer.fill(String(computerId), { site, code: found.code, onlyAt: url });
      } catch (error) {
        return couldnt(`${error.message} It was for ${url}.`);
      }
      if (!result.filled.includes("code")) return couldnt(`The page ${url} has no field for a code right now.`);
      return typedIn(`Typed in the sign-in code ${from} emailed to ${found.account}, without showing it, into ${url}, as they said yes.`);
    }
  }
};
