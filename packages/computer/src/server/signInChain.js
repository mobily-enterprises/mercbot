// A computer's sign-in chain (D-77): where a sign-in the person asked for has led its browser, so a code the site
// emails them goes only into those pages without asking. It starts on the bot's tab when the bot opens that sign-in's
// first page. The tab stays in it while it moves on by itself: a redirect, a form it posts, a link or button clicked
// on it, its own scripts. Popups a page of the chain opens ("Sign in with Google") join it. A tab leaves it when an
// address is typed into it, a bookmark opens or it goes back or forward in its history. The chain ends when the
// sign-in finishes or the bot opens an address itself (the computer manager calls end() then), and by itself 10 minutes
// after it started.
//
// Chrome tells each tab's own CDP session how every navigation began: frameRequestedNavigation comes first when the
// page asked for it (anchorClick, formSubmissionPost, scriptInitiated, metaTagRefresh, ...), and
// frameStartedNavigating then says what kind it is (differentDocument for a new page; history moves, reloads and
// changes inside the same page apart). So the bookkeeping is the same for every navigation: three events, each a
// comparison or two and no command to the browser, however long the chain. A tab costs three commands once, when it
// opens.

/** How long a sign-in's chain lasts from its first page. */
export const SIGN_IN_CHAIN_MS = 10 * 60 * 1000;

// A page that stays the same page (an anchor, history.pushState, a reload) keeps its place in the chain.
const SAME_PAGE = new Set(["sameDocument", "historySameDocument", "reload", "reloadBypassingCache"]);

/**
 * One computer's chain, over the browser's tabs (Puppeteer pages).
 * @param {object} [options]
 * @param {() => number} [options.clock] Milliseconds, as Date.now (tests move it on).
 * @param {number} [options.lifetimeMs]
 */
export function createSignInChain({ clock = Date.now, lifetimeMs = SIGN_IN_CHAIN_MS } = {}) {
  /** The chain that's open: when it started and the address it started from. */
  let open = null;
  /** Each tab followed, by its target: the chain its page is in, and the navigation its page last asked for. */
  const tabs = new WeakMap();

  /** The open chain, once it's had its 10 minutes no longer. */
  function current() {
    if (open && clock() - open.startedAt >= lifetimeMs) open = null;
    return open;
  }

  /**
   * Follow a tab from when it opens. A popup a page of the open chain opens is in the chain from the start; until its
   * first page has loaded, that opening navigation is the page's that opened it.
   * @param {import("puppeteer-core").Page} page
   */
  async function follow(page) {
    const target = page.target();
    if (tabs.has(target)) return;
    const opener = target.opener() ? tabs.get(target.opener()) : null;
    const chain = current();
    const tab = { chain: chain && opener?.chain === chain ? chain : null, asked: "", opening: true, main: "" };
    tabs.set(target, tab);
    const session = await page.createCDPSession();
    session.on("Page.frameRequestedNavigation", ({ frameId, url }) => {
      if (frameId === tab.main) tab.asked = url;
    });
    session.on("Page.frameStartedNavigating", ({ frameId, url, navigationType }) => {
      if (frameId !== tab.main) return;
      const asked = tab.asked === url;
      tab.asked = "";
      if (tab.opening || SAME_PAGE.has(navigationType) || (navigationType === "differentDocument" && asked)) return;
      // An address typed in, a bookmark, a move back or forward in its history: not where the sign-in led.
      tab.chain = null;
    });
    session.on("Page.frameNavigated", ({ frame }) => {
      if (!frame.parentId) tab.opening = false;
    });
    await session.send("Page.enable");
    const { frameTree } = await session.send("Page.getFrameTree");
    tab.main = frameTree.frame.id;
    // A popup that has already loaded its first page by now has nothing more to open.
    if (!/^(about:blank)?$/u.test(frameTree.frame.url)) tab.opening = false;
  }

  /**
   * A sign-in the person asked for starts on this tab, at the page it's on now (the bot has just opened it). Any
   * other chain ends.
   * @param {import("puppeteer-core").Page} page
   * @param {string} address The address it started from.
   */
  function start(page, address) {
    open = { startedAt: clock(), address };
    const tab = tabs.get(page.target());
    if (tab) tab.chain = open;
  }

  function end() {
    open = null;
  }

  /**
   * Whether the page a tab shows is in the open chain.
   * @param {import("puppeteer-core").Page} page
   */
  function holds(page) {
    const chain = current();
    return Boolean(chain) && tabs.get(page.target())?.chain === chain;
  }

  /** Where the open chain started, or "". */
  const startedFrom = () => current()?.address || "";

  return Object.freeze({
    follow,
    start,
    end,
    holds,
    startedFrom
  });
}
