// When an app's job runs, in words, for the Logic tab and the home's recurring tasks (D-132, D-140).
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** What a watch, or a job watching a table, runs on, in words: its records "are added", "change", or both. */
export const changesOn = (on) => ({ create: "are added", update: "change" })[on] || "are added or change";

/** When an app's job runs, in words: on its timetable, or when its table's records change. */
export function jobSchedule(settings = {}) {
  const watch = settings.watch;
  if (watch) return `When ${watch.tableLabel || watch.table || "a table"} records ${changesOn(watch.on)}`;
  const at = /^\d{2}:\d{2}$/u.test(String(settings.at || "")) ? settings.at : "00:00";
  const zone = settings.timeZone && settings.timeZone !== "UTC" ? ` (${settings.timeZone})` : " (UTC)";
  if (settings.every === "15min") return "Every 15 minutes";
  if (settings.every === "hour") return `Every hour at :${at.slice(3)}`;
  if (settings.every === "day") {
    const days = Array.isArray(settings.days) && settings.days.length && settings.days.length < 7 ? settings.days : null;
    const on = !days ? "Every day" : days.join() === "1,2,3,4,5" ? "Every weekday" : `Every ${days.map((day) => WEEKDAYS[day]).join(", ")}`;
    return `${on} at ${at}${zone}`;
  }
  if (settings.every === "week") return `Every ${WEEKDAYS[Number(settings.day ?? 1)] || "Monday"} at ${at}${zone}`;
  if (settings.every === "month") {
    const day = settings.dayOfMonth === "last" ? "the last day" : `day ${Number(settings.dayOfMonth ?? 1)}`;
    return `Every month on ${day} at ${at}${zone}`;
  }
  return "When the app runs it";
}
