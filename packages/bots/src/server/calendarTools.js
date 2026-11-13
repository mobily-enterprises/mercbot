import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import { CALENDARS, zoneName } from "./botActions.js";
import { connectedKey, connectedKeys, localTime, zoned } from "./connectedApps.js";
import * as google from "./googleApps.js";

// Calendars of one family often show the same shared events, which says nothing about whose each
// account is, so the label check is left to mail.
// The person's times are in the one zone the calendar tools give, named once.
const ONE_ZONE =
  "Times are in the person's own zone, named in sayTimesAs; never ask which time zone they mean, even when their browser or an account says UTC.";
const SEVERAL_CALENDARS =
  "Start with one line naming each calendar account you checked, by label and address. Then answer in one section per account, headed with its address, with times as given, naming the zone once in the words of sayTimesAs (e.g. all times Perth time). Say you changed nothing in any of them. Two accounts showing the same shared events is normal; don't question their labels because of it.";
const NOT_OWN =
  "None of the connected calendars is clearly the person's own, so don't guess. List the calendars you can reach, each with whose it is judging by its address, say you'll add it once you know which, and ask with ask_with_options: one card whose options are only those calendars, each with whose it is, plus connecting another one; no times or time zones in it.";

/**
 * The person's connected calendars (D-42): reading them, and adding, changing, removing
 * and answering events, each change through attempt(), with the fields and failure handling the
 * other connected-account tools use too.
 * @param {object} shared
 * @param {import("./types.js").TurnRepository} shared.turns records.turns
 * @param {import("./types.js").CallOptions} shared.call the turn's call options
 * @param {import("@local/integrations/server/types").Integrations} shared.integrations
 * @param {import("./types.js").Reach} shared.reach
 * @param {string} shared.conversationId
 * @param {string[]} shared.removed
 * @param {import("./types.js").AppFor} shared.appFor
 * @param {import("./types.js").AttemptAction} shared.attempt
 * @param {import("./types.js").PostLead} shared.postLead
 * @param {import("./types.js").InTime} shared.inTime
 * @param {import("./types.js").ToolFailure} shared.failed
 * @param {import("./types.js").AccountField} shared.account
 * @param {import("zod").ZodType} shared.statusLine
 * @param {import("zod").ZodType} shared.personAsked
 * @param {(toolId: string, apps: object, name: string, wanted: string | undefined, notOwn: string) => Promise<object>} shared.pickOwn
 */
