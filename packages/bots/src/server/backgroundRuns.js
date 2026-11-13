import { BotsError } from "./botsError.js";
import { isModelFailure, modelFailure } from "./modelFailures.js";
import { RUN_LEASE, RunTakenOver, jobCheckpoint, routineCheckpoint } from "./runLease.js";

/**
 * In a paused home (D-73) the bot starts nothing new and says why: to each message a
 * person sends, and once for work no one is waiting on (a routine, an Apps task, a bot's request). Nothing is deleted.
 */
export async function pausedNotice({ records, conversations }, row, text, human, call) {
  const latest = (role) => records.turns.latestMessage(row.conversation_id, { role, kind: "text" }, call);
  if (!human && (await latest("bot"))?.body?.paused) return [];
  const answers = Number((await latest("user"))?.id) || 0;
  return conversations.append(row, [{ kind: "text", role: "bot", body: { text, paused: true, answers } }], call);
}

/**
 * A bot's background runs (D-35, D-59): a scheduled routine's run and a task Apps queued,
 * each an ordinary reply (`respond`) in its chat, run as a job in the work's home. Each holds its row
 * with a run id and lease (runLease.js) while it runs, so a run whose server stopped is carried on
 * once, by the server that took it over, and only that server posts its result.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {import("./types.js").BotConversations} dependencies.conversations
 * @param {import("@local/apps/server/types").AppJobs | null} dependencies.jobs apps.jobs, where an Apps task's run is held
 * @param {(row: object, options: object) => Promise<object[]>} dependencies.respond botReplies' respond
 * @param {(conversationId: string, home: string, system: object) => Promise<{ row: object, call: object } | null>} dependencies.backgroundRow
 *   the chat a background run posts in, and its call options
 */
