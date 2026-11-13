import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import { describeRun, nextRunAt, scheduleProblem } from "./routineSchedule.js";

function cleanRoutine(input) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value ?? "").trim()]));
}

function whenItRuns(routine) {
  if (!routine.cron) return {};
  return {
    schedule: routine.schedule,
    timezone: routine.timezone,
    nextRun: describeRun(nextRunAt(routine.cron, routine.timezone), routine.timezone)
  };
}

/**
 * Routines: setting one up and changing one. Each change starts with a short
 * acknowledgement, before its event line, and goes through attempt() like every write.
 * @param {object} shared
 * @param {import("./types.js").WorkRepository} shared.work records.work
 * @param {import("./types.js").CallOptions} shared.call the turn's call options
 * @param {string} shared.conversationId
 * @param {import("./types.js").AttemptAction} shared.attempt
 * @param {(text: string) => void} shared.acknowledge
 */
export function buildRoutineTools({ work, call, conversationId, attempt, acknowledge }) {
  async function createRoutine({ acknowledgement, once, paused, ...input }) {
    const args = { ...cleanRoutine(input), ...(once ? { once: "true" } : {}), ...(paused ? { paused: "true" } : {}) };
    const problem = scheduleProblem(args.cron, args.timezone);
    if (problem) return { error: problem };
    if (await work.routineNamed(conversationId, args.name, call)) {
      return { error: `There's already a routine called "${args.name}". Use update_routine to change it.` };
    }
    acknowledge(acknowledgement);
    return { ...await attempt("create_routine", args), ...whenItRuns(args) };
  }
  async function updateRoutine({ acknowledgement, ...input }) {
    const args = cleanRoutine(input);
    const routine = await work.routineNamed(conversationId, args.routine, call);
    if (!routine) return { error: `There's no routine called "${args.routine}".` };
    const merged = { ...routine, ...Object.fromEntries(Object.entries(args).filter(([, value]) => value)) };
    if (args.cron || args.timezone) {
      const problem = scheduleProblem(merged.cron, merged.timezone);
      if (problem) return { error: problem };
    }
    acknowledge(acknowledgement);
    return { ...await attempt("update_routine", args), ...whenItRuns(merged) };
  }
  return {
    createRoutine: createTool(
      Object.freeze({
        id: "create_routine",
        description:
          "Set up a recurring task you will run on a schedule, such as a weekly reminder or a daily summary. Only call it once per request.",
        inputSchema: z.object({
          acknowledgement: z
            .string()
            .min(1)
            .max(200)
            .describe("One short sentence shown to the person before you do it, e.g. Sure, I'll set that up."),
          name: z.string().min(1).max(120).describe("Short name for the routine"),
          schedule: z
            .string()
            .min(1)
            .max(120)
            .describe("When it runs, in plain words with the time zone, e.g. Every Monday around 9:00 AM (Europe/London)"),
          cron: z
            .string()
            .min(9)
            .max(120)
            .describe("The same schedule as a five-field cron pattern (minute hour day month weekday) in that time zone"),
          timezone: z.string().min(1).max(64).describe("IANA time zone name, e.g. Europe/London"),
          instructions: z.string().min(1).max(2000).describe("What to do on each run, written so you can follow it later on your own"),
          once: z
            .boolean()
            .optional()
            .describe(
              'True for something that happens once, such as "remind me in 5 minutes" or a one-off check: the cron names that exact ' +
                "minute, day and month, and the routine removes itself after it runs"
            ),
          paused: z.boolean().optional().describe("True to set it up without running yet, until the person says to start it")
        }),
        execute: (input, options) => createRoutine(input, options)
      })
    ),
    updateRoutine: createTool(
      Object.freeze({
        id: "update_routine",
        description:
          "Change one of your routines: rename it, reschedule it or change what it does. Leave out anything that stays the same.",
        inputSchema: z.object({
          acknowledgement: z
            .string()
            .min(1)
            .max(200)
            .describe("One short sentence shown to the person before you do it, e.g. Sure, I'll change that."),
          routine: z.string().min(1).max(120).describe("The routine's current name"),
          name: z.string().max(120).optional().describe("A new name"),
          schedule: z.string().max(120).optional().describe("New schedule in plain words with the time zone"),
          cron: z.string().max(120).optional().describe("New five-field cron pattern; required with a new schedule"),
          timezone: z.string().max(64).optional().describe("IANA time zone name, required with a new schedule"),
          instructions: z.string().max(2000).optional().describe("New instructions for each run"),
          running: z.boolean().optional().describe("True to start a paused routine, false to pause it; only when the person says so")
        }),
        execute: (input, options) => updateRoutine(input, options)
      })
    )
  };
}
