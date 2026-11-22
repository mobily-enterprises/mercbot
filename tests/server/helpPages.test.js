import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The help centre's pages (help/*.md), read as files: every page help/index.json lists is there under its title, every
// link between pages reaches a page and a heading the help centre shows, and no page speaks of the chat model chats
// replaced (D-112). These checks read only the files.

const HELP = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../help");
const read = (file) => readFileSync(path.join(HELP, file), "utf8");
const listed = [JSON.parse(read("index.json")), JSON.parse(read("extensions.json"))]
  .flatMap((index) => index.groups.flatMap((group) => group.pages));
const pages = new Map(listed.map((page) => [page.slug, read(`${page.slug}.md`)]));

/** A heading's id as the help centre gives it (src/components/help/HelpCentre.vue, idOf). */
const idOf = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "");
/** The ids of a page's headings below its title, which the help centre renders and links can point at. */
const headingIds = (text) => new Set([...text.matchAll(/^#{2,6} (.+)$/gmu)].map(([, heading]) => idOf(heading.trim())));
/** Every Markdown link's target in a page. */
const linksOf = (text) => [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/gu)].map(([, target]) => target);

// Paths of Mercbot itself, outside the help centre, that a page may link to.
const APP_PATHS = new Set(["/templates"]);

test("every page help/index.json lists is in help/ under its title, once, and every page in help/ is listed", () => {
  assert.ok(listed.length >= 25, "the index is read");
  assert.equal(new Set(listed.map((page) => page.slug)).size, listed.length, "no page is listed twice");
  for (const page of listed) {
    assert.equal(pages.get(page.slug).split("\n")[0], `# ${page.title}`, `help/${page.slug}.md starts with its title`);
  }
  const files = readdirSync(HELP).filter((name) => name.endsWith(".md") && name !== "WRITING.md");
  for (const file of files) assert.ok(pages.has(file.slice(0, -".md".length)), `help/${file} is listed in help/index.json`);
});

test("every link between help pages reaches a listed page, and a heading on it when it names one", () => {
  const broken = [];
  let checked = 0;
  for (const [slug, text] of pages) {
    for (const target of linksOf(text)) {
      if (/^(?:https?:|mailto:)/u.test(target) || APP_PATHS.has(target)) continue;
      checked += 1;
      const [, page, anchor] = /^(?:\/help\/([a-z0-9-]+))?(?:#(.+))?$/u.exec(target) || [];
      const to = page ?? (target.startsWith("#") ? slug : null);
      if (!to) broken.push(`${slug}: ${target} is not a help page's address (/help/<page>#<heading>)`);
      else if (!pages.has(to)) broken.push(`${slug}: ${target} names no page in help/index.json`);
      else if (anchor && !headingIds(pages.get(to)).has(anchor)) broken.push(`${slug}: ${target} names no heading on ${to}`);
    }
  }
  assert.ok(checked >= 200, "the pages' links are read");
  assert.deepEqual(broken, []);
});

// The chat model chats replaced, in the words a reader would take for a feature that's there.
const OLD_MODEL = [
  [/\/files\/mine\b/u, "/files/mine (a chat's folder is /files/chat)"],
  [/\bnotebook\b/iu, "the home notebook"],
  [/\bmemories\b|\bSettings\W+Memory\b/iu, "memories (Settings → Memory)"],
  [/\b(?:Private|Mixed|Shared) (?:bots?|modes?)\b|\bMixed\b|\bWho sees what\b|\bmodes? for new bots\b/u, "a bot's mode, and the home's mode for new bots"],
  [/\bShared tabs?\b|\bYou only\b/u, "Shared tabs and You only"],
  // Rooms are the new model's shared chats (D-117: Rooms, People and Bots), so only the old group chats are refused here.
  [/\bgroup chats?\b/iu, "group chats"],
  [/\b(?:your|their|my) own chats?\b/iu, "a person's own chat"],
  [/\bprivate connectors?\b/iu, "private connectors"],
  [/\bDetails panel\b/u, "a bot's Details panel (its card on Team, or Chat details)"]
];

test("no help page speaks of the chat model chats replaced", () => {
  const found = [];
  for (const [slug, text] of pages) {
    for (const [pattern, what] of OLD_MODEL) {
      const match = pattern.exec(text);
      if (match) found.push(`${slug}: "${match[0]}", ${what}`);
    }
  }
  assert.deepEqual(found, []);
});
