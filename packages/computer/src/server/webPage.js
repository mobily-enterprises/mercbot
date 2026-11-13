// What the bot's browser steps do on a page itself, apart from the computer it runs on (computerManager.js): wait for
// it to settle, see what covers it, tell whether a click did anything, click an element directly, and find a login's
// fields and type into them.

/** Enough of the page to tell whether a click did anything. */
export function fingerprint(page) {
  return page.evaluate(() => `${location.href}|${document.body?.innerHTML.length || 0}|${document.activeElement?.tagName || ""}`)
    .catch(() => "");
}

/**
 * The element Stagehand picks for a click instruction, clicked on the page itself.
 * @param {object} stagehand
 * @param {import("puppeteer-core").Page} page
 * @param {string} instruction
 */
export async function clickDirectly(stagehand, page, instruction) {
  const observed = await stagehand.observe(instruction);
  const action = observed.data.find((entry) => entry.selector) || null;
  if (!action) return false;
  const xpath = action.selector.replace(/^xpath=/u, "");
  return page.evaluate((path) => {
    const element = document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!element) return false;
    element.scrollIntoView({ block: "center" });
    element.click();
    return true;
  }, xpath);
}

/**
 * A page counts as ready once it has loaded and its network has been quiet for half a second:
 * a click made before a site's scripts are running is silently lost. Slow or
 * chatty pages carry on after a few seconds.
 */
export async function settled(page) {
  await page.waitForFunction(() => document.readyState === "complete", { timeout: 15000 }).catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
}

/**
 * What's actually in front of the page: a dialog or overlay covering the middle of the screen,
 * such as a cookie banner. The page's text still holds what's behind it, so the bot is told,
 * with the cover's own words, or the address of a frame it can't read.
 */
export async function covering(page) {
  return page.evaluate(() => {
    const { innerWidth: width, innerHeight: height } = window;
    const points = [[0.5, 0.5], [0.5, 0.3], [0.5, 0.7], [0.3, 0.5], [0.7, 0.5]];
    for (const [x, y] of points) {
      let element = document.elementFromPoint(width * x, height * y);
      while (element && element !== document.body && element !== document.documentElement) {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const dialog = element.matches("dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]");
        const overlay = (style.position === "fixed" || style.position === "sticky") && box.width * box.height >= width * height * 0.25;
        if (dialog || overlay) {
          if (element.tagName === "IFRAME") return `a frame from ${new URL(element.src, location.href).hostname}`;
          const frame = element.querySelector("iframe");
          const text = (element.innerText || "").replace(/\s+/gu, " ").trim();
          if (text) return text.slice(0, 600);
          return frame ? `a frame from ${new URL(frame.src || location.href, location.href).hostname}` : "something without text";
        }
        element = element.parentElement;
      }
    }
    return "";
  }).catch(() => "");
}

/** What the bot reads of a page: its address, title and text, and what covers it. */
export async function readPage(page) {
  const title = await page.title();
  const text = await page.evaluate(() => document.body?.innerText || "");
  return { url: page.url(), title, text: text.slice(0, 8000), covering: await covering(page) };
}

/** A site as a login names it: "https://www.Example.com/login" gives example.com. */
export const siteName = (site) => String(site).trim().toLowerCase().replace(/^https?:\/\//u, "").replace(/^www\./u, "").split(/[/?#]/u)[0];

/**
 * Whether the page is on the site (siteName), one of its subdomains, or a site it's a subdomain of; any page is, for
 * no site.
 * @param {import("puppeteer-core").Page} page
 * @param {string} wanted
 */
export function isOnSite(page, wanted) {
  let host = "";
  try {
    host = new URL(page.url()).hostname.replace(/^www\./u, "");
  } catch {
    // No address the page is on.
  }
  return !wanted || host === wanted || host.endsWith(`.${wanted}`) || wanted.endsWith(`.${host}`);
}

/**
 * A login's fields on the page, as handles: the shown password field, the username field before it, and a field for a
 * one-time code. Dispose of them when done.
 * @param {import("puppeteer-core").Page} page
 */
export function loginFields(page) {
  return page.evaluateHandle(() => {
    const shown = (element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" && !element.disabled;
    };
    const inputs = [...document.querySelectorAll("input")].filter(shown);
    const password = inputs.find((element) => element.type === "password") || null;
    const texty = (element) => ["text", "email", "tel"].includes(element.type);
    const username = password
      ? inputs.find((element) => element.autocomplete === "username") ||
        inputs.slice(0, inputs.indexOf(password)).filter(texty).at(-1) || null
      : null;
    const code = inputs.find((element) => element.autocomplete === "one-time-code") ||
      inputs.find((element) => ["text", "tel", "number"].includes(element.type)) || null;
    return { username, password, code };
  });
}

/**
 * Values typed into a login's fields (loginFields) as a person would, each checked to have stuck; returns the names
 * of the fields filled. An empty value or a missing field is skipped.
 * @param {import("puppeteer-core").JSHandle} fields
 * @param {[string, string][]} values Field name and value pairs.
 */
export async function typeValues(fields, values) {
  const filled = [];
  for (const [name, value] of values) {
    if (!value) continue;
    const element = (await fields.getProperty(name)).asElement();
    if (!element) continue;
    await element.click({ clickCount: 3 });
    await element.press("Backspace");
    await element.type(String(value), { delay: 15 });
    // Some pages lose typed text (autofill, re-renders): the value is checked, and set directly
    // with the events a person's typing would fire if it didn't stick.
    const kept = await element.evaluate((input, wanted) => input.value === wanted, String(value));
    if (!kept) {
      await element.evaluate((input, wanted) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, wanted);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, String(value));
    }
    filled.push(name);
  }
  return filled;
}
