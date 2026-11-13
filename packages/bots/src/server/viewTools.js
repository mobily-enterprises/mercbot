import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import { ICONS } from "@local/apps/shared";

/**
 * A definition as a tool's input: models often send the whole object as a JSON string, and refusing
 * that left one Builder retrying 81 times, never told what was wrong. So both forms are taken.
 */
export const definitionInput = (described) =>
  z.union([z.object({}).passthrough(), z.string()]).describe(described);

/** The definition as an object; null when it's a string that isn't JSON for one. */
export function definitionFrom(given) {
  if (typeof given !== "string") return given;
  try {
    const parsed = JSON.parse(given);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const NOT_JSON = { status: "not saved", errors: [{ path: "definition", message: "This isn't a JSON object. Send the definition as an object." }] };

/**
 * The views tools every bot gets (D-55): a view is live figures from the home's tables, saved at
 * once, which everyone in the home sees (D-66). No tool restores or retires one; people do that from its card.
 * @param {object} turn
 * @param {import("@local/apps/server/types").Views} turn.views
 * @param {import("./types.js").CallOptions} turn.call the turn's call options: the views of its home
 * @param {string} turn.botId
 * @param {string | null} turn.userId
 * @param {boolean} turn.isBuilder
 * @param {() => Promise<object>} turn.ctx who the bot is, for the data gate
 * @param {(error: unknown) => object} turn.failed a tool's answer to an error
 * @param {object[]} turn.after the messages the reply adds after its text
 */
export function buildViewTools({ views, call, botId, userId, isBuilder, ctx, failed, after }) {
  async function viewSave(input) {
    try {
      const definition = definitionFrom(input.definition);
      if (!definition) return NOT_JSON;
      const saved = await views.save(await ctx(), { ...input, definition }, { userId, botId, isBuilder });
      if (saved.errors.length) return { status: "not saved", errors: saved.errors.slice(0, 30) };
      const { key, title, summary, version } = saved.view;
      // One card per reply, however many times the view was saved in it.
      after.splice(0, after.length, ...after.filter((message) => !(message.kind === "view" && message.body.path === key)));
      after.push({ kind: "view", role: "bot", body: { path: key, title, summary } });
      if (saved.problems.length) {
        return {
          status: "saved, but some of its data doesn't load",
          view: key,
          problems: saved.problems,
          note: "Fix these and save this view again before telling the person it's ready."
        };
      }
      return {
        status: "saved",
        view: key,
        version,
        checked: "All its data loads.",
        note: "The person has a card showing it live, and everyone in the home can open it. Say in one line what it shows.",
        ...(saved.copies.length ? { copies: `${saved.copies.join(", ")} keep their own copy of this view; tell the person they'll be asked there whether to update.` } : {})
      };
    } catch (error) {
      return failed(error);
    }
  }
  async function viewList() {
    try {
      return { views: await views.list(call) };
    } catch (error) {
      return failed(error);
    }
  }
  async function viewGet({ view }) {
    try {
      return await views.get(view, call);
    } catch (error) {
      return failed(error);
    }
  }
  return {
    viewSave: createTool(
      Object.freeze({
        id: "view_save",
        description:
          "Make a view, or change one (give its key in view): live figures from the home's tables, always up to date, that opens at once with no publishing. Read the Views skill first. If it can't be saved, the errors say where and why.",
        inputSchema: z.object({
          view: z.string().max(64).optional().describe("The view's key, when changing one you have"),
          title: z.string().min(2).max(80),
          summary: z.string().max(300).describe("One line on what it shows, for its card"),
          icon: z.enum(ICONS).optional(),
          definition: definitionInput("An object: data (named queries), content (the parts to show), and optionally params, state and style")
        }),
        execute: (input, options) => viewSave(input, options)
      })
    ),
    viewList: createTool(
      Object.freeze({
        id: "view_list",
        description: "List the home's views: key, title, summary and parameters.",
        inputSchema: z.object({}),
        execute: (input, options) => viewList(input, options)
      })
    ),
    viewGet: createTool(
      Object.freeze({
        id: "view_get",
        description: "Read one view's definition, before changing it.",
        inputSchema: z.object({ view: z.string().min(1).max(64) }),
        execute: (input, options) => viewGet(input, options)
      })
    )
  };
}
