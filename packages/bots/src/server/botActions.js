// The bot's actions, each a write that goes through approvals.decide() first, and what
// the tools share with them: the calendar apps, how a time zone is said, an app's card and
// finding a routine.
import { connectedKey, sendOrSimulate } from "./connectedApps.js";
import * as github from "./githubApps.js";
import * as google from "./googleApps.js";
import * as microsoft from "./microsoftApps.js";
import { describeRun, nextRunAt } from "./routineSchedule.js";
import { MAIL_ACTIONS } from "./mailTools.js";
import { DRIVE_ACTIONS } from "./driveTools.js";
import { GITHUB_ACTIONS } from "./githubTools.js";
import { CONNECTOR_ACTIONS } from "./connectorTools.js";
import { SIGN_IN_CODE_ACTIONS } from "./signInCodes.js";
import { SEDNA_ACTIONS } from "./sednaActions.js";
import { FILE_ACTIONS } from "./fileTools.js";
import { ROOM_ACTIONS } from "./roomTools.js";
import { TABLE_ACTIONS } from "./tableTools.js";
import { additionsChange, changeRefusal, mayChangeBot } from "./botAdditions.js";

export const EMAIL_ADDRESS = /[^\s<>,;"]+@[^\s<>,;"]+\.[a-z]{2,}/iu;

/** Nine or more digits in a run (a phone or card number), not counting a date written as 2026-05-03. */
const hasLongNumber = (text) => [...String(text).matchAll(/\+?\d[\d\s().-]{7,}\d/gu)]
  .some(([found]) => !/^\d{4}-\d{2}-\d{2}/u.test(found) && found.replace(/\D/gu, "").length >= 9);

/**
 * What the home's common knowledge may never hold (D-113, the notebook's refusals before it): an email address or nine
 * or more digits, which everyone in the home and every bot would read; null when it holds neither. Vault passwords are
 * refused where a turn can read the vault (commonKnowledge.js).
 * @param {string} text
 */
export function commonKnowledgeRefusal(text) {
  if (EMAIL_ADDRESS.test(text) || hasLongNumber(text)) {
    return "That has contact or card details, which never go in the home's common knowledge. Leave them out.";
  }
  return null;
}
// Which code speaks to each calendar app (D-31).
export const CALENDARS = { "google-calendar": google, outlook: microsoft };

/** A time zone as people say it: Australia/Perth is "Perth time". */
export const zoneName = (zone) => (zone && zone !== "UTC" ? `${zone.split("/").pop().replace(/_/gu, " ")} time` : "UTC");

/**
 * An app as a chat row shows it: its logo, name and colour, from the catalogue.
 * @param {import("@local/integrations/server/types").Integrations} integrations
 * @param {string} pluginId
 */
export function appCard(integrations, pluginId) {
  const plugin = integrations.app(pluginId);
  return plugin
    ? { id: plugin.id, name: plugin.name, logo: plugin.logo, logoImage: plugin.logoImage, color: plugin.color, icon: plugin.icon }
    : { id: pluginId };
}

/**
 * The calendar account an action uses, and its app for the event row's logo and link.
 * @param {import("./types.js").AppAccess} access
 * @param {string} [account]
 */
async function calendarAccount({ integrations, call }, account) {
  const entry = await connectedKey({ integrations, call }, Object.keys(CALENDARS), "calendar", account);
  return { entry, app: appCard(integrations, entry.pluginId) };
}

/**
 * What a calendar change tells other people, as a test copy logs it instead (D-69): only a change
 * that reaches guests or an organiser has one, as only those ask first when the bot thought of them.
 */
const calendarEffect = (kind, summary, entry, details) => ({ kind, summary, details: { calendar: entry.account, ...details } });

/**
 * The chat's event row ("Added to your calendar", with a link to open the event), and what the
 * bot is told to report: times in the calendar's zone, the link, and each guest's answer.
 */
