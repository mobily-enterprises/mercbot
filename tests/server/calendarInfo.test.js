import assert from "node:assert/strict";
import test from "node:test";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import * as google from "../../packages/bots/src/server/googleApps.js";
import * as microsoft from "../../packages/bots/src/server/microsoftApps.js";
import { turnDoubles } from "../support/botDoubles.mjs";

// The rest of reading calendars (D-42), against stand-ins for Google's and Graph's APIs.
function fakeApi(context, routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const match = Object.entries(routes).find(([part]) => String(url).includes(part));
    const [status, body] = match ? match[1] : [404, { error: { message: "not found" } }];
    return new Response(JSON.stringify(body), { status });
  };
  context.after(() => { globalThis.fetch = original; });
  return calls;
}

test("calendars are listed with whose they are, and a repeating event's dates come in the calendar's zone", async (context) => {
  const calls = fakeApi(context, {
    "/calendarList?minAccessRole": [200, { items: [{ id: "primary", primary: true, timeZone: "Australia/Perth" }] }],
    "/calendarList": [200, { items: [{ id: "pat@example.com", summary: "Pat", primary: true, timeZone: "Australia/Perth", accessRole: "owner" }, { id: "fam@group", summary: "Family", accessRole: "reader", selected: false }] }],
    "/events/r1/instances": [200, { items: [{ id: "r1_20261104", recurringEventId: "r1", summary: "Standup", start: { dateTime: "2026-11-04T09:00:00+08:00" }, end: { dateTime: "2026-11-04T09:15:00+08:00" } }] }],
    "/me/calendars": [200, { value: [{ id: "c1", name: "Calendar", isDefaultCalendar: true, canEdit: true, owner: { address: "pat@example.com" } }] }]
  });
  assert.deepEqual(await google.listCalendars("k"), [
    { id: "pat@example.com", name: "Pat", primary: true, timeZone: "Australia/Perth", access: "owner" },
    { id: "fam@group", name: "Family", timeZone: undefined, access: "reader", hidden: true }
  ]);
  const { timeZone, events } = await google.eventOccurrences("k", { eventId: "r1", from: "2026-11-01", to: "2026-11-08", timeZone: "UTC" });
  assert.equal(timeZone, "Australia/Perth");
  assert.deepEqual([events[0].title, events[0].repeats], ["Standup", "r1"]);
  assert.match(decodeURIComponent(calls.find((url) => url.includes("/instances"))), /timeMin=2026-11-01T00:00:00\+08:00/u);
  assert.deepEqual(await microsoft.listCalendars("k"), [{ id: "c1", name: "Calendar", primary: true, owner: "pat@example.com", access: "writer" }]);
});

test("availability merges busy times across calendars and gives the free gaps between", async (context) => {
  fakeApi(context, {
    "/calendarList": [200, { items: [{ id: "primary", primary: true, timeZone: "Australia/Perth" }] }],
    "/calendars/primary/events": [200, { items: [
      { id: "a", summary: "Standup", start: { dateTime: "2026-11-04T09:00:00+08:00" }, end: { dateTime: "2026-11-04T09:30:00+08:00" } },
      { id: "b", summary: "Review", start: { dateTime: "2026-11-04T09:15:00+08:00" }, end: { dateTime: "2026-11-04T10:00:00+08:00" } },
      { id: "c", summary: "Holiday", start: { date: "2026-11-04" }, end: { date: "2026-11-05" } },
      { id: "d", summary: "Focus (free)", transparency: "transparent", start: { dateTime: "2026-11-04T11:00:00+08:00" }, end: { dateTime: "2026-11-04T12:00:00+08:00" } },
      { id: "e", summary: "Lunch", start: { dateTime: "2026-11-04T12:30:00+08:00" }, end: { dateTime: "2026-11-04T13:30:00+08:00" } }
    ] }]
  });
  const integrations = {
    reachableAccounts: async () => [{ id: "1", pluginId: "google-calendar", name: "", label: "pat@example.com", status: "connected" }],
    connections: { accessToken: async () => ({ accessToken: "k" }) }
  };
  const { tools } = buildTools(turnDoubles({ approvals: {}, computer: null, integrations, homeId: "1", userId: "7", botId: "3", conversationId: "5" }));
  const result = await tools.calendarInfo.execute({ action: "availability", from: "2026-11-04T08:00", to: "2026-11-04T14:00", timezone: "Australia/Perth" });
  assert.equal(result.sayTimesAs, "Perth time");
  assert.deepEqual(result.busy, [{ from: "2026-11-04T09:00+08:00", to: "2026-11-04T10:00+08:00" }, { from: "2026-11-04T12:30+08:00", to: "2026-11-04T13:30+08:00" }]);
  assert.deepEqual(result.free.map((gap) => `${gap.from.slice(11, 16)}-${gap.to.slice(11, 16)}`), ["08:00-09:00", "10:00-12:30", "13:30-14:00"]);

  // A browser on UTC still gets the calendars' own zone, named, and is never asked which.
  const fromUtc = await tools.calendarInfo.execute({ action: "availability", from: "2026-11-04T08:00", to: "2026-11-04T14:00", timezone: "UTC" });
  assert.deepEqual([fromUtc.sayTimesAs, fromUtc.free[0].from], ["Perth time", "2026-11-04T08:00+08:00"]);
  assert.match(fromUtc.howToAnswer, /never ask which time zone/u);

  const found = await tools.calendarInfo.execute({ action: "search", words: "lunch", from: "2026-11-04T00:00", to: "2026-11-05T00:00", timezone: "Australia/Perth" });
  assert.deepEqual(found.calendars[0].events.map((event) => event.title), ["Lunch"]);
});
