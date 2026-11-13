import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import { APPROVAL_OPTIONS } from "./botActions.js";
import { savedLogin } from "./vaultLogins.js";

/**
 * Web work on the bot's own computer: one screenshot per page it worked on, signing in
 * without secrets passing through the bot, and handing the screen to the person.
 * @param {object} shared
 * @param {import("./types.js").TurnRepository} shared.turns records.turns
 * @param {{ savedLogins: (options: object) => Promise<object[]> }} shared.account the account capability (vault logins)
 * @param {import("./types.js").CallOptions} shared.call the turn's call options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} shared.env
 * @param {import("./types.js").Approvals} shared.approvals
 * @param {import("@local/computer/server/types").Computer} shared.computer
 * @param {string} shared.computerId
 * @param {string} shared.conversationId
 * @param {boolean} shared.personal
 * @param {string | null} shared.workingRequestId
 * @param {object[]} shared.after
 * @param {{ name: string, caption: string }[]} shared.screenshots
 * @param {(text: string) => string} shared.untrusted
 * @param {import("./types.js").InTime} shared.inTime
 */
export function buildWebTools({
  turns,
  account,
  call,
  env,
  approvals,
  computer,
  computerId,
  conversationId,
  personal,
  workingRequestId,
  after,
  screenshots,
  untrusted,
  inTime
}) {
  const tools = {};
  /**
   * A dialog or overlay in front of the page (a cookie banner, a sign-in prompt): the person sees
   * it in the screenshots even though the page's text reads as if it weren't there.
   */
  const coveredBy = (page) =>
    page.covering
      ? {
          covered: untrusted(page.covering),
          note:
            "Something is covering the page on screen, so the person can't see what's behind it. Deal with it first (use_web_page, e.g. reject or close it, never accepting anything on their behalf beyond cookies being refused or a box closed), then read the page again before saying what's there."
        }
      : {};

  /** The tool only requests a hand-over; the service records it together with its card (D-14). */
  async function handOver(given) {
    if (after.some((message) => message.kind === "handover")) return;
    // The task shows in the sidebar and on the card, so a password in it is blanked.
    const task = String(given)
      .replace(/\b(password|passcode|pin|pw)\b(\s*(is|:|=)?\s*)\S+/giu, "$1$2•••")
      .replace(/(\S+)\s*\/\s*\S+(?=\s*\)?\s*$)/u, "$1");
    const shot = await inTime(computer.screenshot(String(computerId)), "The screenshot").catch(() => null);
    after.push({ kind: "handover", role: "bot", body: { task, status: "pending", screenshot: shot } });
  }

  async function openWebPage({ url }) {
    try {
      const page = await inTime(computer.browse(String(computerId), url), "Opening the page");
      screenshots.push({ name: page.screenshot, caption: page.title || page.url });
      return { url: page.url, title: page.title, text: untrusted(page.text), ...coveredBy(page) };
    } catch (error) {
      return { error: `Couldn't open that page: ${error.message}` };
    }
  }
  tools.openWebPage = createTool(
    Object.freeze({
      id: "open_web_page",
      description: "Open a web page in your own browser and read its text. Use it to look things up on the web.",
      inputSchema: z.object({ url: z.string().min(3).max(2000).describe("The address to open") }),
      execute: (input, options) => openWebPage(input, options)
    })
  );
  async function useWebPage({ instruction, final: flagged }) {
    // Signing in is never a step to approve.
    const final = flagged && !/\b(log ?in|sign ?in|login|signin)\b/iu.test(instruction);
    // A password is only typed when the person gave it in this chat, never one read on a page;
    // otherwise the vault or the secure form does it.
    const typed = /\btype\s+["“']?(.+?)["”']?\s+(?:into|in)\b[^.]*\bpass(?:word|code)\b/iu.exec(instruction);
    if (typed) {
      const given = await turns.messages(conversationId, { role: "user", kind: "text" }, { newestFirst: true, limit: 50 }, call)
        .then((messages) => messages.some((message) => String(message.body.text || "").includes(typed[1])))
        .catch(() => false);
      if (!given) {
        return {
          error: "Only type a password the person gave you in this chat. Use sign_in_with_saved_login, then ask_for_login, instead."
        };
      }
    }
    if (final && after.some((message) => message.kind === "choice" && message.body.purpose === "approval")) {
      return { status: "waiting_for_approval", note: "One step is already waiting for their OK on the card; stop here." };
    }
    if (final) {
      const decision = await approvals.decide(`on a web page: ${instruction}`, {}, call);
      if (decision === "ask") {
        const shot = await inTime(computer.screenshot(String(computerId)), "The screenshot").catch(() => null);
        if (shot) screenshots.push({ name: shot, caption: "Ready to go ahead" });
        after.push({
          kind: "choice",
          role: "bot",
          body: {
            purpose: "approval",
            question: `Shall I go ahead and ${instruction.replace(/^\w/u, (letter) => letter.toLowerCase())}?`,
            options: APPROVAL_OPTIONS,
            multi: false,
            chosen: null,
            action: { id: "use_web_page", args: { instruction } },
            ...(workingRequestId ? { requestId: String(workingRequestId) } : {})
          }
        });
        return {
          status: "waiting_for_approval",
          note: "Nothing has been submitted. Summarise exactly what's filled in and say it's waiting for their OK on the card below."
        };
      }
    }
    try {
      const result = await inTime(computer.act(String(computerId), instruction), "That step");
      screenshots.push({ name: result.screenshot, caption: result.title || result.url });
      return { success: result.success, detail: result.message, url: result.url, title: result.title, ...coveredBy(result) };
    } catch (error) {
      return { error: `That didn't work: ${error.message}` };
    }
  }
  tools.useWebPage = createTool(
    Object.freeze({
      id: "use_web_page",
      description:
        "Do exactly one thing on the page that's open in your browser: one click, typing into one field, pressing Enter or choosing one option. Describe it in plain words. A form takes one call per field. Set final to true only if this step sends, buys, books, posts, deletes or saves a change for the person; signing in, searching and moving between pages are never final.",
      inputSchema: z.object({
        instruction: z.string().min(3).max(500),
        final: z
          .boolean()
          .describe(
            "True only when the step sends, buys, books, posts, deletes or saves a change. Signing in, searching, filtering, opening links and reading are never final."
          )
      }),
      execute: (input, options) => useWebPage(input, options)
    })
  );
  if (personal) {
    /**
     * Signing in without secrets passing through the bot: a saved vault
     * login first, then the person's secure form; the values are typed into the page by Mercbot.
     */
    async function signInWithSavedLogin({ site }) {
      const login = await savedLogin(account, env, site, call);
      if (!login) return { status: "none saved", note: "There's no saved login for this site. Use ask_for_login next." };
      try {
        const result = await inTime(
          computer.fill(String(computerId), { site, username: login.username, password: login.password }),
          "Filling in the login"
        );
        screenshots.push({ name: result.screenshot, caption: "Login filled in" });
        return {
          status: result.filled.length ? "filled" : "no sign-in form found",
          filled: result.filled,
          username: login.username,
          vaultItem: login.label,
          note: "Now press the site's sign-in button yourself; don't ask the person first."
        };
      } catch (error) {
        return { error: error.message };
      }
    }
    tools.signInWithSavedLogin = createTool(
      Object.freeze({
        id: "sign_in_with_saved_login",
        description:
          "Fill in a login the person saved in their vault for the site open in your browser. You never see the password. " +
          "Afterwards, look at the page and press the site's sign-in button yourself.",
        inputSchema: z.object({ site: z.string().min(3).max(200).describe("The site, e.g. example.com") }),
        execute: (input, options) => signInWithSavedLogin(input, options)
      })
    );
  }
  async function askForLogin({ site, kind }) {
    if (after.some((message) => message.kind === "secure_form")) return { status: "already asked" };
    /** The sign-in page's address, so it can be reopened if the computer moves on or restarts. */
    const url = (await computer.status(String(computerId)).catch(() => null))?.url || "";
    after.push({
      kind: "secure_form",
      role: "bot",
      body: { site: site.trim(), form: kind, status: "pending", ...(/^https?:/u.test(url) ? { url } : {}) }
    });
    return { status: "waiting_for_user", note: "Say the secure form is below and that you never see what they type; then stop." };
  }
  tools.askForLogin = createTool(
    Object.freeze({
      id: "ask_for_login",
      description:
        "Post a secure form so the person can enter a login (or a one-time code) for the site open in your browser. Only private values go through it; you never see them, and Mercbot types them into the page. Open the sign-in page first. Then stop and wait; closing the form means no.",
      inputSchema: z.object({
        site: z.string().min(3).max(200).describe("The site, e.g. example.com"),
        kind: z.enum(["login", "code"]).describe("A username and password, or a one-time code")
      }),
      execute: (input, options) => askForLogin(input, options)
    })
  );
  async function askForHelp({ task }) {
    await handOver(task);
    return { status: "waiting_for_user", note: "Say the page is open and the screen is theirs now, then stop." };
  }
  tools.askForHelp = createTool(
    Object.freeze({
      id: "ask_for_help",
      description:
        "Hand your screen to the person when only they can do a step, such as signing in to a website (never ask for passwords in the chat). This posts the card that is their only way onto your screen, so call it every time they need the screen, even if you did before or the page is already open. Open the right page first, then stop and wait.",
      inputSchema: z.object({ task: z.string().min(3).max(160).describe("What they should do, e.g. Sign in to example.com") }),
      execute: (input, options) => askForHelp(input, options)
    })
  );
  return tools;
}