const calendarEvent = (text, detail, event, app) => {
  const guests = event.guests?.length
    ? `guests: ${event.guests.map((guest) => `${guest.email} (${guest.answer || "no answer yet"})`).join(", ")}`
    : "nobody invited";
  return {
    kind: "event",
    role: "system",
    body: {
      text,
      detail:
        `${detail} ${event.start} to ${event.end}${event.timeZone ? ` (${event.timeZone})` : ""}; ` +
        `${guests}.${event.link ? ` Link: ${event.link}` : ""}`,
      ...(event.link ? { link: event.link, linkText: "Open the event", app } : {})
    },
    result: { ...event, sayTimesAs: zoneName(event.timeZone) }
  };
};

// The bot's actions. Each write goes through approvals.decide() first: when the
// answer is "ask", the action is parked on a proceed / don't-proceed card instead of running.
export const ACTIONS = {
  // Calendar changes. One the person asked for in so many words ("invite ana@…", "take
  // it off") is theirs, so only their own approval rules can make it ask; one the bot thought of
  // asks when it reaches other people: guests, cancellations, answers to organisers.
  add_calendar_event: {
    reversible: (args) => args.personAsked || !args.attendees?.length,
    describe: ({ title, start, attendees }) =>
      `add "${title}" at ${start} to the person's calendar${attendees?.length ? `, inviting ${attendees.join(", ")}` : ""}`,
    question: ({ title, start, attendees }) =>
      `Shall I add "${title}" (${start.replace("T", " ")}) to your ` +
      `calendar${attendees?.length ? ` and invite ${attendees.join(", ")}` : ""}?`,
    async run(context, args) {
      const { entry, app } = await calendarAccount(context, args.account);
      const guests = args.attendees || [];
      const event = await sendOrSimulate(
        context,
        guests.length ? calendarEffect("calendar invitation", `the invitation to "${args.title}" for ${guests.join(", ")}`, entry, { guests }) : null,
        () => CALENDARS[entry.pluginId].addCalendarEvent(entry.key, args),
        () => ({ title: args.title, start: args.start, end: args.end, timeZone: args.timeZone, guests: guests.map((email) => ({ email })) })
      );
      return calendarEvent(`Added to your calendar: ${event.title}`, `Added "${event.title}" to ${entry.account}.`, event, app);
    }
  },
  change_calendar_event: {
    reversible: (args) => args.personAsked || (!args.guests && !args.attendees?.length),
    describe: ({ title, attendees }) =>
      `change "${title}" on the person's calendar${attendees?.length ? `, inviting ${attendees.join(", ")}` : ""}`,
    question: ({ title, start, attendees }) => {
      const changes = [
        start ? `move "${title}" to ${start.replace("T", " ")}` : `change "${title}"`,
        attendees?.length ? `invite ${attendees.join(", ")}` : ""
      ];
      return `Shall I ${changes.filter(Boolean).join(" and ")}?`;
    },
    async run(context, args) {
      const { entry, app } = await calendarAccount(context, args.account);
      const calendar = CALENDARS[entry.pluginId];
      const invited = args.attendees || [];
      const event = await sendOrSimulate(
        context,
        args.guests || invited.length
          ? calendarEffect("calendar update", `the change to "${args.title}" for its guests`, entry, { event: args.eventId, invited })
          : null,
        () => calendar.changeCalendarEvent(entry.key, args),
        // As the change would leave it, from the event as it is (a read) and what changes.
        async () => {
          const { eventId, calendarId, timeZone } = args;
          const current = await calendar.getCalendarEvent(entry.key, { eventId, calendarId, timeZone });
          const emails = [...new Set([...(current.attendees || []), ...invited])];
          return {
            title: args.title || current.title,
            start: args.start || current.start,
            end: args.end || current.end,
            timeZone,
            guests: emails.map((email) => ({ email }))
          };
        }
      );
      return calendarEvent(`Changed on your calendar: ${event.title}`, `Changed "${event.title}" in ${entry.account}.`, event, app);
    }
  },
  delete_calendar_event: {
    reversible: (args) => args.personAsked,
    describe: ({ title, guests }) => `remove "${title}" from the person's calendar${guests ? ", telling its guests it's cancelled" : ""}`,
    question: ({ title, start, guests }) =>
      `Shall I remove "${title}" (${String(start).slice(0, 16).replace("T", " ")}) from your ` +
      `calendar${guests ? " and tell its guests it's cancelled" : ""}?`,
    async run(context, args) {
      const { entry } = await calendarAccount(context, args.account);
      await sendOrSimulate(
        context,
        args.guests ? calendarEffect("calendar cancellation", `the cancellation of "${args.title}" for its guests`, entry, { event: args.eventId }) : null,
        () => CALENDARS[entry.pluginId].deleteCalendarEvent(entry.key, args)
      );
      const told = args.guests ? " Its guests were sent the calendar's cancellation, so it leaves their calendars too." : "";
      return {
        kind: "event",
        role: "system",
        body: { text: `Removed from your calendar: ${args.title}`, detail: `Removed "${args.title}" from ${entry.account}.${told}` },
        result: { removed: true, guestsSentCancellation: Boolean(args.guests) }
      };
    }
  },
  answer_invitation: {
    reversible: (args) => args.personAsked,
    describe: ({ title, answer }) => `answer ${answer} to the invitation "${title}"`,
    question: ({ title, answer }) => `Shall I ${answer === "maybe" ? "answer maybe to" : answer} the invitation "${title}"?`,
    async run(context, args) {
      const { entry } = await calendarAccount(context, args.account);
      await sendOrSimulate(
        context,
        calendarEffect("invitation answer", `the answer "${args.answer}" to the invitation "${args.title}"`, entry, { event: args.eventId }),
        () => CALENDARS[entry.pluginId].answerInvitation(entry.key, args)
      );
      const said = { accept: "Accepted", decline: "Declined", maybe: "Answered maybe to" }[args.answer];
      return {
        kind: "event",
        role: "system",
        body: {
          text: `${said} the invitation: ${args.title}`,
          detail: `${said} "${args.title}" in ${entry.account}; the organiser is told.`
        }
      };
    }
  },
  // A comment goes out under the person's name, so it always asks first.
  github_comment: {
    reversible: () => false,
    describe: ({ repo, number }) => `comment on GitHub ${repo}#${number} as the person`,
    question: ({ repo, number, text }) =>
      `Shall I post this comment on ${repo}#${number}? "${text.length > 300 ? `${text.slice(0, 300)}…` : text}"`,
    async run(context, args) {
      const entry = await connectedKey(context, "github", "GitHub");
      const comment = await sendOrSimulate(
        context,
        { kind: "GitHub comment", summary: `the comment on ${args.repo}#${args.number}`, details: { account: entry.account, repo: args.repo, number: args.number } },
        () => github.addComment(entry.key, args.repo, args.number, args.text),
        // Where it would be: the issue or pull request's own page (GitHub sends either one there).
        () => ({ link: `https://github.com/${args.repo}/issues/${args.number}` })
      );
      return {
        kind: "event",
        role: "system",
        body: {
          text: `Commented on ${args.repo}#${args.number}`,
          detail: `Posted the comment on ${args.repo}#${args.number}: ${comment.link}`
        }
      };
    }
  },
  use_web_page: {
    reversible: () => false,
    describe: ({ instruction }) => `on a web page: ${instruction}`,
    question: ({ instruction }) => `Shall I go ahead and ${instruction}?`,
    // The computer is the chat's (D-112): the bot's seat there.
    async run({ computer, computerId }, { instruction }) {
      const result = await computer.act(String(computerId), instruction);
      return {
        kind: "event",
        role: "system",
        body: { text: result.success ? `Done on the web page: ${instruction}` : `Couldn't do it on the web page: ${instruction}` }
      };
    }
  },
  // Routines can be paused, changed or deleted, so only a rule can make the bot ask first.
  create_routine: {
    reversible: () => true,
    describe: ({ name, schedule }) => `create a recurring routine "${name}" that runs ${schedule}`,
    question: ({ name, schedule }) => `Shall I set up "${name}" to run ${schedule}?`,
    async run({ work, call, chatBotId, userId }, args) {
      const nextRun = nextRunAt(args.cron, args.timezone);
      // A routine runs in the chat it was set up in, by its bot (D-36), as the person who set it up (R4).
      await work.createRoutine({
        chatBotId: String(chatBotId),
        madeBy: String(userId),
        name: args.name,
        schedule: args.schedule,
        instructions: args.instructions,
        cron: args.cron,
        timezone: args.timezone,
        // A routine set up paused (a template's, before the person says yes) doesn't run yet.
        enabled: args.paused !== "true",
        nextRunAt: args.paused === "true" ? null : nextRun,
        once: args.once === "true"
      }, call);
      return args.paused === "true" ? routineEvent("Created routine, paused", args, null) : routineEvent("Created routine", args, nextRun);
    }
  },
  update_routine: {
    reversible: () => true,
    describe: ({ routine }) => `change the routine "${routine}"`,
    question: ({ routine }) => `Shall I change "${routine}"?`,
    async run({ work, call, chatBotId, userId }, args) {
      const routine = await work.routineNamed(chatBotId, args.routine, call);
      if (!routine) return { kind: "event", role: "system", body: { text: `Couldn't find the routine ${args.routine}` } };
      const refusal = routineChangeRefusal(routine, args, userId);
      if (refusal) return { kind: "event", role: "system", body: { text: refusal, detail: `${refusal} Nothing was changed.` } };
      const update = {};
      for (const field of ROUTINE_FIELDS) {
        if (args[field]) update[field] = args[field];
      }
      // Starting a paused routine, or pausing one, when the person says so. Starting it
      // starts its count of failures in a row again.
      if (args.running === "true" || args.running === "false") update.enabled = args.running === "true";
      if (update.enabled === true) update.failures = 0;
      const next = { ...routine, ...update };
      const enabled = update.enabled ?? routine.enabled;
      update.nextRunAt = enabled && next.cron ? nextRunAt(next.cron, next.timezone) : null;
      await work.changeRoutine(routine.id, update, call);
      const said = update.enabled === true ? "Started routine" : update.enabled === false ? "Paused routine" : "Updated routine";
      return routineEvent(said, next, update.nextRunAt);
    }
  },
  // The bot's own additions (D-98, D-95), only when the person in its chat asked: always on a card showing them now and
  // after, whatever the person's rules, and saved as the person who said yes, who must be allowed to change them.
  change_additions: {
    alwaysAsks: true,
    reversible: () => false,
    describe: () => "change the bot's own additions",
    question: () => "Shall I change my additions to this?",
    async run({ bots, call, botId, userId }, { before, additions }) {
      const bot = await bots.get(String(botId), call);
      const refused = (text) => ({ kind: "event", role: "system", body: { text, detail: `${text} Nothing was changed.` } });
      if (!mayChangeBot(bot.made_by, userId, call)) return refused(changeRefusal(bot.name));
      // The card shows what they were; a change made since (in Details, or another card) is never overwritten.
      if (String(bot.additions || "") !== String(before || "")) {
        return refused(`${bot.name}'s additions changed after this card was made, so they were left as they are.`);
      }
      await bots.update(bot.id, additionsChange(additions), call);
      return {
        kind: "event",
        role: "system",
        body: {
          text: `Changed ${bot.name}'s additions`,
          detail: `Changed ${bot.name}'s additions as the card showed; they apply from the next reply.`
        }
      };
    }
  },
  // Something for the home's common knowledge (D-113), only when the person said yes on its card, whatever their rules:
  // written from the card itself (commonKnowledgeRepository.js addFromCard), as the person who said yes.
  share_common_knowledge: {
    alwaysAsks: true,
    reversible: () => true,
    describe: () => "tell every bot in the home",
    question: ({ text, home }) => `Shall I tell every bot in ${home || "the home"} that? "${text}"`,
    async run({ commonKnowledge, cardId, call }, { home }) {
      const added = await commonKnowledge.addFromCard(cardId, commonKnowledgeRefusal, call);
      if (added.refused) return { kind: "event", role: "system", body: { text: "Nothing was added", detail: `${added.refused} Nothing was added.` } };
      return {
        kind: "event",
        role: "system",
        body: {
          text: `Added to ${home || "the home"}'s common knowledge`,
          detail: `Every bot in ${home || "the home"} knows it from its next reply: "${added.entry.text}". ` +
            "It's in Settings, under Bots' common knowledge, where you and the home's owners and admins can remove it."
        }
      };
    }
  },
  // The rest of the mailbox: saved drafts, sorting, labels and forwarding (D-42).
  ...MAIL_ACTIONS,
  // The rest of the drive: making, changing, moving, copying, sharing and comments (D-42).
  ...DRIVE_ACTIONS,
  // The rest of GitHub: issues, pull requests, reviews, branches, labels, releases, runs, discussions (D-42).
  ...GITHUB_ACTIONS,
  // A change in an app that hosts its own connection point (D-34).
  ...CONNECTOR_ACTIONS,
  // A sign-in code the person said yes to, for a page outside a sign-in's chain (D-77).
  ...SIGN_IN_CODE_ACTIONS,
  // The home's Sedna, changed as the person's own Sedna user (D-94).
  ...SEDNA_ACTIONS,
  // A file copied or moved to another place, only once its person said yes on its card (D-120).
  ...FILE_ACTIONS,
  // A room a bot proposed, started only once its person said yes on its card (D-122).
  ...ROOM_ACTIONS,
  // A one-to-one extension or a new field of the home's tables, only once its person said yes on its card (D-130).
  ...TABLE_ACTIONS
};

