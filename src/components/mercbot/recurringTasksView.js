import { nanoMoney } from "./accountApi.js";

// The words and groups of Settings → Recurring tasks (D-132): what each kind of task is called, when it last ran and
// runs next in a person's words, which tasks a filter keeps, and the tasks grouped by bot, apps' jobs last.

export const KIND_LABELS = Object.freeze({ routine: "Routine", watch: "Watch", job: "App job" });

/** The filters, in order: every task, one kind, or the ones paused or needing attention. */
export const FILTERS = Object.freeze([
  { value: "all", label: "All" },
  { value: "routine", label: "Routines" },
  { value: "watch", label: "Watches" },
  { value: "job", label: "App jobs" },
  { value: "paused", label: "Paused" },
  { value: "failing", label: "Needs attention" }
]);

/** Whether a filter keeps a task. */
export function kept(task, filter) {
  if (filter === "paused") return task.state === "paused";
  if (filter === "failing") return task.state === "failing";
  return filter === "all" || task.kind === filter;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const time = (date) => date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const sameDay = (a, b) => a.toDateString() === b.toDateString();

/**
 * A moment as a person says it, from now: "in 5 min", "in 3 h", "5 min ago", "today 07:00", "tomorrow 07:00",
 * "yesterday 18:30", "Mon 07:00" within a week, else "12 Nov".
 * @param {string | null} at
 * @param {Date} [now]
 */
export function whenWords(at, now = new Date()) {
  if (!at) return "";
  const date = new Date(at);
  const gap = date.getTime() - now.getTime();
  const away = Math.abs(gap);
  if (away < MINUTE) return gap >= 0 ? "now" : "just now";
  if (away < HOUR) return gap > 0 ? `in ${Math.round(away / MINUTE)} min` : `${Math.round(away / MINUTE)} min ago`;
  if (away < 6 * HOUR) return gap > 0 ? `in ${Math.round(away / HOUR)} h` : `${Math.round(away / HOUR)} h ago`;
  if (sameDay(date, now)) return `today ${time(date)}`;
  if (sameDay(date, new Date(now.getTime() + DAY))) return `tomorrow ${time(date)}`;
  if (sameDay(date, new Date(now.getTime() - DAY))) return `yesterday ${time(date)}`;
  if (away < 6 * DAY) return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time(date)}`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** A task's cost line: "$0.08 · 30 runs", "No cost yet" when nothing is counted, "" when the person can't see it. */
export function costWords(task) {
  if (task.kind === "job") return "Runs without AI";
  if (!task.cost) return "";
  if (!task.cost.nano && !task.cost.runs) return "No cost yet";
  const runs = task.cost.runs ? ` · ${task.cost.runs} run${task.cost.runs === 1 ? "" : "s"}` : "";
  return `${nanoMoney(task.cost.nano)}${runs}`;
}

/**
 * The top line: how many tasks are running, paused and need attention, and what the tasks the person sees the cost
 * of cost in the last 30 days.
 * @param {{ tasks: object[], others: { count: number, costNano: number } | null, notListedNano: number }} list
 */
export function summaryParts(list) {
  const count = (state) => list.tasks.filter((task) => task.state === state).length;
  const parts = [`${count("running")} running`];
  if (count("paused")) parts.push(`${count("paused")} paused`);
  if (count("failing")) parts.push(`${count("failing")} need${count("failing") === 1 ? "s" : ""} attention`);
  const spent = list.tasks.reduce((total, task) => total + (task.cost?.nano || 0), 0) + (list.others?.costNano || 0) + (list.notListedNano || 0);
  return { parts, spent: nanoMoney(spent) };
}

/**
 * The tasks a filter keeps, grouped by bot in the order the home lists its bots (by name), apps' jobs last, each
 * group's tasks by name; or, sorted by cost, one group of every task, the costliest first.
 * @param {object[]} tasks
 * @param {{ filter: string, bot: string, sort: "bot" | "cost" }} view
 * @returns {Array<{ key: string, bot: object | null, title: string, tasks: object[] }>}
 */
export function groupsOf(tasks, { filter, bot, sort }) {
  const shown = tasks.filter((task) => kept(task, filter) && (!bot || task.bot?.id === bot));
  if (sort === "cost") {
    const costly = [...shown].sort((a, b) => (b.cost?.nano || 0) - (a.cost?.nano || 0) || a.name.localeCompare(b.name));
    return costly.length ? [{ key: "cost", bot: null, title: "By cost, last 30 days", tasks: costly }] : [];
  }
  const groups = new Map();
  for (const task of shown) {
    const key = task.bot ? `bot:${task.bot.id}` : "apps";
    if (!groups.has(key)) groups.set(key, { key, bot: task.bot, title: task.bot ? task.bot.name : "Apps' jobs", tasks: [] });
    groups.get(key).tasks.push(task);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, tasks: group.tasks.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => (a.key === "apps") - (b.key === "apps") || a.title.localeCompare(b.title));
}
