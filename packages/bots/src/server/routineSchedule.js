import { Cron } from "croner";

// A routine's schedule is a five-field cron pattern in the person's time zone.
const MIN_INTERVAL_MINUTES = 10;

export function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return Boolean(value);
  } catch {
    return false;
  }
}

/** Returns a reason the schedule can't be used, or "" when it's fine. */
export function scheduleProblem(cron, timeZone) {
  if (String(cron).trim().split(/\s+/u).length !== 5) return "The cron pattern needs exactly five fields: minute hour day month weekday.";
  if (!validTimeZone(timeZone)) return `"${timeZone}" isn't a time zone name like Europe/London or UTC.`;
  let runs;
  try {
    runs = new Cron(cron, { timezone: timeZone }).nextRuns(4);
  } catch (error) {
    return `That cron pattern doesn't work: ${error.message}`;
  }
  if (!runs.length) return "That schedule never runs.";
  for (let index = 1; index < runs.length; index += 1) {
    if (runs[index] - runs[index - 1] < MIN_INTERVAL_MINUTES * 60000) {
      return `Routines can run at most every ${MIN_INTERVAL_MINUTES} minutes.`;
    }
  }
  return "";
}

/** The next run as the ISO time a routine stores, or null when the schedule has none. */
export function nextRunAt(cron, timeZone, after = new Date()) {
  return new Cron(cron, { timezone: timeZone }).nextRun(after)?.toISOString() ?? null;
}

/** The next run as a clock time with its time zone, e.g. "Monday, October 27 at 9:00 AM UTC". */
export function describeRun(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(date));
}
