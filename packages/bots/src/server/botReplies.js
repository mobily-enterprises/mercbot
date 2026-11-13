import { APP_ACTIONS } from "./appTools.js";
import { MAIL_CHANGES } from "./mailTools.js";
import { validTimeZone } from "./routineSchedule.js";
import { withoutPaths } from "./botAgent.js";
import { LEAKED_MARKUP, reportsActions, stoppedShort, toolRecord, withoutClosingWords, withoutMarkup } from "@jskit-ai/agent/server";
import { startResumer as startRunResumer } from "@jskit-ai/agent-runtime/server";
import { refusalOf } from "@local/account/meter";
import { settledWithin } from "./backgroundWork.js";
import { isModelFailure, modelFailure } from "./modelFailures.js";
import { createBackgroundRuns, pausedNotice } from "./backgroundRuns.js";
import { createConnectFollowUps } from "./connectFollowUps.js";
import { RUN_LEASE, RunTakenOver } from "./runLease.js";
import { previewOf, toBot, toMessage } from "./botRows.js";
import {
  APPS_CHECK,
  CALENDAR_ACTIONS,
  CALENDAR_CHECK,
  CHECKS,
  CLAIMS_APPS,
  CLAIMS_CALENDAR,
  CLAIMS_DRIVE,
  CLAIMS_GITHUB,
  CLAIMS_HANDOVER,
  CLAIMS_MAIL,
  claimsFiles,
  claimsPicture,
  DRIVE_ACTIONS,
  DRIVE_CHECK,
  FILES_CHECK,
  ONLY_WHAT_WAS_ASKED,
  GITHUB_CHECK,
  GITHUB_WRITES,
  HANDOVER_CHECK,
  MAIL_CHECK,
  PICTURE_CHECK,
  PICTURE_WORDS,
  REFUSAL_CHECK,
  REFUSES_PICTURE,
  withoutRepeat
} from "./replyChecks.js";

/**
 * A bot's replies (D-48): to the person's message, a scheduled routine and a task from Apps, each run as
 * background work with its steps saved, checked against what its tools did, and carried on after a server stops.
 * A person's reply runs with their request's call options (`call`) to the end; a routine, an Apps task and a
 * resumed reply run as a job for one person in the work's home (forWorkspaceUser, with that person as actor).
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {import("@local/computer/server/types").Computer} dependencies.computer
 * @param {import("./types.js").BotConversations} dependencies.conversations
 * @param {import("./types.js").BotHistory} dependencies.chatHistory
 * @param {import("./types.js").BackgroundWork} dependencies.background
 * @param {import("./types.js").BotRequests} dependencies.requests
 * @param {import("./types.js").Goals} dependencies.goals
 * @param {import("./types.js").BotTurns} dependencies.turns
 * @param {ReturnType<typeof import("./groupReplies.js").createGroupReplies>} dependencies.groupReplies
 * @param {typeof import("./botAgent.js").generateReply} dependencies.reply
 * @param {((text: string, record: string) => Promise<string[]>) | null} dependencies.checkClaims the final-reply check, or null
 * @param {import("@local/apps/server/types").AppJobs | null} dependencies.jobs apps.jobs, where an Apps task's run is held (null without Apps)
 */