export function createBackgroundRuns({ records, systemContext, meter, conversations, jobs, respond, backgroundRow }) {
  /**
   * One scheduled run of a routine, already claimed by this server (D-15). Open pages hear that
   * the bot is working and when it has posted; a failed run says so and waits for the next time,
   * and the fifth failed run in a row pauses the routine instead, saying how to resume it. A run
   * this server took over from one that stopped carries on from its saved steps (D-59); one stopped
   * for its lease (`signal`) is left, unended, to the server that carries it on.
   * @param {object} routine the claimed routine
   * @param {AbortSignal | null} [signal] its lease's (keepLease)
   */
  async function runRoutine(routine, signal = null) {
    // A routine made in a shared bot's room runs there, for whoever set it up (D-36).
    const found = await backgroundRow(routine.conversationId, routine.workspaceId, systemContext("routine runner"));
    if (!found) {
      // Its conversation or bot is gone: the run ends, so no server takes it over again.
      await routineCheckpoint(records.work, routine, null)
        ?.end({ failed: true }, { context: systemContext("routine runner").forWorkspace(String(routine.workspaceId)) });
      return;
    }
    const { row, call } = found;
    await meter.track({ userId: row.user_id, botId: String(row.id), work: "background" }, () => runRoutineFor(row, routine, call, signal));
  }

  async function runRoutineFor(row, routine, call, signal) {
    const notify = (event) => conversations.tell(row, event, call);
    const held = routineCheckpoint(records.work, routine, call, signal);
    await notify({ type: "working", working: true });
    try {
      let appended;
      // Whether this server still held the run when it ended; one another server took over is left to it.
      let mine = true;
      try {
        if (held?.givenUp) throw new Error(`its server stopped ${RUN_LEASE.attempts} times while it ran`);
        appended = await respond(row, {
          timeZone: routine.timezone,
          prompt: routinePrompt(routine),
          routineRun: true,
          routine,
          checkpoint: held,
          call
        });
        // A run that posted ended with its post; one with nothing new ends here.
        if (held && !appended.length) mine = Boolean(await held.end({ failed: false }, call));
      } catch (error) {
        if (error instanceof RunTakenOver) {
          // A run stopped for its lease (keepLease said why), or one another server holds, is that server's to end.
          if (!signal?.aborted) console.warn(error.message);
          mine = false;
          appended = [];
        } else {
          console.error(`Routine ${routine.id} ("${routine.name}") failed: ${isModelFailure(error) ? modelFailure(error) : error.stack}`);
          appended = await conversations.withTransaction(call, async (txOptions) => {
            const ending = held ? await held.end({ failed: true }, txOptions) : { paused: false, messages: [] };
            mine = Boolean(ending);
            if (!ending) return [];
            return conversations.append(row, [
              ...(ending.paused
                ? []
                : [
                    {
                      kind: "text",
                      role: "bot",
                      body: {
                        text:
                          `I couldn't finish my routine "${routine.name}" this time, because something went ` +
                          `wrong on my side. I'll try again at the next scheduled time.`
                      }
                    }
                  ]),
              ...ending.messages
            ], txOptions);
          });
        }
      }
      // A one-off reminder or check ends itself after its run, with an event line.
      if (routine.once && mine) {
        await records.work.deleteRoutine(routine.id, routine.conversationId, call);
        appended.push(
          ...(await conversations.append(row, [
            {
              kind: "event",
              role: "system",
              body: {
                text: "Routine finished and removed",
                icon: "routine",
                name: routine.name,
                detail: `The one-off routine "${routine.name}" ran and was removed.`
              }
            }
          ], call))
        );
      }
      if (appended.length) await notify({ type: "messages" });
    } finally {
      await notify({ type: "working", working: false });
    }
  }

  /**
   * A task Apps queued for this bot (D-35): a watch run goes to the chat the watch was set up in;
   * a button's hand-off to the bot's chat with the person who pressed it (or its room, if shared).
   * Changes the bot makes in a watch run are audited as that watch, so it can't set itself off.
   * A task this server took over from one that stopped carries on from its saved steps (D-59), and
   * only the server holding it posts its result; one stopped for its lease (`signal`) throws
   * RunTakenOver, for its runner to leave it to the server that carries it on.
   * @param {object} job the claimed task
   * @param {AbortSignal | null} [signal] its lease's (keepLease)
   */
  async function runAppTask(job, signal = null) {
    let row = null;
    let call = null;
    if (job.kind === "watch" || job.kind === "shell") {
      ({ row, call } = (await backgroundRow(job.conversationId, job.workspaceId, systemContext("app job runner"))) || {});
    } else {
      // A button's hand-off, to the bot's chat with the person who pressed it, in the job's home.
      call = { context: systemContext("app job runner").forWorkspaceUser(String(job.workspaceId), String(job.userId), { actorId: String(job.userId) }) };
      row = await conversations.ownedBot(String(job.botId), call).catch(() => null);
    }
    if (!row) throw new BotsError(404, "The bot or chat for this task no longer exists.", { code: "bots_task_target_gone" });
    const held = jobs ? jobCheckpoint(jobs, job, { context: systemContext("app job runner").forWorkspace(String(job.workspaceId)) }, signal) : null;
    const appsVia =
      job.kind === "watch"
        ? { kind: "watch", watchId: String(job.watchId), botId: String(row.id) }
        : { kind: "task", botId: String(row.id) };
    // A button's hand-off has someone waiting on it; a watch run or a finished command doesn't (D-59).
    const work = job.kind === "watch" || job.kind === "shell" ? "background" : "chat";
    await meter.track({ userId: row.user_id, botId: String(row.id), work }, async () => {
      const notify = (event) => conversations.tell(row, event, call);
      await notify({ type: "working", working: true });
      try {
        // The task's line goes up once: a run taken over from a stopped server already showed it.
        if (!(job.attempts > 1)) {
          await conversations.append(row, [
            {
              kind: "event",
              role: "system",
              body:
                job.kind === "shell"
                  ? { text: job.title, icon: "command" }
                  : { text: job.title, icon: "apps", detail: job.prompt.split("\n")[0].slice(0, 300) }
            }
          ], call);
        }
        try {
          if (held?.givenUp) throw new Error(`its server stopped ${RUN_LEASE.attempts} times while it ran`);
          // A watch run reads its own last few runs, as a routine does; a finished command the chat's latest words (D-60).
          await respond(row, {
            prompt: job.prompt,
            routineRun: true,
            appsVia,
            routine: job.kind === "watch" ? { id: `watch:${job.watchId}` } : null,
            recentOnly: job.kind === "shell",
            checkpoint: held,
            call
          });
        } catch (error) {
          if (error instanceof RunTakenOver) {
            if (!signal?.aborted) console.warn(error.message);
            throw error;
          }
          await conversations.withTransaction(call, async (txOptions) => {
            // Another server holds the task now, and posts its own ending.
            if (held && !(await held.end({ failed: true }, txOptions))) return;
            await conversations.append(row, [
              {
                kind: "text",
                role: "bot",
                body: {
                  text:
                    `I couldn't finish the task from ${job.title.replace(/^(Task from|Watch:) /u, "")}, ` +
                    `because something went wrong on my side.`
                }
              }
            ], txOptions);
          });
          throw error;
        } finally {
          await notify({ type: "messages" });
        }
      } finally {
        await notify({ type: "working", working: false });
      }
    });
  }

  return Object.freeze({
    runRoutine,
    runAppTask
  });
}

function routinePrompt(routine) {
  return [
    `Routine run, from the scheduler; the person didn't write this. It's time for your routine "${routine.name}" (${routine.schedule}).`,
    `Instructions: ${routine.instructions || routine.name}`,
    "Do it now with your tools, then write the result for the person as an ordinary message, without mentioning the scheduler.",
    ...(routine.once ? ["This is a one-off: it removes itself after this run. If it's running a little late, say sorry briefly."] : []),
    "If the instructions say to only report changes and nothing has changed since your last report, call nothing_new and write nothing at all: no message saying there's no change."
  ].join("\n");
}
