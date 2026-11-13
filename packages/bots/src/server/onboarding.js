// Scripted first conversation (D-10). Each step appends messages and names the next step;
// the client waits the step's delay, then asks the server to advance.
import { writeFirstQuestion, writeGreeting } from "./botWriting.js";
import { isModelFailure, modelFailure } from "./modelFailures.js";

export const DEFAULT_BOT_NAME = "Mercbot";
export const DEFAULT_BOT_COLOR = "#1C1C1C";
const NAME_IDEAS = ["Juno", "Milo", "Iris", "Otto", "Nova", "Remy", "Ada", "Tansy", "Wren", "Theo"];

function pickNameOptions(random = Math.random) {
  const pool = [...NAME_IDEAS];
  const picked = [];
  while (picked.length < 2) {
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return [...picked, DEFAULT_BOT_NAME];
}

export function firstNameOf(displayName) {
  const first = String(displayName || "").trim().split(/[\s@._-]+/u)[0] || "";
  return first ? first[0].toUpperCase() + first.slice(1) : "there";
}

const text = (body) => ({ kind: "text", role: "bot", body });

// step -> (context) => { messages, next, rename? }
export const ONBOARDING_STEPS = {
  start: ({ firstName }) => ({
    next: "ask-name",
    messages: [
      text({ text: `Good to have you here, ${firstName}. From now on I'll be looking after things for you, at work and at home.` }),
      {
        kind: "choice",
        role: "bot",
        body: {
          purpose: "bot-name",
          question: "First things first: pick a name for me. You're free to rename me any time.",
          options: pickNameOptions(),
          chosen: null
        }
      }
    ]
  }),
  confirm: ({ firstName, chosenName }) => ({
    next: "rename",
    messages: [text({ text: `${chosenName} it is. Nice to meet you properly, ${firstName}!` })]
  }),
  rename: ({ chosenName }) => ({
    next: "about",
    rename: chosenName,
    messages: [{ kind: "event", role: "system", body: { text: `Renamed to ${chosenName}` } }]
  }),
  about: () => ({
    next: "connect",
    messages: [
      text({
        heading: "A bit about how I work:",
        bullets: [
          "I keep going on my own computer while you're away.",
          "I can link up with your apps, like email and calendar, and use them the way you would."
        ]
      }),
      text({
        text:
          "Want to connect your email so I can find something to take off your plate straight away? I'll never send anything without your OK. Or just tell me what you need a hand with."
      })
    ]
  }),
  connect: () => ({
    next: "settle",
    messages: [
      {
        kind: "connect",
        role: "bot",
        body: {
          app: "Gmail",
          subtitle: "Let your bot read and draft email for you",
          footnote: "Your bot always checks with you before changing anything, and you can disconnect at any time."
        }
      }
    ]
  }),
  settle: () => ({ next: "await-nudge", messages: [] }),
  "await-nudge": () => ({
    next: null,
    messages: [text({ text: "Whenever you're ready, the Gmail card above is still there to connect." })]
  }),

  // A bot made with New bot: a generated greeting, then a generated first question.
  "intro-greet": async ({ firstName, bot, model }) => {
    let greeting;
    try {
      greeting = model ? await writeGreeting(model, bot, firstName) : "";
    } catch (error) {
      if (isModelFailure(error)) console.warn(`Bot ${bot.id}'s welcome is the standard one: ${modelFailure(error)}`);
      greeting = "";
    }
    return {
      next: "intro-ask",
      messages: [text({ text: greeting || `Hi ${firstName}, I'm ${bot.name}. Happy to get started whenever you are.` })]
    };
  },
  "intro-ask": async ({ bot, model }) => {
    const multi = Math.random() < 0.5;
    let card;
    try {
      if (!model) throw new Error("No AI for the first question: the home's work is paused.");
      card = await writeFirstQuestion(model, bot, { multi });
    } catch (error) {
      if (isModelFailure(error)) console.warn(`Bot ${bot.id}'s first question is the standard one: ${modelFailure(error)}`);
      card = {
        question: "Where should I start helping?",
        options: ["Research a topic", "Keep an eye on prices", "Sort out bookings"],
        multi
      };
    }
    return {
      next: null,
      messages: [
        {
          kind: "choice",
          role: "bot",
          body: {
            purpose: "first-task",
            question: card.question,
            subline: multi ? "Pick as many as you like" : "",
            multi,
            options: card.options,
            openOption: "Something else",
            chosen: null
          }
        }
      ]
    };
  }
};

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ pickNameOptions });
