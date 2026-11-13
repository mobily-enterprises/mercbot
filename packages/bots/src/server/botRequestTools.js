import { createTool } from "@jskit-ai/agent/server";
import { goalTools } from "@jskit-ai/agent-runtime/server";
import { z } from "zod";

/**
 * Working with the home's other bots: passing a task on, asking one and using its
 * answer, and answering one's request (D-46). A multi-step job's goal tools (D-48) come between.
 * @param {object} shared
 * @param {import("./types.js").HandOff} shared.handOff
 * @param {import("./types.js").RequestTools} shared.requestTools
 * @param {import("@jskit-ai/agent-runtime/server/types").AgentGoalOperations | null} shared.goalOperations
 */
export function buildBotRequestTools({ handOff, requestTools, goalOperations }) {
  const tools = {};
  /** Passing a task to another of the person's bots; it answers in its own chat. */
  async function messageBot({ bot, task }) {
    const result = await handOff(bot, task.trim());
    if (result.error) return { error: result.error };
    return {
      status: "passed on",
      note: `Say in one line that you've passed it to ${result.target.name}, who will answer them in its own chat.`
    };
  }
  tools.messageBot = createTool(
    Object.freeze({
      id: "message_bot",
      description:
        'Pass a task to another of the person\'s bots, by its name, when they ask you to ("ask Ledger to work out…"). That bot ' +
        "does the work and answers them in its own chat: pass the task itself with the details it needs, and don't work it out or answer it yourself.",
      inputSchema: z.object({
        bot: z.string().min(1).max(60).describe("The other bot's name"),
        task: z.string().min(5).max(2000)
      }),
      execute: (input, options) => messageBot(input, options)
    })
  );

  // Goals (D-48, after DeepSeek Harness P5): a multi-step job keeps going in rounds until it's done.
  if (goalOperations) Object.assign(tools, goalTools(goalOperations));

  /**
   * Asking another bot and using its answer (D-46): the request shows as a card in both chats, the
   * other bot works on it in the person's chat with it, and its answer comes back here.
   */
  async function askBot({ bot, brief }) {
    const result = await requestTools.ask(bot, brief.trim());
    if (result.error) return { error: result.error };
    return {
      status: "asked",
      note:
        `Say in one line that you've asked ${result.target.name} and will carry on when it answers. Don't do the work yourself ` +
        `meanwhile.`
    };
  }
  tools.askBot = createTool(
    Object.freeze({
      id: "ask_bot",
      description:
        "Ask another bot in this home to do something for the person and wait for its answer, when you need its result to finish the person's request (\"get Otto to build an app for…\", \"ask Ledger for the totals and put them in my report\"). Give a clear, complete brief with every detail it needs: it can't see this chat. Then stop: its answer comes back to you here, and you carry on. Use message_bot instead when the person just wants the other bot to deal with it and answer them itself.",
      inputSchema: z.object({
        bot: z.string().min(1).max(60).describe("The other bot's name"),
        brief: z.string().min(5).max(2000).describe("What you need from it, with every detail it needs")
      }),
      execute: (input, options) => askBot(input, options)
    })
  );
  if (requestTools.answer) {
    async function answerRequest({ answer }) {
      return requestTools.answer(answer.trim());
    }
    tools.answerRequest = createTool(
      Object.freeze({
        id: "answer_request",
        description:
          "Send your finished result back to the bot that asked you (see the request at the top of this turn). Make it complete enough to use without asking again: what you did, names, links, numbers.",
        inputSchema: z.object({ answer: z.string().min(1).max(4000) }),
        execute: (input, options) => answerRequest(input, options)
      })
    );
    async function askBack({ question }) {
      return requestTools.askBack(question.trim());
    }
    tools.askBack = createTool(Object.freeze({
      id: "ask_back",
      description: "Ask the bot that asked you one clear question you can't go on without. Then stop and wait for its answer.",
      inputSchema: z.object({ question: z.string().min(5).max(600) }),
      execute: (input, options) => askBack(input, options)
    }));
  }
  if (requestTools.answerBot) {
    async function answerBot({ answer }) {
      return requestTools.answerBot(answer.trim());
    }
    tools.answerBot = createTool(Object.freeze({
      id: "answer_bot",
      description: "Answer the question a bot you asked has put to you, so it can carry on.",
      inputSchema: z.object({ answer: z.string().min(1).max(2000) }),
      execute: (input, options) => answerBot(input, options)
    }));
  }
  return tools;
}
