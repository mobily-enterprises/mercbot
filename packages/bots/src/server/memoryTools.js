import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import { findSkill } from "./skills.js";

/**
 * What the bot keeps for the person: memories shared by all their bots, and skills. In a shared
 * bot's room (`personal` false, D-36) only Mercbot's own skills and the bot's are offered.
 * @param {object} shared
 * @param {import("./types.js").TurnRepository} shared.turns records.turns
 * @param {import("@local/integrations/server/types").Integrations} shared.integrations
 * @param {{ name: string, instructions: string }[]} shared.botSkills
 * @param {string} shared.botId
 * @param {boolean} shared.personal
 * @param {(text: string) => void} shared.acknowledge
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} shared.call the turn's call options
 */
export function buildMemoryTools({ turns, integrations, botSkills, botId, personal, acknowledge, call }) {
  const tools = {};
  if (personal) {
    /** Memory shared by all the person's bots: lasting facts only, never chat content. */
    async function remember({ fact }) {
      const text = fact.trim();
      /** Which connected account to use is one bot's choice, kept in its own chat. */
      const addresses = (await integrations.accountLabels(call)).map((address) => address.toLowerCase());
      if (addresses.some((address) => text.toLowerCase().includes(address)) || /\b(inbox|mailbox)(es)?\b/iu.test(text)) {
        return {
          error:
            "Which account to use isn't saved for all bots: it's your choice in this chat only. Don't say it's shared; just keep to it here."
        };
      }
      // A person's memories belong to them within this bot's home (D-36): the call's.
      await turns.rememberFact(text, botId, call);
      return {
        status: "saved",
        note: "If you haven't already said it, say once, in one line, that you've saved it so their other bots know too."
      };
    }
    tools.remember = createTool(
      Object.freeze({
        id: "remember",
        description:
          "Save a lasting fact about the person so all their bots know it: an allergy, a diet, a preference, an important date, someone close to them. One fact per call, in a short plain sentence. Never save passwords, card numbers or codes.",
        inputSchema: z.object({ fact: z.string().min(3).max(300) }),
        execute: (input, options) => remember(input, options)
      })
    );
    async function forget({ fact }) {
      return (await turns.forgetFact(fact.trim(), call)) ? { status: "forgotten" } : { error: "There's no remembered fact worded like that." };
    }
    tools.forget = createTool(
      Object.freeze({
        id: "forget",
        description:
          "Forget something you remember about the person, when they ask or it's no longer true. Give the fact as it's listed in the Current state note.",
        inputSchema: z.object({ fact: z.string().min(3).max(300) }),
        execute: (input, options) => forget(input, options)
      })
    );
  }

  /**
   * Skills: Mercbot's own and the person's, read before doing the job. The person's
   * can be saved, changed and deleted, only when they agree, taught tasks too.
   */
  const ownSkills = async () => (personal ? integrations.skills(call) : []);
  async function readSkill({ acknowledgement, name }) {
    const skill = findSkill(name, [...await ownSkills(), ...botSkills.map((entry, index) => ({ ...entry, id: `t${index}` }))]);
    if (!skill) return { error: `There's no skill called "${name}".` };
    acknowledge(acknowledgement);
    return { name: skill.name, instructions: skill.instructions };
  }
  tools.readSkill = createTool(
    Object.freeze({
      id: "read_skill",
      description:
        "Read one of your skills (guidance for a kind of job, or a task the person taught or saved) before doing that job, then follow it with your other tools.",
      inputSchema: z.object({
        acknowledgement: z.string().min(1).max(200).describe("One short sentence shown before you start, e.g. Looking into it now."),
        name: z.string().min(1).max(120).describe("The skill's name")
      }),
      execute: (input, options) => readSkill(input, options)
    })
  );
  if (personal) {
    async function saveSkill({ name, description, instructions, replaces }) {
      const existing = replaces ? (await ownSkills()).find((skill) => skill.name.toLowerCase() === replaces.trim().toLowerCase()) : null;
      if (replaces && !existing) return { error: `There's no skill of theirs called "${replaces}".` };
      const skill = existing
        ? (await integrations.updateSkill(existing.id, { name, description, instructions }, call)).skill
        : await integrations.createSkill({ name, description, instructions }, call);
      return { status: existing ? "changed" : "saved", name: skill.name, note: "Don't run it now; offer a test run." };
    }
    tools.saveSkill = createTool(
      Object.freeze({
        id: "save_skill",
        description:
          "Save a new skill for the person, or change one of theirs (give its current name as `replaces`). Only when they've agreed. Never put passwords or codes in a skill.",
        inputSchema: z.object({
          name: z.string().min(1).max(80),
          description: z.string().min(1).max(240).describe("One line: what it does"),
          instructions: z
            .string()
            .min(1)
            .max(20000)
            .describe(
              "When it applies, what it needs, the steps, where to stop and check (paying, ordering, sending), and what never to do"
            ),
          replaces: z.string().max(80).optional()
        }),
        execute: (input, options) => saveSkill(input, options)
      })
    );
    async function deleteSkill({ name }) {
      const existing = (await ownSkills()).find((skill) => skill.name.toLowerCase() === name.trim().toLowerCase());
      if (!existing) return { error: `There's no skill of theirs called "${name}".` };
      await integrations.deleteSkill(existing.id, call);
      return { status: "deleted", name: existing.name };
    }
    tools.deleteSkill = createTool(Object.freeze({
      id: "delete_skill",
      description: "Delete one of the person's own skills, only when they asked for it.",
      inputSchema: z.object({ name: z.string().min(1).max(80) }),
      execute: (input, options) => deleteSkill(input, options)
    }));
  }
  return tools;
}
