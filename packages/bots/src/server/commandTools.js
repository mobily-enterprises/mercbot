import { createTool, textPart } from "@jskit-ai/agent/server";
import { z } from "zod";

/** A command result that was cut says how to read the rest (D-48). */
function withWholeOutput(result, run) {
  return result?.truncated && run
    ? {
        ...result,
        wholeOutput:
          `The output was cut. All of it is in /runs/${run}.log on your command line (grep, tail and sed work on it), or read it in ` +
          `parts with read_command_output, run ${run}.`
      }
    : result;
}

/**
 * The command line (D-47): a bash script in the gVisor toolbox, on this conversation's folders,
 * without network. A reply's commands leave one line in the chat, opening to each script and
 * its output.
 * @param {object} shared
 * @param {import("@local/files/server/types").Files} shared.files
 * @param {import("./types.js").Place} shared.place
 * @param {string} shared.homeId
 * @param {string} shared.botId
 * @param {string} shared.conversationId
 * @param {string} shared.userId
 * @param {boolean} shared.personal
 * @param {boolean} shared.viaBot
 * @param {object[]} shared.before
 * @param {string[]} shared.attempted
 * @param {Set<string>} shared.saved
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} shared.call the turn's call options
 */
export function buildCommandTools({
  files,
  place,
  homeId,
  botId,
  conversationId,
  userId,
  personal,
  viaBot,
  before,
  attempted,
  saved,
  call
}) {
  const tools = {};
  const failed = (error) => ({ error: error.message });
  const recordCommand = (run, script, why) => {
    const command = {
      why,
      script: script.slice(0, 4000),
      output: String(run.output || "").slice(-3000),
      exitCode: run.exitCode ?? null,
      run: run.run,
      running: run.status === "running"
    };
    const last = before.at(-1);
    const commands =
      last?.kind === "event" && last.body.icon === "command" && last.body.commands ? [...last.body.commands, command] : [command];
    const text = command.running
      ? `Working on it in the background: ${why}`
      : commands.length > 1
        ? `Ran ${commands.length} commands: ${why}`
        : `Ran a command: ${why}`;
    const line = { kind: "event", role: "system", body: { text, icon: "command", commands } };
    if (commands.length > 1) before[before.length - 1] = line;
    else before.push(line);
  };
  async function runCommand({ why, script, seconds }) {
    attempted.push("run_command");
    try {
      // Asked by another bot, not the person (D-46): the person's own files and the home's
      // can only be read, so nothing a bot was talked into can change them.
      const run = await files.shell.start({
        place,
        workspaceId: homeId,
        botId,
        conversationId,
        userId: personal ? userId : null,
        why,
        script,
        readOnly: viaBot ? ["mine", "shared"] : [],
        ...(seconds ? { maxSeconds: seconds } : {})
      });
      if (run.status === "unavailable" || run.status === "busy") return { error: run.error };
      recordCommand(run, script, why);
      for (const changed of run.changed || []) saved.add(changed);
      return withWholeOutput(run, run.run);
    } catch (error) {
      return failed(error);
    }
  }
  tools.runCommand = createTool(
    Object.freeze({
      id: "run_command",
      description:
        "Run a bash script on your own Linux computer's command line, for work on files: video and audio (ffmpeg), pictures (ImageMagick), reading scanned pages (tesseract), PDFs (qpdf, pdftotext, gs), data (Python with pandas, numpy, matplotlib, openpyxl; sqlite3, jq), documents (pandoc, python-docx, python-pptx), archives, and ordinary Unix tools with pipes and loops. It sees only your folders (" +
        (personal ? "/files/mine, " : "") +
        "/files/bot, /files/shared) and a scratch /tmp emptied after each run, and has no internet and nothing to install. Check what you made (ls, ffprobe, head) and fix errors by running again. A command still running after 2 minutes carries on in the background and you're woken here when it ends.",
      inputSchema: z.object({
        why: z
          .string()
          .min(3)
          .max(160)
          .describe("What it does, in a few plain words for the person, e.g. Making a GIF of the first 5 seconds"),
        script: z.string().min(1).max(20000).describe("The bash script"),
        seconds: z.number().int().min(5).max(1800).optional().describe("Most it may take in total; default 30 minutes")
      }),
      execute: (input, options) => runCommand(input, options)
    })
  );
  async function checkCommand({ run }) {
    return withWholeOutput(await files.shell.check(run, call).catch(failed), run);
  }
  tools.checkCommand = createTool(
    Object.freeze({
      id: "check_command",
      description: "See how a command that went on in the background is doing: its status, output so far and the files it changed.",
      inputSchema: z.object({ run: z.string().min(1).max(30) }),
      execute: (input, options) => checkCommand(input, options)
    })
  );
  /** The whole of a command's output when its result was cut (D-48), from this conversation only. */
  async function readCommandOutput({ run, from_line: fromLine = 1 }) {
    if (!/^\d+$/u.test(run)) return { error: "Give the run number from run_command or check_command." };
    const found = await files.commandOutput(run, conversationId, call);
    if (!found) return { error: "There's no such command in this conversation." };
    if (found.status === "running") return { error: "It's still running; check_command shows its output so far." };
    const whole = await files.shell.wholeOutputOf({ id: found.id, conversation_id: found.conversationId });
    if (whole === null) {
      return {
        note: "Its output wasn't cut, so the result already showed all of it (or a week has passed and it's gone).",
        output: found.output
      };
    }
    const { lines, shown } = textPart(whole, fromLine);
    return { run, lines, output: shown };
  }
  tools.readCommandOutput = createTool(
    Object.freeze({
      id: "read_command_output",
      description:
        "Read the whole output of a command whose result was cut (it says so), in parts: give the run number, and from_line to carry on where the last part stopped. On the command line the same output is the file /runs/<run>.log, for grep, tail and the like.",
      inputSchema: z.object({ run: z.string().min(1).max(30), from_line: z.number().int().min(1).optional() }),
      execute: (input, options) => readCommandOutput(input, options)
    })
  );
  return tools;
}
