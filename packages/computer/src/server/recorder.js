// Records what the person does on the bot's computer while they teach a task. A small
// script in every page reports clicks, typed values and Enter presses; page changes come from
// Chrome itself. Values typed into password and card fields are never recorded.
const MAX_RECORDING_MS = 10 * 60 * 1000;
const MAX_EVENTS = 400;

const PAGE_SCRIPT = `(() => {
  if (window.__mercbotRecorder) return;
  window.__mercbotRecorder = true;
  const text = (value) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  const labelOf = (el) => text(
    el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].innerText) ||
    el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") ||
    (el.tagName === "INPUT" ? "" : el.innerText) || el.getAttribute("name") || el.value
  );
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || "", label: labelOf(el),
    href: el.href ? String(el.href).slice(0, 300) : ""
  });
  const secret = (el) => el.type === "password" ||
    /pass|otp|cvc|cvv|card|secret|token/i.test((el.name || "") + " " + (el.autocomplete || "") + " " + (el.id || ""));
  const valueOf = (el) => (secret(el)
    ? "(hidden)"
    : el.type === "checkbox" || el.type === "radio" ? String(el.checked) : String(el.value || "").slice(0, 200));
  const send = (event) => { try { window.__mercbotRecord(event); } catch (error) { /* not recording */ } };
  const target = (event) => event.target && event.target.closest
    ? event.target.closest(
      "a,button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox]"
    ) || event.target
    : null;
  document.addEventListener("click", (event) => {
    const el = target(event);
    if (el && el.tagName) send({ type: "click", ...describe(el) });
  }, true);
  document.addEventListener("change", (event) => {
    const el = event.target;
    if (el && "value" in el) send({ type: "input", ...describe(el), value: valueOf(el) });
  }, true);
  document.addEventListener("keydown", (event) => {
    const el = event.target;
    if (event.key === "Enter" && el && el.tagName) send({ type: "enter", ...describe(el), value: "value" in el ? valueOf(el) : "" });
  }, true);
})();`;

export function createRecorder() {
  let recording = null;
  const attached = new WeakSet();

  function push(event) {
    if (!recording || recording.events.length >= MAX_EVENTS) return;
    if (Date.now() - recording.startedAt > MAX_RECORDING_MS) return;
    const last = recording.events[recording.events.length - 1];
    if (event.type === "navigate" && last?.type === "navigate" && last.url === event.url) return;
    recording.events.push({ at: Math.round((Date.now() - recording.startedAt) / 1000), ...event });
  }

  /** Every tab the person uses gets the page script once; it stays quiet unless recording. */
  async function attach(page) {
    if (attached.has(page)) return;
    attached.add(page);
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && /^https?:/u.test(frame.url())) push({ type: "navigate", url: frame.url() });
    });
    page.on("load", () => {
      if (/^https?:/u.test(page.url())) page.title().then((title) => push({ type: "page", url: page.url(), title })).catch(() => {});
    });
    await page.exposeFunction("__mercbotRecord", (event) => push({ ...event, url: page.url() })).catch(() => {});
    await page.evaluateOnNewDocument(PAGE_SCRIPT).catch(() => {});
    await page.evaluate(PAGE_SCRIPT).catch(() => {});
  }

  function start(url) {
    recording = { startedAt: Date.now(), events: /^https?:/u.test(url || "") ? [{ at: 0, type: "page", url }] : [] };
  }

  function stop() {
    const done = recording;
    recording = null;
    if (!done) return null;
    return { seconds: Math.round(Math.min(Date.now() - done.startedAt, MAX_RECORDING_MS) / 1000), events: done.events };
  }

  return Object.freeze({
    attach,
    start,
    stop,
    get active() {
      return Boolean(recording);
    }
  });
}
