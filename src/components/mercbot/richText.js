import MarkdownIt from "markdown-it";
import { icons } from "../../theme/icons.js";

// Bot replies as rich text. Raw HTML is off, so model output can't inject markup.
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });

const escapeHtml = (text) => markdown.utils.escapeHtml(text);
const KEYWORDS = /^(true|false|null|undefined|const|let|var|function|return|if|else|for|while|import|export|from|class|new|async|await|def|None|True|False)$/u;

// Light colouring: string values lilac, keywords and literals crimson, keys and punctuation plain.
export function highlightCode(code) {
  return code.replace(/("(?:[^"\\\n]|\\.)*"(?=\s*:))|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|([A-Za-z_][\w]*)|([^"'`A-Za-z_]+)/gu, (match, key, string, word, other) => {
    if (key) return escapeHtml(key);
    if (string) return `<span class="mb-code__string">${escapeHtml(string)}</span>`;
    if (word) return KEYWORDS.test(word) ? `<span class="mb-code__keyword">${word}</span>` : escapeHtml(word);
    return escapeHtml(other);
  });
}

markdown.renderer.rules.fence = (tokens, index) =>
  `<pre class="mb-code"><code>${highlightCode(tokens[index].content.replace(/\n$/u, ""))}</code></pre>`;
markdown.renderer.rules.code_block = markdown.renderer.rules.fence;

const SKILL_ICON = `<svg class="mb-skill-link__icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="${icons.deployedCode}"/></svg>`;

const APP_HOSTS = {
  "github.com": "github",
  "calendar.google.com": "google-calendar",
  "mail.google.com": "gmail",
  "drive.google.com": "google-drive",
  "docs.google.com": "google-drive"
};

const PAGE_PATH = /^\/files\/(mine|bot|shared)\/(?:[^?#]+\/)?Pages\/[^/?#]+\.(html|md)$/u;
function decodeLink(href) {
  try {
    return decodeURI(String(href || ""));
  } catch {
    return "";
  }
}

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  // A skill the bot saved: opens the skill in the app instead of a web page.
  const skill = /^skill:(\d+)$/u.exec(token.attrGet("href") || "");
  if (skill) return `<a class="mb-skill-link" href="#" data-skill="${skill[1]}">${SKILL_ICON}`;
  // A page the bot saved, named by its path (D-74): opens the page in place of the chat.
  const page = PAGE_PATH.exec(decodeLink(token.attrGet("href")));
  if (page) return `<a class="mb-link mb-page-link" href="#" data-page="${escapeHtml(page[0])}">`;
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  token.attrJoin("class", "mb-link");
  let icon = "";
  try {
    const url = new URL(token.attrGet("href"));
    // A link into a connected app (a repository, a calendar event) is a chip with the app's logo.
    const app = APP_HOSTS[url.hostname];
    if (app) {
      token.attrJoin("class", "mb-link--app");
      return `${self.renderToken(tokens, index, options)}<img class="mb-link__app" src="/api/plugins/${app}/logo.svg?tile=1" alt="" width="14" height="14">`;
    }
    if (url.protocol === "https:" || url.protocol === "http:") {
      icon = `<img class="mb-link__icon" src="${escapeHtml(`${url.origin}/favicon.ico`)}" alt="" width="16" height="16" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
    }
  } catch {
    // Relative or malformed links get no icon.
  }
  return `${self.renderToken(tokens, index, options)}${icon}`;
};

export function renderRichText(text) {
  return markdown.render(String(text || ""));
}
