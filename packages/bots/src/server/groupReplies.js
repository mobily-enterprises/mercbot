import { withoutPaths } from "./botAgent.js";
import { refusalOf } from "@local/account/meter";
import { LEAKED_MARKUP, stoppedShort, withoutClosingWords, withoutMarkup } from "@jskit-ai/agent/server";
import { mentionMarkers, mentionsIn, withMentions } from "./mentions.js";
import { toBot } from "./botRows.js";
import { CHECKS } from "./replyChecks.js";

// Cards in a group that need an answer, which only the person who asked may give (D-46).
const FOR_ASKER = ["choice", "handover", "draft", "secure_form", "connect"];

/**
 * A group chat's reply (D-46): the bots it mentions, or every member, answer in turn, then bots another bot
 * mentioned may answer once more. It runs with the call's options (`call`) of the person whose message it answers.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/computer/server/types").Computer} dependencies.computer
 * @param {import("./types.js").BotConversations} dependencies.conversations
 * @param {import("./types.js").BotHistory} dependencies.chatHistory
 * @param {import("./types.js").BotTurns} dependencies.turns
 * @param {typeof import("./botAgent.js").generateGroupReply} dependencies.groupReply
 */
export function createGroupReplies({ records, computer, conversations, chatHistory, turns, groupReply }) {
  const joinNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] || "");

  async function replyInGroup(row, person, timeZone, call) {
    const groupId = String(row.id);
    const members = (await conversations.membersOf([row.id], call)).get(groupId) || [];
    // Only the last person's message and the last turn decide who speaks: two rows, not the whole chat.
    const latest = async (filters) => {
      const found = await records.turns.latestMessage(row.conversation_id, filters, call);
      return found ? { ...found, body: found.body || {} } : undefined;
    };
    const asked = await latest({ role: "user", kind: "text" });
    const named = mentionsIn(asked?.body.text).filter((id) => members.some((member) => member.id === id));
    const everyone = Boolean(asked?.body.text?.includes("<@everyone>"));
    // With several people, bots answer only when someone names them (or everyone), so people can
    // talk among themselves (D-46); alone with its bots, a person hears from all of them.
    const people = await conversations.peopleOf([row.id], call).then((byGroup) => byGroup.get(groupId) || []);
    // Straight after someone answers a card, only that card's bot speaks: it reports back on an
    // approval or a skipped hand-over, and carries on after a hand-over that's done (D-46).
    const lastTurn = await latest({ notKind: "event" });
    const settled =
      lastTurn?.body?.speaker &&
      ((lastTurn.kind === "choice" && lastTurn.body.purpose === "approval" && lastTurn.body.chosen) ||
        (lastTurn.kind === "handover" && lastTurn.body.status !== "pending"))
        ? lastTurn
        : null;
    const quiet = Boolean(settled) && !(settled.kind === "handover" && settled.body.status === "done");
    const first = settled ? members.filter((member) => member.id === String(settled.body.speaker.id))
      : everyone ? members
        : named.length ? members.filter((member) => named.includes(member.id))
          : people.length > 1 ? []
            : members;
    const asker = settled?.body.for || asked?.body.from || { id: String(row.user_id), name: person || "the person" };
    const notify = (event) => conversations.tell(row, event, call);
    /** What each bot reads: the group's summary and the messages after it. */
    const groupContext = async () => {
      await chatHistory.compaction.ensureWithin(row.conversation_id);
      const { summary, after } = await chatHistory.compaction.current(row.conversation_id);
      return { summary, timeline: await chatHistory.historyRows(row.conversation_id, after, call) };
    };
    const working = (list, status) => notify({ type: "working", working: true, status, speakers: list.map((member) => member.id) });
    const appended = [];

    // A bot's turn in the group (D-46): its full tools, for the person who asked, on its own
    // computer for this group. With other people present it works like a shared room: nothing of
    // the asker's own is reachable, and files go to the bot's folder. What it makes shows in the
    // group, marked as its own; a card that needs an answer is for the asker only. Its routines
    // stay in the asker's own chat with it, where they run.
    const several = people.length > 1;
    async function speak(member, followUp) {
      const bot = await records.conversations.botOf(String(member.id), call);
      if (bot?.kind !== "bot") return;
      // The bot as the call's person sees it: alone with their bots, that's the asker.
      const own = await conversations.seenBy(bot, call);
      const actor = several ? conversations.groupView(own, row) : own;
      const seat = await conversations.groupSeatFor(row, bot, call);
      const asGroup = (messages) =>
        messages.map((message) => ({
          ...message,
          body: {
            ...message.body,
            speaker: member,
            ...(FOR_ASKER.includes(message.kind) ? { for: asker } : {}),
            ...(several ? { place: "group" } : {})
          }
        }));
      const { run, isBuilder } = await turns.turnTools(actor, {
        timeZone,
        language: "",
        turn: { working: null, asking: null, viaBot: false },
        computerId: seat.id,
        place: several ? { homeId: row.workspace_id, botId: bot.id, everyone: true } : null,
        post: async (messages) => {
          await conversations.append(row, asGroup(messages), call);
          await notify({ type: "messages" });
        }
      }, call);
      let text = "";
      let transcript = null;
      // Refused part-way (meter.js refuseWork, D-73): what the turn made still shows, then the group says so as a paused
      // home's group does, and no other bot starts.
      let refused = null;
      try {
        const context = await groupContext();
        const out = await groupReply({ ...toBot(own), isBuilder, instructions: own.instructions || "", skills: own.skills || [] }, {
          groupName: row.name,
          members,
          person: asker.name,
          people: people.map((entry) => entry.name),
          ...context,
          followUp,
          timeZone,
          state: quiet ? "" : await turns.currentState(actor, context.timeline, timeZone, "", [], call),
          tools: quiet ? {} : run.tools
        });
        // A test's stand-in may answer with plain text.
        let account = "";
        ({ text = "", transcript = null, account = "" } = typeof out === "string" ? { text: out } : out || {});
        // A reply that stopped at "I'll…", or wrote raw markup, carries on once from its own steps,
        // as in its own chat (D-48). The engine's own account of a reply that stopped early is never sent back.
        const leaked = LEAKED_MARKUP.test(text);
        if (!quiet && Array.isArray(transcript) && (leaked || (!account && stoppedShort(text.trim())))) {
          const steps = withoutClosingWords(transcript);
          const sofar = { kind: "text", role: "bot", body: { text: "", speaker: member, transcript: steps } };
          const more = await groupReply({ ...toBot(own), isBuilder, instructions: own.instructions || "", skills: own.skills || [] }, {
            groupName: row.name,
            members,
            person: asker.name,
            people: people.map((entry) => entry.name),
            ...context,
            timeline: [...context.timeline, sofar],
            timeZone,
            state: await turns.currentState(actor, context.timeline, timeZone, "", [], call),
            tools: run.tools,
            prompt: leaked ? CHECKS.markup : CHECKS.stoppedShort
          });
          ({ text = "" } = typeof more === "string" ? { text: more } : more || {});
          transcript = [...steps, ...((typeof more === "object" && more?.transcript) || [])];
        }
        // People never see raw markup or Mercbot's internal paths (D-48).
        text = withoutPaths(withoutMarkup(text));
        await run.finish();
      } catch (error) {
        if (refusalOf(error)) {
          refused = error;
        } else {
          console.error(`Bot ${member.id}'s turn in group ${row.id} failed: ${error?.message || error}`);
          text = followUp ? "" : "Sorry, I couldn't answer just now.";
        }
      } finally {
        await run.close();
      }
      // Routines it set up belong to the asker's own chat with it, where they run.
      const routines = run.before.filter((message) => message.kind === "event" && message.body.icon === "routine");
      if (routines.length) {
        await conversations.append(own, routines, call);
        await conversations.tell(own, { type: "messages" }, call);
      }
      const before = run.before.filter((message) => !message.body.lead && !routines.includes(message));
      const posted = await conversations.append(row, [
        ...asGroup(before),
        ...(text
          ? [
              {
                kind: "text",
                role: "bot",
                body: withMentions(
                  {
                    text: mentionMarkers(
                      text,
                      members.filter((entry) => entry.id !== member.id)
                    ),
                    speaker: member,
                    answers: Number(asked?.id) || 0,
                    ...(transcript ? { transcript } : {})
                  },
                  members
                )
              }
            ]
          : []),
        ...asGroup(run.after)
      ], call);
      // A hand-over keeps the bot's computer for this group awake until it's settled (D-14).
      if (run.after.some((message) => message.kind === "handover")) computer.hold(String(seat.id), true).catch((error) => console.warn("Holding the bot's computer awake for a hand-over failed.", error));
      appended.push(...posted.filter((message) => message.kind === "text"));
      if (posted.length) await notify({ type: "messages" });
      if (refused) throw refused;
    }

    try {
      if (!first.length) return appended;
      await working([first[0]], "Picked it up");
      for (const [index, member] of first.entries()) {
        const rest = first.slice(index);
        if (rest.length > 1 || index > 0) {
          await working(rest, `${joinNames(rest.map((entry) => entry.name))} ${rest.length > 1 ? "are" : "is"} working`);
        }
        await speak(member, false);
      }
      // One round of follow-ups, only from bots another bot mentioned just now;
      // none after someone answered a card.
      const said = settled ? [] : appended.slice();
      const followers = members.filter((member) => said.some((message) =>
        message.body.speaker.id !== member.id && mentionsIn(message.body.text).includes(member.id)));
      for (const member of followers) {
        await working([member], `${member.name} is working`);
        await speak(member, true);
      }
    } finally {
      await notify({ type: "working", working: false });
    }
    chatHistory.compactLater(row.conversation_id);
    return appended;
  }

  return Object.freeze({
    replyInGroup
  });
}
