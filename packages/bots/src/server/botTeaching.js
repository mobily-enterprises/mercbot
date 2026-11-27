import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { resolveUserScopeValue } from "@jskit-ai/resource-runtime/server";
import { refusalOf } from "@local/account/meter";
import { demoHasSteps, demoLines, demoSummary } from "./teaching.js";
import { BotsError } from "./botsError.js";

/**
 * Teaching a bot a task from a recorded demonstration, in a chat: the person takes over the bot's computer there
 * (D16) and records themselves on it. Every method takes the call's options last; learning in the background keeps
 * the request's.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/computer/server/types").Computer} dependencies.computer
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {import("./types.js").BackgroundWork} dependencies.background
 * @param {typeof import("./botWriting.js").writeSkillFromDemo} dependencies.writeSkill
 */
export function createBotTeaching({ records, computer, integrations, notices, background, writeSkill }) {
  /** The bot's seat in the chat, which the caller may open, or a 404. */
  async function seatOf(chatId, botId, options) {
    const seat = await records.directory.chatBotOf(String(botId), String(chatId), options);
    if (!seat) throw new BotsError(404, "That bot isn't in this chat.", { code: "bots_bot_not_in_chat" });
    return seat;
  }

  /** The chat's people, and whoever is teaching, hear of it on any server; a failure leaves it to their next read. */
  async function notify(chatId, event, options) {
    const people = (await records.chats.people(chatId, options)).map((person) => String(person.user_id));
    const teacher = resolveAuditActorId(options?.context) ?? resolveUserScopeValue(options?.context);
    const to = [...new Set([...people, ...(teacher ? [String(teacher)] : [])])];
    await notices.publishEach("bots", to, { ...event, chatId: String(chatId) })
      .catch((error) => console.warn("Telling people about a demonstration failed; they see it on their next read.", error));
  }

  /**
   * Teach a task: the person takes over the bot's computer in the chat and records themselves on it. Answers
   * `{ recording: true, control }`, control as the take-over gave it.
   */
  async function startTeaching(chatId, botId, options) {
    const seat = await seatOf(chatId, botId, options);
    const { control } = await computer.takeOver(seat.id, options);
    await computer.startRecording(seat.id);
    return { recording: true, control };
  }

  /**
   * Stop teaching: the computer goes back to the bot, and the person's "finished" message with the skill chip is
   * posted, from which the bot learns in the background, posting progress as it goes. Discarding keeps no recording
   * and posts no message. Answers `{ messages, control: null }`: the hand-back's line and the message.
   */
  async function stopTeaching(chatId, botId, { discard = false } = {}, options) {
    const seat = await seatOf(chatId, botId, options);
    const recording = await computer.stopRecording(seat.id);
    const handed = await computer.handBack(seat.id, options);
    if (discard) return { messages: handed.messages, control: null };
    if (!recording) throw new BotsError(409, "There's no recording to stop.", { code: "bots_recording_missing" });
    const [finished] = await records.messages.append(String(chatId), [{
      kind: "text",
      role: "user",
      body: { text: "I've finished recording. Please learn from it.", chip: "Learn from demonstration", recording }
    }], options);
    await notify(chatId, { type: "messages" }, options);
    background.add(learn({ chatId: String(chatId), botId: String(botId) }, finished.id, recording, options));
    return { messages: [...handed.messages, finished], control: null };
  }

  async function learn({ chatId, botId }, messageId, recording, options) {
    const working = (on, status) => notify(chatId, { type: "working", botId, working: on, ...(status ? { status } : {}) }, options);
    const post = async (text) => {
      await records.messages.append(chatId, [{ kind: "text", role: "bot", authorBotId: botId, body: { text } }], options);
      await notify(chatId, { type: "messages" }, options);
    };
    // Where the page offers it again: the message box's + menu, "Teach <bot> a task".
    const noSteps = async () => {
      const name = (await records.directory.findBot(botId, options))?.name ?? "me";
      return `That recording was too short to show me a task, so I've deleted it and haven't saved a skill. Want to try again? Open + in the message box, then Teach ${name} a task, start recording, and go through the whole task from beginning to end.`;
    };
    try {
      await working(true, "Putting it together");
      await post("Got your demo, thanks. Pulling up the recording now.");
      if (!demoHasSteps(recording.events)) {
        await post(await noSteps());
        return;
      }
      await working(true, "Studying the recording");
      await post(demoSummary(recording.events));
      const skill = await writeSkill(demoLines(recording.events));
      if (!skill.name || !skill.steps.length) {
        await post(await noSteps());
        return;
      }
      const saved = await integrations.createSkill(skill, options);
      await post(skillMessage(saved, skill));
    } catch (error) {
      // Refused (meter.js refuseWork), it says what a paused home says (D-73).
      await post(refusalOf(error)?.notice ?? "I couldn't learn from that recording this time. Want to record it again?");
    } finally {
      // The recording is deleted once the bot has learned from it.
      const message = await records.messages.messageById(messageId, options);
      if (message) {
        const { recording: _recording, ...body } = message.body;
        await records.messages.setBody(messageId, body, options);
      }
      await working(false);
    }
  }

  return Object.freeze({
    startTeaching,
    stopTeaching
  });
}

/** The bot's answer after learning: a skill link, the steps, the input and an offer. */
function skillMessage(saved, skill) {
  const name = saved.name.replace(/[[\]]/gu, "");
  const input = skill.input
    ? `Next time I'll ask you for ${skill.input.label}${
      skill.input.example ? ` (this time it was \`${skill.input.example.replace(/`/gu, "")}\`)` : ""
    }.`
    : "It doesn't need anything new from you each time.";
  return [
    `I've saved your demo as a skill: [${name}](skill:${saved.id})`,
    "",
    "Here's what I learned:",
    "",
    ...skill.steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    `${input} I'll use quicker ways where it's safe and my browser when I need it. I've ` +
      `deleted the recording now that I've learned from it.`,
    "",
    skill.input ? `Want me to try it now? Just tell me ${skill.input.label}.` : "Want me to try it now?"
  ].join("\n");
}
