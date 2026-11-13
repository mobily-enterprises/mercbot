import { refusalOf } from "@local/account/meter";
import { demoHasSteps, demoLines, demoSummary } from "./teaching.js";
import { BotsError } from "./botsError.js";
import { toBot } from "./botRows.js";

/**
 * Teaching a bot a task from a recorded demonstration. Every method takes the call's options last;
 * learning in the background keeps the request's.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/computer/server/types").Computer} dependencies.computer
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {import("./types.js").BotConversations} dependencies.conversations
 * @param {import("./types.js").BackgroundWork} dependencies.background
 * @param {typeof import("./botWriting.js").writeSkillFromDemo} dependencies.writeSkill
 */
export function createBotTeaching({ records, computer, integrations, conversations, background, writeSkill }) {
  /**
   * Teach a task: the person records themselves on the bot's computer. Stopping posts
   * their "finished" message with the skill chip, and the bot learns from it in the background,
   * posting progress as it goes. Discarding keeps nothing and posts nothing.
   */
  async function startTeaching(botId, options) {
    const row = await conversations.ownedSingleBot(botId, options);
    await computer.startRecording(String(row.conversation_id));
    return { recording: true };
  }

  async function stopTeaching(botId, { discard = false } = {}, options) {
    const row = await conversations.ownedSingleBot(botId, options);
    const recording = await computer.stopRecording(String(row.conversation_id));
    if (discard) return { bot: toBot(row), messages: [] };
    if (!recording) throw new BotsError(409, "There's no recording to stop.", { code: "bots_recording_missing" });
    const [finished] = await conversations.append(row, [{
      kind: "text",
      role: "user",
      body: { text: "I've finished recording. Please learn from it.", chip: "Learn from demonstration", recording }
    }], options);
    background.add(learn(row, finished.id, recording, options));
    return { bot: toBot(await conversations.refresh(row, options)), messages: [finished] };
  }

  async function learn(row, messageId, recording, options) {
    const notify = (event) => conversations.tell(row, event, options);
    const post = async (text) => {
      await conversations.append(row, [{ kind: "text", role: "bot", body: { text } }], options);
      await notify({ type: "messages" });
    };
    const noSteps =
      "That recording was too short to show me a task, so I've deleted it and haven't saved a skill. Want to try again? Open Teach a task, start recording, and go through the whole task from beginning to end.";
    try {
      await notify({ type: "working", working: true, status: "Putting it together" });
      await post("Got your demo, thanks. Pulling up the recording now.");
      if (!demoHasSteps(recording.events)) {
        await post(noSteps);
        return;
      }
      await notify({ type: "working", working: true, status: "Studying the recording" });
      await post(demoSummary(recording.events));
      const skill = await writeSkill(demoLines(recording.events));
      if (!skill.name || !skill.steps.length) {
        await post(noSteps);
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
      await notify({ type: "working", working: false });
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