export function buildCalendarTools({
  turns,
  call,
  integrations,
  reach,
  conversationId,
  removed,
  appFor,
  attempt,
  postLead,
  inTime,
  failed,
  account,
  statusLine,
  personAsked,
  pickOwn
}) {
  const tools = {};
  const zone = (what) => z.string().min(1).max(64).describe(what);
  // The person's zone for every calendar: their primary Google calendar's own zone, where
  // their events live, when it has a real one; otherwise the one their browser gave. So Outlook,
  // which reports UTC, shows the same times as Google, and the bot never asks which zone is meant.
  let calendarHome;
  const zoneFor = async (given) => {
    calendarHome ??= connectedKeys({ integrations, reach, call }, ["google-calendar"], "calendar")
      .then((keys) => Promise.all(keys.map((entry) => google.listCalendars(entry.key).catch(() => []))))
      .then(
        (lists) =>
          lists.flat().find((calendar) => calendar.primary && calendar.timeZone && !/^(Etc\/)?(UTC|GMT)$/iu.test(calendar.timeZone))
            ?.timeZone
      )
      .catch(() => undefined);
    return (await calendarHome) || given;
  };
  async function calendarEvents({ acknowledgement, from, to, timezone, account: wanted }) {
    try {
      timezone = await zoneFor(timezone);
      await postLead(acknowledgement, "calendar_events");
      const accounts = await connectedKeys(appFor("calendar_events"), Object.keys(CALENDARS), "calendar", wanted);
      const read = await inTime(
        Promise.all(
          accounts.map(async (entry) => {
            const found = await CALENDARS[entry.pluginId].calendarEvents(entry.key, { from, to, timeZone: timezone });
            return { account: entry.account, ...found, sayTimesAs: zoneName(found.timeZone) };
          })
        ),
        "Reading the calendar"
      );
      return read.length > 1
        ? { calendars: read, howToAnswer: `${SEVERAL_CALENDARS} ${ONE_ZONE}` }
        : { calendars: read, howToAnswer: ONE_ZONE };
    } catch (error) {
      return failed(error);
    }
  }
  tools.calendarEvents = createTool(
    Object.freeze({
      id: "calendar_events",
      description:
        "List the events on the person's connected calendars (Google Calendar or Outlook; every calendar in every connected account unless you name one) between two local times, to see their schedule, check for clashes, or find an event to change, remove or answer. Each account's times are in its own time zone, given in the result; events with blocksTime false (holidays, events marked free) don't take up their time.",
      inputSchema: z.object({
        acknowledgement: statusLine,
        from: z.string().min(10).max(25).describe("Start, local time, e.g. 2026-10-28T00:00"),
        to: z.string().min(10).max(25).describe("End, local time, e.g. 2026-10-29T00:00"),
        timezone: zone("The person's IANA time zone from the Current state note; a Google calendar uses its own"),
        account: account("One connected account, by its address or label; leave out to use them all")
      }),
      execute: (input, options) => calendarEvents(input, options)
    })
  );
  // The rest of reading calendars (D-42): the calendars themselves, one event, the occurrences of
  // a repeating one, the person's busy and free times, and events found by words. Each action is
  // its own switch in Connect apps ("calendar_info.availability").
  const infoActions = ["calendars", "event", "occurrences", "availability", "search"].filter(
    (name) => !removed.includes(`calendar_info.${name}`)
  );
  if (infoActions.length) {
    async function calendarInfo({ action, acknowledgement, from, to, eventId, calendarId, words, timezone, account: wanted }) {
      try {
        timezone = await zoneFor(timezone);
        if (["occurrences", "availability", "search"].includes(action) && (!from || !to)) return { error: "Give from and to." };
        if (["event", "occurrences"].includes(action) && !eventId) return { error: "Give the eventId." };
        if (action === "search" && !words?.trim()) return { error: "Give the words to look for." };
        await postLead(acknowledgement, "calendar_info");
        const app = appFor(`calendar_info.${action}`);
        if (action === "event" || action === "occurrences") {
          const entry = await connectedKey(app, Object.keys(CALENDARS), "calendar", wanted);
          const calendar = CALENDARS[entry.pluginId];
          if (action === "event") {
            return {
              account: entry.account,
              event: await calendar.getCalendarEvent(entry.key, { eventId, calendarId, timeZone: timezone })
            };
          }
          const found = await calendar.eventOccurrences(entry.key, { eventId, calendarId, from, to, timeZone: timezone });
          return { account: entry.account, ...found, sayTimesAs: zoneName(found.timeZone) };
        }
        const accounts = await connectedKeys(app, Object.keys(CALENDARS), "calendar", wanted);
        if (action === "calendars") {
          return {
            accounts: await inTime(
              Promise.all(
                accounts.map(async (entry) => ({
                  account: entry.account,
                  calendars: await CALENDARS[entry.pluginId].listCalendars(entry.key)
                }))
              ),
              "Reading the calendars"
            )
          };
        }
        const read = await inTime(
          Promise.all(
            accounts.map(async (entry) => ({
              account: entry.account,
              ...(await CALENDARS[entry.pluginId].calendarEvents(entry.key, { from, to, timeZone: timezone }))
            }))
          ),
          "Reading the calendar"
        );
        if (action === "search") {
          const wantedWords = words.toLowerCase().split(/\s+/u).filter(Boolean);
          const matches = (event) =>
            wantedWords.every((word) => `${event.title} ${event.location || ""} ${event.calendar || ""}`.toLowerCase().includes(word));
          return {
            calendars: read.map(({ account: name, timeZone, events }) => ({
              account: name,
              sayTimesAs: zoneName(timeZone),
              events: events.filter(matches)
            }))
          };
        }
        // Busy is every timed event that takes up time, in any calendar; free is what's left.
        const zoneUsed = read[0]?.timeZone || timezone;
        const busy = read
          .flatMap(({ events }) => events)
          .filter((event) => !event.allDay && event.blocksTime !== false && event.myAnswer !== "declined")
          .map((event) => [Date.parse(event.start), Date.parse(event.end)])
          .filter(([start, end]) => start < end)
          .sort((a, b) => a[0] - b[0])
          .reduce((merged, [start, end]) => {
            const last = merged.at(-1);
            if (last && start <= last[1]) last[1] = Math.max(last[1], end);
            else merged.push([start, end]);
            return merged;
          }, []);
        const [windowStart, windowEnd] = [Date.parse(zoned(from, zoneUsed)), Date.parse(zoned(to, zoneUsed))];
        const free = [];
        let cursor = windowStart;
        for (const [start, end] of busy) {
          if (start > cursor) free.push([cursor, Math.min(start, windowEnd)]);
          cursor = Math.max(cursor, end);
        }
        if (cursor < windowEnd) free.push([cursor, windowEnd]);
        const shown = ([start, end]) => ({ from: localTime(start, zoneUsed), to: localTime(end, zoneUsed) });
        return {
          checked: read.map((entry) => entry.account),
          sayTimesAs: zoneName(zoneUsed),
          busy: busy.map(shown),
          free: free.filter(([start, end]) => end > start).map(shown),
          howToAnswer: ONE_ZONE
        };
      } catch (error) {
        return failed(error);
      }
    }
    tools.calendarInfo = createTool(
      Object.freeze({
        id: "calendar_info",
        description:
          "More from the person's connected calendars (every account unless you name one): calendars lists them with whose they are; event reads one by id (and calendarId) from calendar_events; occurrences lists the dates of a repeating event (its repeats id) between from and to; availability gives the person's busy times and the free gaps between from and to, across all their calendars; search finds events whose title, place or notes contain words, between from and to.",
        inputSchema: z.object({
          action: z.enum(infoActions),
          acknowledgement: statusLine,
          from: z
            .string()
            .min(10)
            .max(25)
            .optional()
            .describe("Start, local time, e.g. 2026-10-28T09:00 (occurrences, availability, search)"),
          to: z.string().min(10).max(25).optional().describe("End, local time (occurrences, availability, search)"),
          eventId: z.string().max(1100).optional().describe("For event: its id; for occurrences: the repeats id"),
          calendarId: z.string().max(500).optional().describe("Its calendarId from calendar_events (Google)"),
          words: z.string().max(200).optional().describe("For search"),
          timezone: zone("The person's IANA time zone from the Current state note; a Google calendar uses its own"),
          account: account("One connected account, by its address or label; leave out to use them all")
        }),
        execute: (input, options) => calendarInfo(input, options)
      })
    );
  }
  const pickCalendar = (toolId, wanted) => pickOwn(toolId, CALENDARS, "calendar", wanted, NOT_OWN);
  /**
   * A calendar the person described ("my work calendar", "Kim's calendar") must be one whose name
   * or address says so; otherwise the bot asks first and adds nothing. A pick on a question
   * card after their message is their answer, so the calendar they picked is used.
   */
  const describedCalendar = async () => {
    const latest = await turns.latestMessage(conversationId, { role: "user", kind: "text" }, call);
    const picked = await turns.latestMessage(conversationId, { kind: "choice", answeredQuestion: true, ...(latest ? { afterId: String(latest.id) } : {}) }, call);
    if (picked) return "";
    const said = String(latest?.body?.text || "");
    const kind = /\b(?:my|our|the)\s+([a-z]+)\s+calendar\b/iu.exec(said)?.[1]?.toLowerCase();
    if (kind && !["own", "main", "primary", "usual", "normal", "personal"].includes(kind)) return kind;
    return /\b([A-Z][a-z]+)'s\s+calendar\b/u.exec(said)?.[1]?.toLowerCase() || "";
  };
  const hourLater = (start) => new Date(Date.parse(`${start.slice(0, 16)}:00Z`) + 3600000).toISOString().slice(0, 16);
  // One event goes in one calendar: a second add of it in the same reply is refused.
  const added = new Map();
  async function addCalendarEvent({ acknowledgement, timezone, end, ...input }) {
    try {
      timezone = await zoneFor(timezone);
      const same = `${input.title.toLowerCase()}|${input.start}`;
      if (added.has(same)) {
        return { error: `You already added this event in this reply, to ${added.get(same)}. One event goes in one calendar.` };
      }
      const entry = await pickCalendar("add_calendar_event", input.account);
      const described = await describedCalendar();
      if (described && !entry.account.toLowerCase().includes(described)) {
        const all = await connectedKeys(appFor("add_calendar_event"), Object.keys(CALENDARS), "calendar").catch(() => []);
        return {
          error:
            `Nothing was added. The person asked for their "${described}" calendar, and none of the connected calendars is clearly ` +
            `that: ${all.map((key) => key.account).join("; ")}. Don't guess: ask which with ask_with_options, one card whose options ` +
            `are only these calendars, each with whose it is, plus connecting another one. No times or time zones in the card: the ` +
            `time stays as they said it. Add nothing until they pick; their pick is the answer, so then add it straight away.`
        };
      }
      added.set(same, entry.account);
      const outcome = await attempt(
        "add_calendar_event",
        {
          ...input,
          end: end || hourLater(input.start),
          account: entry.account,
          timeZone: timezone,
          attendees: input.attendees || []
        },
        acknowledgement
      );
      // The time is said once, in the zone named by sayTimesAs, without musing about others.
      const said =
        outcome.status === "done"
          ? { ...outcome, note: "Say the time once, in the words of sayTimesAs; don't wonder about other time zones." }
          : outcome;
      return end ? said : { ...said, lengthGuessed: "one hour" };
    } catch (error) {
      return failed(error);
    }
  }
  tools.addCalendarEvent = createTool(
    Object.freeze({
      id: "add_calendar_event",
      description:
        'Add a new event to one of the person\'s connected calendars (Google Calendar or Outlook). For "my calendar", leave ' +
        "account out: the tool itself picks the person's own primary calendar, even when their address is connected in two apps, so don't ask which. Name an account only for someone else's calendar, or when the person names one. Check for clashes with calendar_events first. Invite people only when the person asked you to. To invite someone to an event that already exists, or move it, use change_calendar_event instead.",
      inputSchema: z.object({
        acknowledgement: statusLine,
        title: z.string().min(1).max(200),
        start: z.string().min(16).max(25).describe("Local start time in the account's time zone, e.g. 2026-10-28T13:00"),
        end: z.string().min(16).max(25).optional().describe("Local end time; leave out for one hour, and then say you guessed the length"),
        timezone: zone("The person's IANA time zone from the Current state note; a Google calendar uses its own"),
        location: z.string().max(300).optional(),
        description: z.string().max(2000).optional(),
        attendees: z.array(z.string().email()).max(20).optional().describe("Email addresses to invite"),
        account: account("Whose calendar, by its address or label; leave out for the person's own"),
        personAsked
      }),
      execute: (input, options) => addCalendarEvent(input, options)
    })
  );
  // Changing, removing and answering start from an event found with calendar_events, which is
  // read again here so the card says what it really is.
  const eventInput = {
    acknowledgement: statusLine,
    account: account("The connected calendar account the event is in, by its address or label; leave out for the person's own"),
    eventId: z.string().min(1).max(1100).describe("The event's id from calendar_events"),
    calendarId: z.string().max(500).optional().describe("Its calendarId from calendar_events (Google)"),
    timezone: zone("The person's IANA time zone from the Current state note"),
    personAsked
  };
  const findEvent = async (toolId, { account: wanted, eventId, calendarId, timezone: given, personAsked: asked }) => {
    const timezone = await zoneFor(given);
    const entry = await pickCalendar(toolId, wanted);
    const event = await CALENDARS[entry.pluginId].getCalendarEvent(entry.key, { eventId, calendarId, timeZone: timezone });
    return {
      event,
      base: {
        account: entry.account,
        eventId,
        calendarId,
        timeZone: timezone,
        title: event.title,
        start: event.start,
        guests: event.attendees?.length || 0,
        personAsked: Boolean(asked)
      }
    };
  };
  async function changeCalendarEvent({ acknowledgement, title, start, end, location, description, attendees, ...which }) {
    try {
      const { base } = await findEvent("change_calendar_event", which);
      return await attempt(
        "change_calendar_event",
        { ...base, title: title || base.title, start, end, location, description, attendees: attendees || [] },
        acknowledgement
      );
    } catch (error) {
      return failed(error);
    }
  }
  tools.changeCalendarEvent = createTool(
    Object.freeze({
      id: "change_calendar_event",
      description:
        "Change an event on the person's connected calendar: move it, rename it, change its place or notes, or invite more people to it. Give only what changes.",
      inputSchema: z.object({
        ...eventInput,
        title: z.string().min(1).max(200).optional().describe("A new title"),
        start: z.string().min(16).max(25).optional().describe("New local start time"),
        end: z.string().min(16).max(25).optional().describe("New local end time"),
        location: z.string().max(300).optional(),
        description: z.string().max(2000).optional(),
        attendees: z.array(z.string().email()).max(20).optional().describe("Email addresses to add as guests")
      }),
      execute: (input, options) => changeCalendarEvent(input, options)
    })
  );
  async function deleteCalendarEvent({ acknowledgement, ...which }) {
    try {
      const { base } = await findEvent("delete_calendar_event", which);
      return await attempt("delete_calendar_event", base, acknowledgement);
    } catch (error) {
      return failed(error);
    }
  }
  tools.deleteCalendarEvent = createTool(
    Object.freeze({
      id: "delete_calendar_event",
      description:
        "Remove an event from the person's connected calendar, when they ask. For an event with guests, the calendar sends them its cancellation.",
      inputSchema: z.object(eventInput),
      execute: (input, options) => deleteCalendarEvent(input, options)
    })
  );
  async function answerInvitation({ acknowledgement, answer, ...which }) {
    try {
      const { event, base } = await findEvent("answer_invitation", which);
      if (event.organiser === "the person") {
        return { error: "The person organised this event themselves, so there's no invitation to answer." };
      }
      return await attempt("answer_invitation", { ...base, answer }, acknowledgement);
    } catch (error) {
      return failed(error);
    }
  }
  tools.answerInvitation = createTool(
    Object.freeze({
      id: "answer_invitation",
      description:
        "Accept, decline or answer maybe to an invitation on the person's connected calendar (an event someone else organised); the organiser is told.",
      inputSchema: z.object({ ...eventInput, answer: z.enum(["accept", "decline", "maybe"]) }),
      execute: (input, options) => answerInvitation(input, options)
    })
  );
  return tools;
}
