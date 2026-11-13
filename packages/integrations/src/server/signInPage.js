/**
 * Text made safe to put in HTML.
 * @param {unknown} text
 */
function escape(text) {
  return String(text).replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * The small page a provider's sign-in ends on, in Mercbot's look, light or dark: a title and a
 * sentence, the approval link for an IT team when there is one, and the way back to Mercbot.
 * @param {string} title
 * @param {string} text
 * @param {{ approval?: string, back?: string }} [links]
 */
export function signInPage(title, text, { approval = "", back = "" } = {}) {
  const approvalBlock = approval
    ? `<p class="approval"><label for="approval">Approval link for your IT team</label>` +
      `<textarea id="approval" readonly rows="3">${escape(approval)}</textarea>` +
      `<button type="button"` +
      ` onclick="navigator.clipboard.writeText(document.getElementById('approval').value);this.textContent='Copied'">` +
      "Copy the link</button></p>"
    : "";
  const backLink = back ? `<p class="back"><a href="${escape(back)}">Back to Mercbot</a></p>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;` +
  `font:14px/20px system-ui,sans-serif;background:#fafafa;color:#111}
main{max-width:440px;padding:24px;text-align:center}h1{font-size:20px;font-weight:400;margin:0 0 8px}p{color:#555;margin:0}
.approval{margin-top:18px;text-align:left}.approval label{display:block;font-size:12px;margin-bottom:4px}` +
  `.approval textarea{width:100%;box-sizing:border-box;font:12px/16px ui-monospace,monospace;` +
  `padding:8px;border:1px solid #ccc;border-radius:8px;resize:none}
.approval button,.back a{display:inline-block;margin-top:10px;padding:8px 16px;border:0;border-radius:18px;` +
  `background:#121212;color:#fff;font:inherit;text-decoration:none;cursor:pointer}.back{margin-top:18px}
@media (prefers-color-scheme:dark){body{background:#121212;color:#eee}p{color:#aaa}` +
  `.approval button,.back a{background:#f5f5f5;color:#121212}` +
  `.approval textarea{background:#1f1f1f;color:#eee;border-color:#444}}</style></head>
<body><main><h1>${escape(title)}</h1><p>${escape(text)}</p>${approvalBlock}${backLink}</main></body></html>`;
}