export function createBotReplies({
  records,
  systemContext,
  meter,
  computer,
  conversations,
  chatHistory,
  background,
  requests,
  goals,
  turns,
  groupReplies,
  reply,
  checkClaims,
  jobs
}) {
  /**
   * In a paused home (D-73) the bot says why instead of replying: when it's paused before the turn starts, and when
   * the turn's work is refused part-way (meter.js refuseWork), the same way. A routine's or a task's run ends there
   * unfailed, and a goal's rounds stop, as they do after any error; the person asks to carry on once it's resumed.
   */
  async function pausedTurn(row, text, { human = false, goalTurn = false, checkpoint = null, call }) {
    const notice = await conversations.withTransaction(call, async (txOptions) => {
      // A routine's or a task's run ends with the notice, as with any result, so only the server holding it posts it.
      if (checkpoint) await checkpoint.settle(txOptions, { failed: false });
      return pausedNotice({ records, conversations }, row, text, human, txOptions);
    });
    if (goalTurn) throw new Error(text);
    return notice;
  }

  async function respond(row, options) {
    const paused = await meter.pausedMessage(row.workspace_id);
    if (paused) return pausedTurn(row, paused, options);
    try {
      return await replyTurn(row, options);
    } catch (error) {
      const refusal = refusalOf(error);
      if (!refusal) throw error;
      return pausedTurn(row, refusal.notice, options);
    }
  }

  async function replyTurn(
    row,
    {
      timeZone,
      language = "",
      prompt = "",
      routineRun = false,
      routine = null,
      recentOnly = false,
      appsVia = null,
      requestTurn = null,
      human = false,
      goalTurn = false,
      checkpoint = null,
      call
    }
  ) {
    const posted = [];
    const turn = requestTurn || { ...(await requests.openFor(row.conversation_id, call)), viaBot: false };
    // What the person writes while this reply works reaches it with its next tool result (D-48);
    // heard.upTo is the newest message it has seen, so that one isn't answered again afterwards.
    const heard = { upTo: Infinity };
    const inbox =
      (human || goalTurn) && !routineRun && !requestTurn
        ? async () => {
          if (!Number.isFinite(heard.upTo)) return [];
          const fresh = await records.turns.messages(row.conversation_id, { role: "user", kind: "text", afterId: String(heard.upTo) }, {}, call);
          if (!fresh.length) return [];
          heard.upTo = Number(fresh.at(-1).id);
          return fresh.map((message) => String(message.body.text || "").slice(0, 2000));
        }
        : null;
    const { run, isBuilder, toolSwitches } = await turns.turnTools(row, {
      timeZone,
      language,
      turn,
      routineRun,
      appsVia,
      inbox,
      // Goals in a bot's own chat or a room (not groups, not a bot's request); only the person's own
      // turn can open one, and a goal round can work on it.
      goalOperations: !routineRun && !turn.viaBot && (human || goalTurn) ? goals.operationsFor(row, { human, timeZone, language }) : null,
      // A line the person should see before the reply is done, such as "I'll draw it now".
      post: async (messages) => {
        posted.push(...messages.map((message) => message.body.text));
        await conversations.append(row, messages, call);
        await conversations.tell(row, { type: "messages" }, call);
      }
    }, call);
    const bot = { ...toBot(row), isBuilder, instructions: row.instructions || "", skills: row.skills || [] };
    const { summary, history } = routine
      ? await chatHistory.routineHistory(row, routine.id, call)
      : recentOnly ? await chatHistory.recentHistory(row, call) : await chatHistory.conversationHistory(row, call);
    // Straight after an approval decision the bot only reports back; it doesn't act again.
    const lastTurn = [...history].reverse().find((message) => message.kind !== "event");
    const decided =
      !prompt &&
      ((lastTurn?.kind === "choice" && lastTurn.body.purpose === "approval" && lastTurn.body.chosen) ||
        (lastTurn?.kind === "handover" && lastTurn.body.status === "skipped"));
    let replyText;
    let transcript;
    /**
     * A person's reply or a goal round saves its steps as each one finishes (D-48, as Claude Code
     * keeps its transcript). If this conversation's reply was left part-way by a server that
     * stopped, and nothing newer was asked since, it carries on from its last saved step.
     */
    const checkpointed = (human || goalTurn) && !routineRun && !requestTurn;
    const asked = Number([...history].reverse().find((message) => message.role === "user")?.id) || 0;
    heard.upTo = asked;
    const saved = checkpointed ? await chatHistory.runs.saved(row.conversation_id) : null;
    // A routine's or an Apps task's run keeps its steps on its own row instead (D-59): one its server
    // left part-way carries on from them on the server that took it over.
    const resumed = checkpoint
      ? checkpoint.steps
      : saved?.steps?.length && saved.input?.answers === asked && (saved.input?.prompt || "") === prompt ? saved.steps : [];
    const onSteps = checkpoint
      ? (steps) => checkpoint.save([...resumed, ...steps])
      : checkpointed
        ? (steps) =>
            chatHistory.runs.save(row.conversation_id, [...resumed, ...steps], {
              prompt,
              human,
              goalTurn,
              timeZone,
              language,
              answers: asked
            })
        : keepNoSteps;
    /**
     * Background work (a routine, a watch run, a task) that fails before doing anything ends with
     * its error, which its runner posts and counts; one that fails part-way still ends with its
     * account of what it did, and counts as failed all the same.
     */
    let failed = false;
    const throwIf = routineRun
      ? (_error, steps) => {
          failed = true;
          return !steps.length;
        }
      : undefined;
    try {
      const state = await turns.currentState(row, history, timeZone, language, toolSwitches?.turnedOff || [], call);
      const seen = await turns.withPictures(row, history);
      const sofar = { kind: "text", role: "bot", body: { text: "", transcript: resumed, ...(prompt ? { trigger: prompt } : {}) } };
      let unfinished = "";
      // The engine's own account of a pass that stopped early (out of steps or time, or failed after
      // some work) already says where it got to; each check's pass below brings its own.
      let account = "";
      ({
        text: replyText,
        transcript,
        unfinished = "",
        account = ""
      } = await reply(
        bot,
        resumed.length ? [...seen, sofar] : seen,
        decided ? {} : run.tools,
        state,
        resumed.length ? CHECKS.resumed : prompt,
        { summary, onSteps, carriesOn: checkpointed, throwIf, signal: checkpoint?.signal }
      ));
      // Out of steps or time with the job not done: it carries on by itself in goal rounds
      // (D-48), never waiting for the person to say "carry on". A goal round's own goal goes on.
      if (unfinished && checkpointed && !(await goals.openGoal(row.conversation_id))) {
        const request =
          [...history].reverse().find((message) => message.role === "user" && message.kind === "text")?.body.text || "the person's request";
        await goals.openFor(row, request, { timeZone, language });
      }
      transcript = [...resumed, ...transcript];
      /**
       * A check sends the reply back once, carrying on from where it got to (D-48): the second pass
       * sees the first one's steps, so it neither redoes them nor says they didn't happen, and
       * the stored transcript keeps both.
       */
      const again = async (check) => {
        const steps = withoutClosingWords(transcript);
        const sofar = { kind: "text", role: "bot", body: { text: replyText, transcript: steps, ...(prompt ? { trigger: prompt } : {}) } };
        const next = await reply(bot, [...seen, sofar], run.tools, state, `${check}\n\n${ONLY_WHAT_WAS_ASKED}`, { summary, signal: checkpoint?.signal });
        return { ...next, transcript: [...steps, ...next.transcript] };
      };
      // A bot only says it handed its screen over once the card exists: a reply that
      // claims it without calling ask_for_help is sent back once to do it or say otherwise.
      // Any other card below is a card too, so a
      // reply that made one is not sent back over its own words.
      if (
        !decided &&
        run.tools.askForHelp &&
        !run.showsCard() &&
        CLAIMS_HANDOVER.test(replyText)
      ) {
        ({ text: replyText, transcript, account = "" } = await again(HANDOVER_CHECK));
      }
      // Likewise a picture only exists once make_picture made it.
      // What the turn was about: the person's message, the bot's own last message when it was about
      // a picture (its "Shall I draw that?" answered with "Yes please", but not "Want me to make it
      // an hour?"), and whether pictures were made in this chat lately.
      const recent = history.slice(-8);
      const botSaid = [...recent].reverse().find((message) => message.kind === "text" && message.role === "bot")?.body.text || "";
      const context = [
        [...recent].reverse().find((message) => message.kind === "text" && message.role === "user")?.body.text,
        PICTURE_WORDS.test(botSaid) || /\bdraw/iu.test(botSaid) ? botSaid : "",
        recent.some((message) => message.kind === "pictures") ? "picture" : ""
      ].join("\n");
      // The pictures join the reply only when it finishes, so this asks the run itself. A copy that can't make
      // pictures (D-72) has nothing to send the reply back for.
      if (!decided && run.picturesOn && !run.madePicture()) {
        const check = REFUSES_PICTURE.test(replyText) ? REFUSAL_CHECK : claimsPicture(context, replyText) ? PICTURE_CHECK : "";
        if (check) ({ text: replyText, transcript, account = "" } = await again(check));
      }
      // And a calendar change only happened if its tool ran.
      if (
        !decided &&
        run.tools.addCalendarEvent &&
        !run.attempted.some((id) => CALENDAR_ACTIONS.includes(id)) &&
        CLAIMS_CALENDAR.test(replyText)
      ) {
        ({ text: replyText, transcript, account = "" } = await again(CALENDAR_CHECK));
      }
      // And the person's Drive or OneDrive files are only shown once list_drive_files read them.
      if (!decided && run.tools.listDriveFiles && !run.attempted.some((id) => DRIVE_ACTIONS.includes(id)) && CLAIMS_DRIVE.test(replyText)) {
        ({ text: replyText, transcript, account = "" } = await again(DRIVE_CHECK));
      }
      /**
       * And mail or GitHub only changed if one of their tools ran (D-42). Mail, GitHub and apps all
       * have labels, so a change in one answers for those words in the others.
       */
      const wrote = (...lists) => run.attempted.some((id) => lists.some((list) => list.includes(id)));
      if (!decided && run.tools.forwardEmail && !wrote(MAIL_CHANGES, GITHUB_WRITES) && CLAIMS_MAIL.test(replyText)) {
        ({ text: replyText, transcript, account = "" } = await again(MAIL_CHECK));
      }
      if (!decided && run.tools.githubChange && !wrote(GITHUB_WRITES, MAIL_CHANGES) && CLAIMS_GITHUB.test(replyText)) {
        ({ text: replyText, transcript, account = "" } = await again(GITHUB_CHECK));
      }
      // And an app, table, field or record only changed if an Apps tool ran (D-35).
      // A reply that ends by asking the person something hasn't claimed it did anything.
      const asking = run.after.some((message) => message.kind === "choice");
      if (!decided && !asking && run.tools.dataCreate && !wrote(APP_ACTIONS, MAIL_CHANGES, GITHUB_WRITES) && CLAIMS_APPS.test(replyText)) {
        ({ text: replyText, transcript, account = "" } = await again(APPS_CHECK));
      }
      let carriedOn = false;
      const carryOn = async (check) => {
        carriedOn = true;
        ({ text: replyText, transcript } = await again(check));
      };
      // Raw model markup in the reply (a tool call written out as text, DeepSeek's own tokens)
      // means a malformed step: it carries on once, told that nothing in the markup ran (D-48).
      if (!decided && Object.keys(run.tools).length && LEAKED_MARKUP.test(replyText)) {
        await carryOn(CHECKS.markup);
      } else if (
        // A reply that stopped at "let me…" carries on once (D-47), for any bot with tools (D-48).
        // With a goal active, its next round carries on instead. The engine's own account of a reply
        // that stopped early is never sent back.
        !decided &&
        Object.keys(run.tools).length &&
        !account &&
        stoppedShort(replyText.trim()) &&
        (await goals.openGoal(row.conversation_id))?.status !== "active"
      ) {
        await carryOn(CHECKS.stoppedShort);
      }
      // A reply that says files are attached when no card will show sends them, or says plainly
      // what it couldn't find (D-48).
      if (!decided && run.tools.sendFiles && claimsFiles(replyText, run.showsCard()) && !(await run.fileCards()).length) {
        await carryOn(FILES_CHECK);
      }
      // The final-reply check (D-48): a reply that says it did something is compared with what its
      // tools did; a claim they don't support sends it back once to do it or say otherwise.
      if (!decided && !carriedOn && checkClaims && Object.keys(run.tools).length && reportsActions(replyText)) {
        const events = run.before.filter((message) => message.kind === "event").map((message) => message.body.detail || message.body.text);
        const unsupported = await checkClaims(replyText, toolRecord(transcript, events, "Mercbot"));
        if (unsupported.length) await carryOn(CHECKS.unsupported(unsupported));
      }
      // People never see raw markup or Mercbot's internal paths, whatever the second pass wrote.
      replyText = withoutPaths(withoutMarkup(replyText));
      // A line already posted (I'll draw it now) isn't said again at the top of the reply.
      replyText = withoutRepeat(replyText, posted);
      // A run with nothing new posts nothing, and the bot stays read.
      if (run.quiet()) return [];
      await run.finish();
    } finally {
      await run.close();
    }
    // The card and the waiting state are written together, so they can't disagree (D-14).
    const handover = run.after.find((message) => message.kind === "handover");
    // A password the person keeps in the vault never shows in the chat, whatever the bot read.
    replyText = await turns.withoutSecrets(replyText, call);
    const answers = Math.max(
      Number([...history].reverse().find((message) => message.role === "user")?.id) || 0,
      Number.isFinite(heard.upTo) ? heard.upTo : 0
    );
    const body = {
      text: replyText,
      transcript,
      answers,
      ...(prompt ? { trigger: prompt } : {}),
      ...(routine ? { routine: String(routine.id) } : {})
    };
    const appended = await conversations.withTransaction(call, async (txOptions) => {
      // A routine's or a task's run ends with its result, so only the server holding it posts it.
      const ending = checkpoint ? await checkpoint.settle(txOptions, { failed }) : [];
      const messages = await conversations.append(row, [
        ...run.before,
        ...(replyText ? [{ kind: "text", role: "bot", body }] : []),
        ...run.after,
        ...ending
      ], txOptions);
      if (handover) await records.conversations.updateConversation(row.conversation_id, { waiting_task: handover.body.task }, txOptions);
      return messages;
    });
    if (handover) {
      computer
        .hold(String(row.conversation_id), true)
        .catch((error) => console.warn("Holding the bot's computer awake for a hand-over failed.", error));
    }
    chatHistory.compactLater(row.conversation_id);
    return appended;
  }

  // A reply runs on the server as background work: the request waits up to 20 seconds
  // for it, and a longer one finishes on its own and tells the page through the bot events. One
  // reply per conversation is claimed in agent_runs, so a retried request or another page gets
  // { pending } instead of starting a second one; a reply whose server stopped beating for a
  // minute is taken over by the next request (D-15, D-19). Every reply ends with a message.
  const REPLY_WAIT_MS = 20000;
  /**
   * A reply counts as the answer to a message only if it saw that message (body.answers, the
   * newest person's message it read): one that started before a message arrived mid-reply
   * doesn't, so that message still gets its own reply afterwards.
   */
  async function answeredAfter(row, after, call) {
    if (!Number.isInteger(after) || after <= 0) return null;
    // What the person last said, at or before the point the page asks from: a card answered or an
    // event line after it doesn't count as something new to answer.
    const asked = Number((await records.turns.latestMessage(row.conversation_id, { role: "user", kind: "text", atMostId: String(after) }, call))?.id) || 0;
    // A reply after that point that saw it (records/turnRepository.js answersFrom).
    const already = await records.turns.latestMessage(row.conversation_id, { role: "bot", kind: "text", afterId: String(after), answersFrom: asked }, call);
    if (!already) return null;
    const messages = (await records.messages.messagesAfter(row.conversation_id, after, call)).map(toMessage);
    return { bot: toBot(await conversations.refresh(row, call)), messages };
  }

  /**
   * Replies a stopped server left part-way (D-48, D-19): any server finds them by their stale
   * heartbeat, takes one over through the database and carries it on from its saved steps, with
   * no page needed. Only a person's own replies; goal rounds carry on through their own lease.
   */
  const resumable = (query) => query.whereRaw("(input->>'human')::boolean");

  async function resumeRun(run) {
    // The run knows its conversation and bot; the conversation says whose and which home. A reply
    // left in a room or a group has no one person to carry it on for, so its run is given up.
    const place = await records.directory.computerOf(String(run.conversation_id), { context: systemContext("reply resumer") });
    const call = place?.userId
      ? { context: systemContext("reply resumer").forWorkspaceUser(place.workspaceId, place.userId, { actorId: place.userId }) }
      : null;
    const row = call && (await conversations.rowOf(String(run.bot_id), String(run.conversation_id), call));
    if (!row) return chatHistory.runs.release(run.conversation_id);
    background.add(meter.track({ userId: row.user_id, botId: String(row.id) }, () => runReply(row, { resume: run.input }, "", call)));
  }

  async function resumeStalled() {
    await Promise.all((await chatHistory.runs.takeOverStalled({ resumable })).map(resumeRun));
  }

  function startResumer(options) {
    return startRunResumer({ runs: chatHistory.runs, resume: resumeRun, resumable, ...options });
  }

  async function replyTo(botId, input, person, call) {
    const row = await conversations.ownedBot(botId, call, { room: input.room });
    // A page that lost its server mid-reply asks again (D-19). If the bot already answered after
    // the message the page had last seen, that answer is returned instead of a second one.
    const answered = await answeredAfter(row, Number(input.afterMessageId), call);
    if (answered) return answered;
    const pending = { pending: true, bot: toBot(row) };
    if (!(await chatHistory.claimReply(row))) return pending;
    const job = runReply(row, input, person, call);
    background.add(job);
    return (await settledWithin(job, REPLY_WAIT_MS)) || pending;
  }

  /**
   * @param {import("./types.js").RunCheckpoint | null} [held] a connect follow-up's run (connectFollowUps.js), which
   *   ends with the reply's result, so only the server holding it posts it
   */
  async function runReply(row, input, person, call, held = null) {
    const botId = String(row.id);
    const notify = (event) => conversations.tell(row, event, call);
    const heartbeat = setInterval(
      () =>
        chatHistory.runs
          .heartbeat(row.conversation_id)
          .catch((error) => console.warn("A run's heartbeat failed; the next one renews it.", error)),
      chatHistory.runs.limits.heartbeatMs
    );
    let answered = Infinity;
    // Whether this server still holds the follow-up it runs: one another server took over is that server's to end.
    let mine = true;
    try {
      const timeZone = validTimeZone(input.timeZone) ? input.timeZone : "UTC";
      let appended;
      // A group turn takes up the person's latest message even when no bot speaks (several people
      // and no bot named): it counts as answered, or answerWaiting would take it up again, and again.
      let heard = 0;
      // In a group no one bot speaks for the home, so a paused home's notice is a line in the chat (D-73), before its
      // bots start or when one's work is refused part-way.
      const pausedLine = async (text) => {
        const line = await conversations.append(row, [{ kind: "event", role: "system", body: { text, paused: true } }], call);
        await notify({ type: "messages" });
        return line;
      };
      try {
        const paused = row.kind === "group" ? await meter.pausedMessage(row.workspace_id) : null;
        if (paused) {
          heard = await latestAsked(row, call);
          appended = await pausedLine(paused);
        } else if (row.kind === "group") {
          heard = await latestAsked(row, call);
          appended = await groupReplies.replyInGroup(row, person, timeZone, call);
        } else {
          await notify({ type: "working", working: true });
          if (held?.givenUp) throw new Error(`its server stopped ${RUN_LEASE.attempts} times while it ran`);
          // A message that arrived while the bot was busy is named, so the reply answers it, not the
          // one before it.
          const prompt = input.resume
            ? input.resume.prompt || ""
            : input.connected
              ? connectedPrompt(input.connected)
              : input.waiting
                ? `(The person's message "${input.waiting}" arrived while you were busy with the one ` +
                  `before, so it hasn't been answered yet. Answer it now.)`
                : "";
          // A reply carried on after its server stopped keeps the settings it started with (D-48).
          appended = input.resume
            ? await respond(row, {
              timeZone: input.resume.timeZone || timeZone,
              language: input.resume.language || "",
              prompt,
              human: true,
              call
            })
            : await respond(row, { timeZone, language: languageName(input.language), prompt, human: true, checkpoint: held, call });
          // A follow-up that posted ended with its post; one with nothing new ends here.
          if (held && !appended.length) mine = Boolean(await held.end({ failed: false }, call));
        }
      } catch (error) {
        if (error instanceof RunTakenOver) {
          // Stopped for its lease (keepLease said why), or another server holds it: nothing is posted here.
          if (!held?.signal?.aborted) console.warn(error.message);
          mine = false;
          appended = [];
        } else if (row.kind === "group" && refusalOf(error)) {
          appended = await pausedLine(refusalOf(error).notice);
        } else {
          console.error(`Bot ${botId}'s reply failed: ${isModelFailure(error) ? modelFailure(error) : error?.message || error}`);
          const sorry = {
            kind: "text",
            role: "bot",
            body: {
              text: "Sorry, something went wrong on my side and I couldn't finish that. Ask me again and I'll pick it up from where things are.",
              answers: Number(input.afterMessageId) || 0
            }
          };
          appended = held
            ? await conversations.withTransaction(call, async (txOptions) => {
              mine = Boolean(await held.end({ failed: true }, txOptions));
              return mine ? conversations.append(row, [sorry], txOptions) : [];
            })
            : await conversations.append(row, [sorry], call);
        }
      }
      if (!mine) return { bot: toBot(row), messages: [] };
      if (row.kind !== "group") {
        if (appended.length) await notify({ type: "messages" });
        await notify({ type: "working", working: false });
      }
      answered = Math.max(heard, ...appended.map((message) => Number(message.body?.answers) || 0));
      const bot = toBot(await conversations.refresh(row, call));
      const latest = [...appended].reverse().find((message) => message.kind !== "event") || appended[appended.length - 1];
      return { bot: { ...bot, preview: latest ? previewOf(latest) : "" }, messages: appended };
    } finally {
      clearInterval(heartbeat);
      // A follow-up taken over leaves the chat's reply to the server that took it over.
      if (mine) {
        await chatHistory.runs
          .release(row.conversation_id)
          .catch((error) => console.warn("Releasing a conversation's run failed; its lease runs out instead.", error));
      }
      // A message that arrived while this reply ran gets its own reply now, whether or not a page
      // is still waiting for it.
      background.add(answerWaiting(row, input, person, answered, call));
      // Once the conversation is free, an open goal carries on in another round (D-48), and a connect follow-up that
      // waited for this reply starts.
      if (row.kind !== "group") {
        background.add(goals.afterTurn(row.conversation_id));
        background.add(connectFollowUps.afterTurn(row.conversation_id));
      }
    }
  }

  /** The id of the person's latest text message in the conversation, or 0. */
  /** The person's latest text message in the conversation, or null. */
  const latestUserText = (row, call) => records.turns.latestMessage(row.conversation_id, { role: "user", kind: "text" }, call);

  /** The id of the person's latest text message in the conversation, or 0. */
  async function latestAsked(row, call) {
    return Number((await latestUserText(row, call))?.id) || 0;
  }

  async function answerWaiting(row, input, person, answered, call) {
    const latest = await latestUserText(row, call);
    if (!latest || Number(latest.id) <= answered || (await answeredAfter(row, Number(latest.id), call))) return;
    if (!(await chatHistory.claimReply(row))) return;
    const fresh = await conversations.refresh(row, call);
    const waiting = String(latest.body.text || "").slice(0, 1500);
    if (fresh) {
      // The waiting message is what it answers, not the connected app it followed up (connectFollowUps.js).
      const next = { ...input, connected: null, waiting };
      await meter.track({ userId: fresh.user_id, botId: String(fresh.id) }, () => runReply(fresh, next, person, call));
    }
  }

  /**
   * A conversation as background work sees it, with the call the work runs with: for its person, or
   * in a shared bot's room for whoever set the room up (D-36), as a job in `home`. Null when the
   * conversation or its bot is gone.
   * @param {string} conversationId
   * @param {string} home
   * @param {object} system the work's system context, which the job context derives from
   */
  async function backgroundRow(conversationId, home, system) {
    const inHome = { context: system.forWorkspace(String(home)) };
    const conversation = await records.conversations.conversationRow(String(conversationId), inHome);
    const person = conversation && String(conversation.user_id || conversation.created_by || "");
    if (!person) return null;
    const call = { context: system.forWorkspaceUser(String(home), person, { actorId: person }) };
    const bot = await records.conversations.botOf(String(conversation.bot_id), call);
    if (!bot) return null;
    const row = conversation.user_id
      ? conversations.asSeen(bot, conversation)
      : conversations.asSeen(bot, { ...conversation, user_id: conversation.created_by }, conversation);
    return { row, call };
  }


  // Routine runs and Apps tasks, run as background replies (backgroundRuns.js).
  const { runRoutine, runAppTask } = createBackgroundRuns({ records, systemContext, meter, conversations, jobs, respond, backgroundRow });
  // Connect follow-ups, carried on as replies to the person (connectFollowUps.js).
  const connectFollowUps = createConnectFollowUps({
    records,
    systemContext,
    conversations,
    turns,
    chatHistory,
    meter,
    background,
    backgroundRow,
    runReply
  });

  return Object.freeze({
    respond,
    resumeStalled,
    startResumer,
    connectFollowUps,
    replyTo,
    runRoutine,
    runAppTask
  });
}

/** What the bot is told when the app it was waiting for is connected. */
function connectedPrompt({ app, task }) {
  return (
    `(${app} is connected now: the person signed in from your card. Finish what you said you'd do once it was: ${task}. ` +
    `Do it now with your ${app} tools, unless the chat above shows it's already done or no longer wanted, and tell the person briefly.)`
  );
}

/** A reply that isn't checkpointed keeps none of its steps along the way. */
async function keepNoSteps() {}

/** The person's language from the page, by its English name; English needs no line. */
function languageName(tag) {
  const value = String(tag || "").trim();
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/u.test(value) || /^en\b/iu.test(value)) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(value) || "";
  } catch {
    return "";
  }
}