/** What update_routine changes of a routine besides whether it runs. */
const ROUTINE_FIELDS = Object.freeze(["name", "schedule", "instructions", "cron", "timezone"]);

/**
 * Why the person may not make this change to a routine, or null (R4, D-112). A routine runs as the person who set it
 * up, so only they resume it or change it; anyone who can open its chat may pause it, as on its card
 * (chatRoutines.js). The same for a turn's update_routine and for a card answered later.
 * @param {{ name: string, madeBy?: string | number | null }} routine
 * @param {Record<string, string | undefined>} args update_routine's
 * @param {string | number | null | undefined} userId the person the turn works for
 */
export function routineChangeRefusal(routine, args, userId) {
  const pausing = args.running === "false" && !ROUTINE_FIELDS.some((field) => args[field]);
  if (pausing || (routine.madeBy != null && userId != null && String(routine.madeBy) === String(userId))) return null;
  return `Only the person who set up "${routine.name}" can resume or change it: it runs as them. Anyone in this chat can pause it.`;
}

/** The centred event line shows the words and the name; the model also gets the schedule and next run. */
function routineEvent(text, routine, nextRun) {
  const when = nextRun ? describeRun(nextRun, routine.timezone) : "not scheduled";
  return {
    kind: "event",
    role: "system",
    body: {
      text,
      icon: "routine",
      name: routine.name,
      detail: `${text} "${routine.name}": ${routine.schedule} (cron ${routine.cron} in ${routine.timezone}); next run ${when}.`
    }
  };
}

export const APPROVAL_OPTIONS = ["Go ahead", "Don't do it"];
