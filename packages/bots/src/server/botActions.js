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

export const EMAIL_ADDRESS = /[^\s<>,;"]+@[^\s<>,;"]+\.[a-z]{2,}/iu;
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
async function calendarAccount({ integrations, reach, call }, account) {
  const entry = await connectedKey({ integrations, reach, call }, Object.keys(CALENDARS), "calendar", account);
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
    // The computer is the conversation's, or in a group the bot's own one for that group (D-46).
    async run({ computer, conversationId, computerId = conversationId }, { instruction }) {
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
    async run({ work, call, botId, conversationId }, args) {
      const nextRun = nextRunAt(args.cron, args.timezone);
      // A routine runs in the conversation it was set up in (D-36), in its home.
      await work.createRoutine({
        botId: String(botId),
        conversationId: String(conversationId),
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
    async run({ work, call, conversationId }, args) {
      const routine = await work.routineNamed(conversationId, args.routine, call);
      if (!routine) return { kind: "event", role: "system", body: { text: `Couldn't find the routine ${args.routine}` } };
      const update = {};
      for (const field of ["name", "schedule", "instructions", "cron", "timezone"]) {
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
  // The rest of the mailbox: saved drafts, sorting, labels and forwarding (D-42).
  ...MAIL_ACTIONS,
  // The rest of the drive: making, changing, moving, copying, sharing and comments (D-42).
  ...DRIVE_ACTIONS,
  // The rest of GitHub: issues, pull requests, reviews, branches, labels, releases, runs, discussions (D-42).
  ...GITHUB_ACTIONS,
  // A change in an app that hosts its own connection point (D-34).
  ...CONNECTOR_ACTIONS,
  // A sign-in code the person said yes to, for a page outside a sign-in's chain (D-77).
  ...SIGN_IN_CODE_ACTIONS
};

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
