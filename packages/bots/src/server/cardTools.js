import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import { EMAIL_ADDRESS } from "./botActions.js";

/**
 * A connect card that can still be signed in from: "waiting" until the person starts
 * the sign-in from it, then "connecting" until the app is connected ("connected") and the bot carries on.
 */
export const CONNECT_WAITS = Object.freeze(["waiting", "connecting"]);

/**
 * What never goes in the home notebook (D-36): phone, card and account numbers, that is runs of
 * nine or more digits (dates aside).
 */
const hasLongNumber = (text) => [...text.matchAll(/\+?\d[\d\s().-]{7,}\d/gu)]
  .some(([found]) => !/^\d{4}-\d{2}-\d{2}/u.test(found) && found.replace(/\D/gu, "").length >= 9);

/**
 * Cards under the reply: one to connect an app a task needs, a question with a few
 * answers to tap, and the line a note for the home notebook leaves (D-36).
 * @param {object} shared
 * @param {import("@local/integrations/server/types").Integrations} shared.integrations
 * @param {import("./types.js").Reach} shared.reach
 * @param {import("./types.js").Notebook | null} shared.notebook
 * @param {object[]} shared.after
 * @param {import("./types.js").CallOptions} shared.call the turn's call options
 */
export function buildCardTools({ integrations, reach, notebook, after, call }) {
  const tools = {};
  // A task that needs an app that isn't connected: an inline card to connect it,
  // then the bot finishes the task once it's signed in, instead of refusing or using the website.
  // What the card asks the bot to say, given again if it's asked for a second time.
  let shown = null;
  async function suggestConnect({ app: wanted, task }) {
    if (shown) return { ...shown, status: "already shown" };
    const plugin = integrations.appNamed(wanted);
    if (!plugin) return { error: `${wanted} isn't one of the apps Mercbot connects to; use its website in your browser if it has one.` };
    if (await integrations.hasConnected(reach, plugin.id, call)) {
      return { error: `${plugin.name} is already connected; ${plugin.mcp ? "use it with use_connected_app" : "use its tools"}.` };
    }
    // An app Mercbot can't sign in to yet still gets its card: its button asks for it,
    // and the bot offers the website meanwhile.
    const ready = !plugin.soon && Boolean(plugin.oauth || plugin.mcp);
    after.push({
      kind: "connect",
      role: "bot",
      body: {
        app: plugin.name,
        plugin: { id: plugin.id, logo: plugin.logo, logoImage: plugin.logoImage, color: plugin.color, icon: plugin.icon },
        subtitle: `Let your bot use ${plugin.name} for you`,
        footnote: ready
          ? "Your bot always checks with you before changing anything, and you can disconnect at any time."
          : `Mercbot's connection to ${plugin.name} is on its way. Ask for it here and you'll be among the first to have it.`,
        button: ready ? "Authorize" : "Ask for it",
        // A card that can connect waits for it: once the person signs in from it, the bot finishes
        // the task by itself (connectFollowUps.js).
        ...(ready ? { status: "waiting" } : { soon: true }),
        task: task.trim()
      }
    });
    shown = ready
      ? {
          status: "card shown",
          note:
            `The connect card is below your message. In one line, say that once ${plugin.name} is connected you'll ${task.trim()} ` +
            `straight away.`
        }
      : {
          status: "card shown, not connectable yet",
          note:
            `A card for ${plugin.name} is below your message. In one line say that Mercbot's connection to ${plugin.name} is on its ` +
            `way (the card's own words), and offer to ${task.trim()} on its website in your browser meanwhile.`
        };
    return shown;
  }
  tools.suggestConnect = createTool(
    Object.freeze({
      id: "suggest_connect",
      description:
        "When a request needs an app that isn't connected (e.g. add something to their Todoist), show a card to connect it. Use it instead of refusing, and before falling back to the app's website.",
      inputSchema: z.object({
        app: z.string().min(2).max(80).describe("The app's name, e.g. Google Calendar"),
        task: z.string().min(3).max(200).describe("The task you'll finish once it's connected, in a few words")
      }),
      execute: (input, options) => suggestConnect(input, options)
    })
  );

  /**
   * A question with a few answers to tap, on the same card
   * the first conversation uses; their pick comes back as their reply.
   */
  async function askWithOptions({ question, options, multi }) {
    if (after.some((message) => message.kind === "choice")) return { status: "already asked" };
    after.push({
      kind: "choice",
      role: "bot",
      body: {
        purpose: "question",
        question: question.trim(),
        options: options.map((option) => option.trim()),
        multi: Boolean(multi),
        chosen: null
      }
    });
    return { status: "waiting_for_answer", note: "The question card is below your message; keep your message to a line and stop." };
  }
  tools.askWithOptions = createTool(
    Object.freeze({
      id: "ask_with_options",
      description:
        "Ask the person one question with two to five short answers to tap, such as which app a deck is for or which style they prefer. Then stop and wait for their pick.",
      inputSchema: z.object({
        question: z.string().min(3).max(160),
        options: z.array(z.string().min(1).max(60)).min(2).max(5),
        multi: z.boolean().optional().describe("True if they may pick several")
      }),
      execute: (input, options) => askWithOptions(input, options)
    })
  );

  // The home notebook (D-36): a mixed bot notes what it learned that helps everyone in the home,
  // never anything personal, and the person sees a line they can undo.
  if (notebook) {
    async function noteForHome({ text }) {
      if (after.some((message) => message.kind === "note")) return { status: "already noted" };
      const note = text.trim();
      if (EMAIL_ADDRESS.test(note) || hasLongNumber(note)) {
        return { error: "That has contact or card details, which never go in the notebook. Leave it out." };
      }
      const saved = await notebook.note(note);
      if (saved.error) return saved;
      after.push({ kind: "note", role: "system", body: { noteId: saved.id, text: note, home: notebook.home } });
      return { status: "noted", note: `Say in one short line that you noted it for ${notebook.home}; they can undo it.` };
    }
    tools.noteForHome = createTool(
      Object.freeze({
        id: "note_for_home",
        description:
          `Add a line to the ${notebook.home} notebook, which everyone in the home and their chats with you can read: only reusable ` +
          `know-how about the home's work and routines (how something is done, where things are, what was decided for everyone). ` +
          `Never anything personal: no health, money, passwords, contact details, private plans or anything said about someone else ` +
          `without their OK. Use it sparingly, once per reply at most.`,
        inputSchema: z.object({ text: z.string().min(8).max(500).describe("The note, written so it makes sense on its own") }),
        execute: (input, options) => noteForHome(input, options)
      })
    );
  }
  return tools;
}
