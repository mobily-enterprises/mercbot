// When a timetable job runs next (scripts.js claims it then), in its own time zone (D-35, D-140).

/**
 * Every 15 minutes (on the quarter hours), every hour (at `at`'s minutes), every day (only on weekdays `days`, 0 =
 * Sunday, when given), every week (weekday `day`) or every month (on `dayOfMonth`, 1 to 28 or "last") at `at` in
 * `timeZone`: the next slot after `from`.
 */
export function nextSlot({ every, at = "00:00", day = 1, days = null, dayOfMonth = 1, timeZone = "UTC" }, from = new Date()) {
  const [hour, minute] = String(at).split(":").map(Number);
  if (every === "15min") {
    const next = new Date(from);
    next.setUTCSeconds(0, 0);
    next.setUTCMinutes(Math.floor(next.getUTCMinutes() / 15) * 15 + 15);
    return next;
  }
  if (every === "hour") {
    const next = new Date(from);
    next.setUTCSeconds(0, 0);
    next.setUTCMinutes(minute);
    if (next <= from) next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }
  const parts = (date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        weekday: "short"
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value])
    );
  /** Whether a local day (its parts) is one the job runs on. */
  const runsOn = (local) => {
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(local.weekday);
    if (every === "week") return weekday === Number(day);
    if (every === "month") {
      const last = new Date(Date.UTC(Number(local.year), Number(local.month), 0)).getUTCDate();
      return Number(local.day) === (dayOfMonth === "last" ? last : Math.min(Number(dayOfMonth), last));
    }
    return !Array.isArray(days) || !days.length || days.includes(weekday);
  };
  const local = parts(from);
  // A month's day comes within 62 days, whichever day and month it is.
  for (let offsetDays = 0; offsetDays < 63; offsetDays += 1) {
    const guess = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day) + offsetDays, hour, minute);
    // The zone's offset at that moment, so the slot is `at` on the local clock.
    const seen = parts(new Date(guess));
    const shift = Date.UTC(Number(seen.year), Number(seen.month) - 1, Number(seen.day), Number(seen.hour), Number(seen.minute)) - guess;
    const slot = new Date(guess - shift);
    if (slot > from && runsOn(parts(slot))) return slot;
  }
  return new Date(from.getTime() + 86400000);
}
