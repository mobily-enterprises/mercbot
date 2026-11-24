import { BotsError, archivedBotRefusal } from "./botsError.js";
import { isModelFailure, modelFailure } from "./modelFailures.js";
import { RUN_LEASE, RunTakenOver, jobCheckpoint, routineCheckpoint } from "./runLease.js";

/**
 * A bot's background runs (D-35, D-59): a scheduled routine's run and a task Apps queued, each an ordinary reply
 * (`respond`) of a bot in a chat, run as the person who set the work up (R4): a routine's maker, a watch's creator, a
 * finished command's person, a button's presser. Each reads through the model's reader for that seat and person (D12).
 * Each holds its row with a run id and lease (runLease.js) while it runs, so a run whose server stopped is carried on
 * once, by the server that took it over, and only that server posts its result. In a paused home (D-73) the bot starts
 * nothing new and says why once, in one line (botReplies' respond).
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {import("./chatSeats.js").ChatSeats} dependencies.seats
 * @param {import("@local/apps/server/types").AppJobs | null} dependencies.jobs apps.jobs, where an Apps task's run is held
 * @param {(seat: object, options: object) => Promise<object[]>} dependencies.respond botReplies' respond
 */
export function createBackgroundRuns({ records, systemContext, meter, seats, jobs, respond }) {
  /**
   * One scheduled run of a routine, already claimed by this server (D-15). Open pages hear that
   * the bot is working and when it has posted; a failed run says so and waits for the next time,
   * and the fifth failed run in a row pauses the routine instead, saying how to resume it. A run
   * this server took over from one that stopped carries on from its saved steps (D-59); one stopped
   * for its lease (`signal`) is left, unended, to the server that carries it on.
   * @param {object} routine the claimed routine: its seat (chatBotId), its maker (madeBy) and its home
   * @param {AbortSignal | null} [signal] its lease's (keepLease)
   */
  async function runRoutine(routine, signal = null) {
    const found = await seats.backgroundSeat(
      { chatBotId: routine.chatBotId, homeId: routine.workspaceId, userId: routine.madeBy },
      "routine runner"
    );
    if (!found) {
      // Its seat, chat or bot is gone or archived, or its maker can no longer open the chat: the run ends, so no server
      // takes it over again, and one still in its chat pauses there, with a line.
      const system = { context: systemContext("routine runner").forWorkspace(String(routine.workspaceId)) };
      await routineCheckpoint(records.work, routine, null)?.end({ failed: true }, system);
      await pauseWithoutMaker(routine, system);
      return;
    }
    const { seat, call } = found;
    const task = { kind: "routine", id: String(routine.id) };
    // Counted once, by the server that started it; one that carries it on after another stopped doesn't count it again.
    if (!(routine.runAttempts > 1)) countRun(task, seat);
    await meter.track(
      { userId: seat.user_id, botId: seat.id, workspaceId: seat.workspace_id, task, work: "background" },
      () => runRoutineFor(seat, routine, call, signal)
    );
  }

  /** A run of a recurring task, in its day's figures (D-132); a run whose count fails runs all the same. */
  function countRun(task, seat) {
    meter.countTaskRun({ ...task, workspaceId: seat.workspace_id, userId: seat.user_id })
      .catch((error) => console.warn(`Counting a run of ${task.kind} ${task.id} failed; it runs all the same.`, error));
  }

  /**
   * A routine runs only as the person who made it (R4): one whose maker can no longer open its chat (they left it, or
   * the home) or whose account is gone pauses, with a line in the chat saying why. Nothing is said where its chat or bot
   * is gone or archived: archiving pauses the routines there with a line of its own.
   * @param {object} routine the claimed routine
   * @param {object} system the routine runner's context in its home
   */
  async function pauseWithoutMaker(routine, system) {
    const chatBot = await records.chats.chatBot(String(routine.chatBotId), system);
    const [chat, bot] = chatBot
      ? await Promise.all([records.chats.find(String(chatBot.conversation_id), system), records.bots.find(String(chatBot.bot_id), system)])
      : [];
    if (!chat || !bot || chat.archived_at || bot.archived_at) return;
    const maker = routine.madeBy == null ? "" : (await records.chats.names([String(routine.madeBy)], system)).get(String(routine.madeBy));
    const why = maker ? `${maker}, who set it up, can no longer open this chat` : "the account that set it up is gone";
    const detail = `The routine "${routine.name}" is paused: ${why}, and it runs only as the person who set it up.`;
    await records.chats.withTransaction(system, async (txOptions) => {
      await records.work.changeRoutine(String(routine.id), { enabled: false, nextRunAt: null }, txOptions);
      await records.messages.append(String(chat.id), [{ kind: "event", role: "system", body: { text: "Routine paused", icon: "routine", detail } }], txOptions);
    });
    await seats.tell(String(chat.id), { type: "messages" }, system);
  }

  async function runRoutineFor(seat, routine, call, signal) {
    const held = routineCheckpoint(records.work, routine, call, signal);
    await seats.working(seat, true, null, call);
    try {
      let appended;
      // Whether this server still held the run when it ended; one another server took over is left to it.
      let mine = true;
      try {
        if (held?.givenUp) throw new Error(`its server stopped ${RUN_LEASE.attempts} times while it ran`);
        appended = await respond(seat, {
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
          appended = await records.chats.withTransaction(call, async (txOptions) => {
            const ending = held ? await held.end({ failed: true }, txOptions) : { paused: false, messages: [] };
            mine = Boolean(ending);
            if (!ending) return [];
            return seats.say(seat, [
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
        await records.work.deleteRoutine(routine.id, routine.chatBotId, call);
        appended.push(
          ...(await seats.say(seat, [
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
      if (appended.length) await seats.tell(seat.chat_id, { type: "messages" }, call);
    } finally {
      await seats.working(seat, false, null, call);
    }
  }

  /**
   * The seat an Apps task runs in, as its person (R4): a watch run's and a finished command's seat (chatBotId), as the
   * watch's creator or the command's person; a button's hand-off in the presser's direct chat with the bot, made on
   * first use. An archived bot takes no task (D-108): the button that asked says so.
   */
  async function taskSeat(job) {
    if (job.chatBotId) return seats.backgroundSeat({ chatBotId: job.chatBotId, homeId: job.workspaceId, userId: job.userId }, "app job runner");
    if (!job.userId) return null;
    const asPresser = { context: systemContext("app job runner").forWorkspaceUser(String(job.workspaceId), String(job.userId), { actorId: String(job.userId) }) };
    const bot = await records.bots.find(String(job.botId), asPresser);
    if (!bot) return null;
    if (bot.archived_at) throw archivedBotRefusal(bot);
    const chat = await records.chats.direct(String(bot.id), asPresser);
    const seat = seats.seatOf(bot, chat, await records.chats.chatBotOf(String(bot.id), String(chat.id), asPresser), job.userId);
    return { seat, call: seats.readerOf(seat) };
  }

  /**
   * A task Apps queued for a bot (D-35): a watch run goes to the chat the watch was set up in, a finished command's to
   * its chat, a button's hand-off to the presser's direct chat with the bot. Changes the bot makes in a watch run are
   * audited as that watch, so it can't set itself off. A task this server took over from one that stopped carries on
   * from its saved steps (D-59), and only the server holding it posts its result; one stopped for its lease (`signal`)
   * throws RunTakenOver, for its runner to leave it to the server that carries it on.
   * @param {object} job the claimed task
   * @param {AbortSignal | null} [signal] its lease's (keepLease)
   */
  async function runAppTask(job, signal = null) {
    const found = await taskSeat(job);
    if (!found) throw new BotsError(404, "The bot or chat for this task no longer exists.", { code: "bots_task_target_gone" });
    const { seat, call } = found;
    const held = jobs ? jobCheckpoint(jobs, job, { context: systemContext("app job runner").forWorkspace(String(job.workspaceId)) }, signal) : null;
    const appsVia =
      job.kind === "watch"
        ? { kind: "watch", watchId: String(job.watchId), botId: seat.id }
        : { kind: "task", botId: seat.id };
    // A button's hand-off has someone waiting on it; a watch run or a finished command doesn't (D-59).
    const work = job.kind === "watch" || job.kind === "shell" ? "background" : "chat";
    // A watch's run is a recurring task's (D-132), counted once as a routine's is.
    const task = job.kind === "watch" ? { kind: "watch", id: String(job.watchId) } : null;
    if (task && !(job.attempts > 1)) countRun(task, seat);
    const who = { userId: seat.user_id, botId: seat.id, workspaceId: seat.workspace_id, ...(task ? { task } : {}), work };
    await meter.track(who, async () => {
      await seats.working(seat, true, null, call);
      try {
        // The task's line goes up once: a run taken over from a stopped server already showed it.
        if (!(job.attempts > 1)) {
          await seats.say(seat, [
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
          await respond(seat, {
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
          await records.chats.withTransaction(call, async (txOptions) => {
            // Another server holds the task now, and posts its own ending.
            if (held && !(await held.end({ failed: true }, txOptions))) return;
            await seats.say(seat, [
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
          await seats.tell(seat.chat_id, { type: "messages" }, call);
        }
      } finally {
        await seats.working(seat, false, null, call);
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
