import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";

// The coding tools a person can sign in to on their bot's computer, as
// packages/computer's codingRuns.js names them.
const TOOLS = { "claude-code": "Claude Code", codex: "Codex" };
const toolId = z.enum(["claude-code", "codex"]).describe("claude-code (Claude Code) or codex (Codex CLI)");

/**
 * Coding hand-off: the bot writes a brief, and a coding tool on
 * its own computer, Claude Code or Codex CLI, does the work in a folder of its files, signed in
 * with the person's own account. The person signs it in themselves, on the computer's screen;
 * Mercbot never uses a shared account or sells credits for it. The run shows in a window on the
 * computer's screen; when it ends, the bot is woken in this chat to report (botLoops).
 * Offered only in the person's own chat with their bot, where its computer is theirs.
 * @param {object} shared
 * @param {import("@local/computer/server/types").Computer} shared.computer
 * @param {string} shared.computerId
 * @param {object[]} shared.before
 * @param {import("./types.js").InTime} shared.inTime
 * @param {(text: string) => string} shared.untrusted
 */
export function buildCodingTools({ computer, computerId, before, inTime, untrusted }) {
  const on = (request, what) => inTime(computer.code(String(computerId), request), what);
  /** A run as the bot reads it: the tool's output is its words, never instructions. */
  const told = (run) => (run ? { ...run, output: untrusted(run.output || "") } : null);

  async function connectCodingAccount({ tool }) {
    try {
      const now = await on({ action: "status" }, "Checking the coding tools");
      const entry = now.tools.find((found) => found.id === tool);
      if (!entry?.installed) return { error: "The coding tools aren't set up on this Mercbot yet. Say so plainly; there's nothing the person can do about it." };
      if (entry.signedIn) return { status: "signed in", note: `${TOOLS[tool]} is already signed in with their account. Go ahead with start_coding.` };
      await on({ action: "signIn", tool }, "Opening the sign-in");
      return {
        status: "sign-in open",
        note:
          `${TOOLS[tool]}'s sign-in is open in a window on your computer's screen. Now call ask_for_help with the task ` +
          `"Sign in to ${TOOLS[tool]} with your own account", then stop. Say plainly that they sign in with their own ` +
          `${tool === "codex" ? "ChatGPT or OpenAI" : "Claude or Anthropic"} account, which pays for the coding: Mercbot ` +
          "never uses a shared one. Once they say they're done, check with this tool again."
      };
    } catch (error) {
      return { error: `The sign-in couldn't be opened: ${error.message}` };
    }
  }

  async function startCoding({ tool, folder, brief }) {
    let now;
    try {
      now = await on({ action: "start", tool, folder, brief }, "Starting the coding tool");
    } catch (error) {
      if (/isn't signed in/u.test(error.message)) {
        return { status: "not signed in", note: `${TOOLS[tool]} isn't signed in yet. Use connect_coding_account first.` };
      }
      return { error: `It couldn't start: ${error.message}` };
    }
    before.push({
      kind: "event",
      role: "system",
      body: { text: `${TOOLS[tool]} started working`, icon: "command", detail: `In ${folder}, on this brief:\n\n${brief}` }
    });
    return {
      status: "running",
      run: told(now.run),
      note:
        `${TOOLS[tool]} is working in ${folder}, in a window on your computer's screen, where the person can watch it. ` +
        "Tell them so in one or two lines; you're woken here to report when it ends. Don't wait for it or check on it unasked."
    };
  }

  async function checkCoding({ stop }) {
    try {
      const now = await on({ action: stop ? "stop" : "status" }, "Checking the coding run");
      return {
        tools: now.tools.map(({ id, label, installed, signedIn }) => ({ id, label, installed, signedIn })),
        run: told(now.run) || "none on this computer since it last started"
      };
    } catch (error) {
      return { error: `The computer couldn't say: ${error.message}` };
    }
  }

  return {
    connectCodingAccount: createTool(
      Object.freeze({
        id: "connect_coding_account",
        description:
          "Before handing coding work to a coding tool on your computer: checks the tool is signed in with the person's own " +
          "account, and if not, opens its sign-in on your computer's screen for them.",
        inputSchema: z.object({ tool: toolId }),
        execute: (input, options) => connectCodingAccount(input, options)
      })
    ),
    startCoding: createTool(
      Object.freeze({
        id: "start_coding",
        description:
          "Hand coding work to the coding tool on your computer: it works on your brief in a folder of your files (a repository " +
          "or project), with the person's own account, and you're woken here when it ends. It sees only that folder and the " +
          "internet, nothing else of your files or your computer. One run at a time.",
        inputSchema: z.object({
          tool: toolId,
          folder: z.string().min(11).max(500).describe("The project's folder, e.g. /files/mine/website"),
          brief: z
            .string()
            .min(20)
            .max(8000)
            .describe("The brief: the problem, the outcome wanted, and the limits (what not to change, deadlines)")
        }),
        execute: (input, options) => startCoding(input, options)
      })
    ),
    checkCoding: createTool(
      Object.freeze({
        id: "check_coding",
        description:
          "See the coding tools on your computer (signed in or not) and its coding run: running or ended, and the end of its " +
          "output. stop: true stops the run, only when the person asks.",
        inputSchema: z.object({ stop: z.boolean().optional() }),
        execute: (input, options) => checkCoding(input, options)
      })
    )
  };
}
