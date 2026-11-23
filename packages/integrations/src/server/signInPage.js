/**
 * The page's one script, served at /api/connections/sign-in-page.js (registerRoutes.js) rather than written into the
 * page, so it runs under a Content Security Policy without inline scripts (D-110).
 * - A sign-in that took Mercbot's own tab (on a phone, which left the way back in this tab's session storage,
 *   signInReturn.js) goes straight back once connected.
 * - One in a window of its own tells this browser's Mercbot tabs how it went, and once connected and one of them
 *   answers, closes itself.
 * - Close closes the window; where the browser won't let a page close its window, it says to close the tab instead.
 *   Try again (a sign-in that didn't connect) starts the same account's sign-in again, from where it began (/connect,
 *   which left its own address in session storage), and the small Back to Mercbot goes to Mercbot, or the way back.
 * - The Copy button copies the approval link.
 * - A page with a next step (connected to GitHub, with Mercbot's GitHub App to install there, D-128) stays open for it.
 */
export const SIGN_IN_PAGE_SCRIPT = `const connected = document.querySelector("main")?.dataset.result === "connected";
const stays = document.querySelector("main")?.dataset.next === "1";
const take = (key) => {
  try {
    const value = sessionStorage.getItem(key) || "";
    sessionStorage.removeItem(key);
    return /^\\/(?!\\/)/u.test(value) ? value : "";
  } catch {
    return "";
  }
};
const back = take("mercbot-sign-in-back");
const again = take("mercbot-sign-in-again");
const closeButton = document.querySelector("[data-close]");
const againLink = document.querySelector("[data-again]");
if (back) document.querySelector("[data-back]").href = back;
if (!connected && again) {
  againLink.href = again;
  againLink.hidden = false;
  closeButton.hidden = true;
}
const closeWindow = () => {
  window.close();
  // Still here: the browser keeps windows a page didn't open itself.
  setTimeout(() => {
    closeButton.hidden = true;
    document.querySelector("[data-close-yourself]").hidden = false;
  }, 300);
};
closeButton.addEventListener("click", closeWindow);
if (back && connected && !stays) {
  location.replace(back);
} else if (!back && typeof BroadcastChannel === "function") {
  const channel = new BroadcastChannel("mercbot-sign-in");
  channel.onmessage = (event) => {
    if (event.data?.kind === "here" && connected && !stays) window.close();
  };
  channel.postMessage({ kind: "finished", ok: connected });
}
document.querySelector("[data-copy]")?.addEventListener("click", (event) => {
  navigator.clipboard.writeText(document.getElementById("approval").value);
  event.currentTarget.textContent = "Copied";
});
`;

/**
 * Text made safe to put in HTML.
 * @param {unknown} text
 */
function escape(text) {
  return String(text).replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * The small page a provider's sign-in ends on, in Mercbot's look, light or dark (D-110): a title and a sentence, the
 * approval link for an IT department when there is one, then one main button, Close (or Try again, when it didn't
 * connect and there is a sign-in to start again), and under it a small Back to Mercbot. Its script does what they do
 * (SIGN_IN_PAGE_SCRIPT). `next` is a step still to take elsewhere, its link the main button, before Close.
 * @param {string} title
 * @param {string} text
 * @param {{ approval?: string, connected?: boolean, next?: { href: string, label: string } | null }} [details]
 */
export function signInPage(title, text, { approval = "", connected = false, next = null } = {}) {
  const approvalBlock = approval
    ? `<p class="approval"><label for="approval">Approval link for your IT department</label>` +
      `<textarea id="approval" readonly rows="3">${escape(approval)}</textarea>` +
      `<button type="button" data-copy>Copy the link</button></p>`
    : "";
  const nextLink = next ? `<a class="main" href="${escape(next.href)}">${escape(next.label)}</a> ` : "";
  const actions = `<p class="actions">${nextLink}<button type="button" class="${next ? "plain" : "main"}" data-close>Close</button>` +
    `<a class="main" data-again href="/" hidden>Try again</a>` +
    `<span class="closing" data-close-yourself hidden>You can close this tab now.</span></p>` +
    `<p class="back"><a data-back href="/">Back to Mercbot</a></p>` +
    `<script src="/api/connections/sign-in-page.js" defer></script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;` +
  `font:14px/20px system-ui,sans-serif;background:#fafafa;color:#111}
main{max-width:440px;padding:24px;text-align:center}h1{font-size:20px;font-weight:400;margin:0 0 8px}p{color:#555;margin:0}
[hidden]{display:none!important}
.approval{margin-top:18px;text-align:left}.approval label{display:block;font-size:12px;margin-bottom:4px}` +
  `.approval textarea{width:100%;box-sizing:border-box;font:12px/16px ui-monospace,monospace;` +
  `padding:8px;border:1px solid #ccc;border-radius:8px;resize:none}
.approval button,.main{display:inline-block;margin-top:10px;padding:8px 20px;border:0;border-radius:18px;` +
  `background:#121212;color:#fff;font:inherit;text-decoration:none;cursor:pointer}.actions{margin-top:18px}
.plain{margin-top:10px;padding:8px 16px;border:0;background:none;color:#555;font:inherit;cursor:pointer}
.closing{display:inline-block;margin-top:10px;color:#111}.back{margin-top:12px;font-size:13px}.back a{color:#555}
@media (prefers-color-scheme:dark){body{background:#121212;color:#eee}p{color:#aaa}.closing{color:#eee}` +
  `.approval button,.main{background:#f5f5f5;color:#121212}.back a,.plain{color:#aaa}` +
  `.approval textarea{background:#1f1f1f;color:#eee;border-color:#444}}</style></head>
<body><main data-result="${connected ? "connected" : "failed"}"${next ? ` data-next="1"` : ""}><h1>${escape(title)}</h1><p>${escape(text)}</p>` +
  `${approvalBlock}${actions}</main></body></html>`;
}
