// How an app's sign-in comes back (D-110). On a computer it opens in a window of its own; the page it ends on
// (packages/integrations/src/server/signInPage.js) tells this browser's Mercbot tabs how it went over a BroadcastChannel,
// which reaches them however the provider's pages cut the window off from its opener, and closes itself once a tab
// answers that it has it. On a phone the sign-in takes the tab itself, and the page goes back to Mercbot.

const CHANNEL = "mercbot-sign-in";
// Where a sign-in that took this tab goes back to, read once by the page it ends on (and by /connect when it can't start).
const BACK = "mercbot-sign-in-back";
// Where a sign-in begins (/connect, with its app, home and account), for the page it ends on to offer Try again.
const AGAIN = "mercbot-sign-in-again";

/** Whether a sign-in takes this tab rather than opening a window: on a phone's width (D-38). */
export const signInInThisTab = () => window.matchMedia("(max-width: 599px)").matches;

/**
 * Answers the sign-in windows of this browser that this tab has the result, so one that connected closes itself, and
 * calls `onConnected` for each that did: the shell listens while it's open, and a screen waiting for a sign-in reads the
 * account at once (useSignInWatch.js). Answers how to stop listening.
 * @param {() => void} [onConnected]
 */
export function listenForSignIns(onConnected = () => {}) {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event) => {
    if (event.data?.kind !== "finished") return;
    channel.postMessage({ kind: "here" });
    if (event.data.ok) onConnected();
  };
  return () => channel.close();
}

/**
 * Before a sign-in takes this tab: Connect apps on its app, where the person was, to come back to.
 * @param {string} pluginId
 */
export function rememberWayBack(pluginId) {
  const query = new URLSearchParams(window.location.search);
  query.set("connect", pluginId);
  try {
    window.sessionStorage.setItem(BACK, `${window.location.pathname}?${query}`);
  } catch {
    // Without session storage, the page the sign-in ends on says to close the tab instead.
  }
}

/** On /connect, as a sign-in begins: its own address, for Try again on the page it ends on. */
export function rememberSignInStart() {
  try {
    window.sessionStorage.setItem(AGAIN, `${window.location.pathname}${window.location.search}`);
  } catch {
    // Without session storage, the page the sign-in ends on offers Close instead.
  }
}

/** The way back a sign-in that took this tab left, taken once; "" in a sign-in window of its own. */
export function takeWayBack() {
  try {
    const back = window.sessionStorage.getItem(BACK) || "";
    window.sessionStorage.removeItem(BACK);
    return /^\/(?!\/)/u.test(back) ? back : "";
  } catch {
    return "";
  }
}
