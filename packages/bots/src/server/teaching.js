/**
 * Teach a task: the recorded demonstration as plain lines for the model, and a one-line
 * summary of what the bot saw.
 */
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
};

export function demoLines(events = []) {
  return events.map((event) => {
    const what = event.label ? `"${event.label}"` : `a ${event.role || event.tag || "element"}`;
    if (event.type === "navigate") return `${event.at}s: opened ${event.url}`;
    if (event.type === "page") return `${event.at}s: page loaded: ${event.title ? `"${event.title}" ` : ""}(${event.url})`;
    if (event.type === "click") {
      return (
        `${event.at}s: clicked ${event.tag === "a" ? "link" : event.role || event.tag} ` +
        `${what}${event.href ? ` (${event.href})` : ""} on ${hostOf(event.url)}`
      );
    }
    if (event.type === "input") return `${event.at}s: typed "${event.value}" into ${what} on ${hostOf(event.url)}`;
    if (event.type === "enter") return `${event.at}s: pressed Enter in ${what}${event.value ? ` (value "${event.value}")` : ""}`;
    return "";
  }).filter(Boolean);
}

/** Something happened beyond the page that was already open. */
export function demoHasSteps(events = []) {
  return events.some((event) => event.type === "click" || event.type === "input" || event.type === "enter" || event.type === "navigate");
}

export function demoSummary(events = []) {
  const pages = events.filter((event) => event.type === "page" || event.type === "navigate");
  const sites = [...new Set(pages.map((event) => hostOf(event.url)).filter(Boolean))];
  const last = [...events].reverse().find((event) => event.type === "page" && event.title);
  const named = sites.slice(0, 3);
  const list = named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}` : named[0];
  const where = list ? `You worked on ${list}` : "You worked in the browser";
  return last ? `${where} and ended up on "${last.title}".` : `${where}.`;
}
