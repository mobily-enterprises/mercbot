// The offline page's Try again, and reconnecting by itself once the person is back online (D-133). The page's network
// and the service worker's come back a moment apart, so a reload the online event starts can fail and land here again
// after the event: the page keeps trying, one loop at a time, waiting longer after each failure (1 s, doubling to 30 s
// at most), until the page it stands in for answers, then reloads it. Try again tries at once, in the same loop.
const FIRST_WAIT_MS = 1000;
const LONGEST_WAIT_MS = 30000;

/** The page's one reconnecting loop: whether it's trying, and what ends its wait so it tries at once. */
function createReconnecting() {
  let trying = false;
  let wake = null;

  async function reconnect() {
    if (trying) {
      wake?.();
      return;
    }
    trying = true;
    for (let wait = FIRST_WAIT_MS; ; wait = Math.min(wait * 2, LONGEST_WAIT_MS)) {
      try {
        // Any answer means Mercbot is reachable again, a sign-in page's redirect too; only a network error doesn't.
        await fetch(location.href, { cache: "no-store", redirect: "manual" });
        location.reload();
        return;
      } catch {
        await new Promise((resolve) => {
          wake = resolve;
          setTimeout(resolve, wait);
        });
        wake = null;
      }
    }
  }

  function isTrying() {
    return trying;
  }

  return Object.freeze({ reconnect, isTrying });
}

const reconnecting = createReconnecting();
// readable-check: allow released-listeners - shared resource: the offline page's button, for the page's whole life
document.getElementById("again").addEventListener("click", reconnecting.reconnect);
// readable-check: allow released-listeners - shared resource: the page waits to be online for its whole life
window.addEventListener("online", reconnecting.reconnect);
// Here while the browser says it's online: the page couldn't be reached all the same, so it tries after a moment.
if (navigator.onLine) {
  setTimeout(() => {
    if (!reconnecting.isTrying()) reconnecting.reconnect();
  }, FIRST_WAIT_MS);
}
