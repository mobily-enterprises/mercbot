# Pages: sealed HTML pages any bot writes (D-40)

**Status: built (D-74, 2026-11-11).** Approved on 2026-11-06 (D-63); the revision of 2026-11-11 (bots'
scripts allowed, with nothing loaded from outside) was approved the same day with the answers at the
end, which also drop "Only you" (a page is the home's, D-66). Builds what D-40 decided (2026-10-29). Pages
stay files in the bot's Pages folder (decided 2026-11-06). The code:
`packages/files/src/server/pages.js`, `pageDocument.js`, `pageFiles.js`, `pageRoutes.js` and `page-shell/`;
the viewer `src/components/mercbot/MercbotPageView.vue` and its parts.

## Why

Pages are Markdown today: headings, lists, checklists, tables and links, and nothing else. Every page
looks the same, shows no pictures, and opens in a plain white dialog. On 2026-11-11 a bot asked for a
50th-birthday page gave exactly that, without the invitation picture it had just made and with made-up
"drinks, dinner, dress" lines. Pages need tabs, a numbered timeline, link cards and an "unverified" tag
that Markdown can't show. D-40 already chose HTML in a sealed frame.

## What a page is

- **An HTML file** the bot writes, `/files/bot/Pages/<name>.html`, in its folder for everyone and so the
  home's (or `/files/shared/…/Pages/` when the bot is asked to put it there), still listed in Files, the
  Library and search, with a sibling folder `<name>.files/` for what it shows. Old `.md` pages keep
  working as they are.
- **The bot writes the page:** HTML and, if it wants its own look, a `<style>` block (fonts, colours,
  layout: an invitation can look like an invitation) and `<script>`s of its own. Mercbot wraps it in the
  page shell, whose look is the default when the bot doesn't style it.
- **Mercbot's look and blocks**, so pages look like Mercbot and cost little to write. The shell styles
  plain HTML, and a few classes give these blocks:

| Block | The bot writes |
|---|---|
| Tabs | `<section class="tabs"><section title="Plan A">…</section><section title="Plan B">…</section></section>` |
| Numbered timeline | `<ol class="timeline"><li><b>10:00 Museum</b> Opens at ten</li>…</ol>` |
| Checklist | `<ul class="checklist"><li>Raincoat</li>…</ul>` (ticks saved, with a counter and Reset) |
| Link card | `<a class="card" href="https://…">Science museum</a>` (title, domain, arrow) |
| Unverified | `<span class="unverified">` around a fact it couldn't confirm |
| Callout | `<aside>…</aside>` |

## Nothing from outside

A page loads nothing from anywhere but its own folder, so even a script of its own has no ordinary way
to send what it holds anywhere.

- **On save**, Mercbot reads the HTML and finds everything it would load from outside: `<img>` and
  `srcset`, CSS `url()` and fonts, `<video>`/`<audio>`, and `<script src>` libraries (a chart library
  from a CDN). It downloads each (size and type limits), saves it in `<name>.files/` and points the page
  at the copy. What it can't fetch is removed, and the save tells the bot what and why.
- **The chat's own pictures** (the bot's pictures, the person's uploads) are named by their `/files/…`
  path and copied in the same way, so a page can open with the picture the bot just made.
- Links (`<a href>`) stay as they are: they go out only when the person clicks one, and open outside
  the page.

## Sealed

- Shown in an `<iframe sandbox="allow-scripts">` without `allow-same-origin`, so the page has no origin of
  its own: it can't read Mercbot's cookies, call its routes or touch the person's data. No popups, forms,
  dialogs, downloads or taking over the window around it.
- **Served** from a page-only address carrying a token Mercbot hands the viewer
  (`/api/pages/<signed token>/<name>.html`, good for 12 hours):
  the frame has no cookies, so the token is what lets it load its own files. The answer's headers:
  - a content policy allowing only the page's own files and its inline styles and scripts, with
    `connect-src 'none'`, `form-action 'none'`, no frames and no workers;
  - `sandbox allow-scripts`, so the page stays sealed even opened on its own in a tab;
  - no referrer, and camera, microphone and location off.
  - The frame is also `credentialless`, so nothing it loads carries the person's cookies.
- **Mercbot's helper** runs first: it makes tabs switch, counts and saves checklist ticks, and tells the
  page around it the frame's height. It talks to Mercbot only by `postMessage`, which Mercbot checks
  (sender is that frame, from no origin, message shape); a link or an app opens only right after the
  person clicked in the page. The page never calls Mercbot itself.
- **Ticks** are saved into the file itself (the item's `data-done`), as Markdown pages save `[x]` today,
  so a copy of the file keeps them.
- **Scripts:** a page's own scripts run, so pages can have countdowns,
  animations, quizzes that check answers in the page, small calculators and games, and charts from a
  copied-in library.
- **What can't be fully closed** with scripts on: a script could still get something out by sending its
  own frame to an outside address, through WebRTC, or through DNS lookups; browsers have no switch for
  these. It matters only if a bot is tricked (say, by a web page it read) into writing a page that asks
  for something secret, and the person types it in. Pages are the home's, so this is a small risk; it is
  why a page opened by its public link runs no scripts at all.

## The doorway to apps

A page reaches an app only through one message: "open app A, screen S, with these parameters" (up to 10
short values), sent when the person clicks `<a class="app" data-app="A" data-screen="S" data-x="…">` or the
page calls `mercbot.openApp(A, S, {…})`. Mercbot opens it only right after a click, only if the app is on
the home's list (what everyone in the home may open, D-66), on that screen if the app has it (else its
first) and with only that screen's parameters; the app opens in its own view, and nothing comes back into
the page. D-40's quiz example: the page links to a Quizzes app screen with the lesson's id. Passing a whole
quiz's questions through the doorway is left out; they'd live in the app's table.

## What people see

- **Card:** a live, fading preview of the page's top (the sealed page, scaled, not clickable), with a
  footer: page icon, title, "Page". Clicking it or the reply's inline link opens the viewer.
- **Viewer:** replaces the chat panel, not a dialog: close, a title chip, Share, the scrolling page and
  the composer floating at the bottom, still sending to the bot. Close goes back to the same place in
  the chat.
- **Share:** **Everyone in the home**, always. On one computer nobody else reaches a
  link, so Mercbot has no "Anyone with the link" of its own (it had one until 2026-11-12): a page leaves
  the home on the person's own website (D-84) or as a kept copy. What a copy built on Mercbot adds to the
  Share shows under it (`extensions.js`, `pageShareParts`); `files.pages` opens a page on its own, without
  scripts, only while the file still carries a given key (`serveOnItsOwn`, `keyOf`).
- **Versions** (the ⋯ menu): every save, change and restore, newest first, with Restore, as views have
  (`page_versions`).
- **Keeping a copy:** asked, the bot saves a standalone `.html` (keep_page_copy: shell,
  helper and the page's files inlined, under a policy that loads nothing) and says so; the viewer's ⋯
  menu downloads the same copy. There's no PDF: the person prints the copy to PDF from their browser
  (a PDF printed on the bot's computer was left out).

## Publishing to your own website (D-84)

A person's own copy answers its own computer only (D-81), so a link to it opens nothing elsewhere. A page can also go
on a website the person already has.

- **The Website** (Settings → Website, one per home, set up by its owners and admins): a folder on this computer that a
  web server already serves, or S3-compatible storage (endpoint, empty for Amazon S3; bucket; region; an optional
  folder in the bucket; access key and secret), and the base URL that place is served at. Mercbot checks the place
  before saving. Where it uploads is sealed with the vault key; the keys are never shown again or logged.
- **The copy** is what the link shows: no scripts, Mercbot's look, the link's policy carried in a meta tag (the site's
  server sends none of Mercbot's headers), as `<base URL>/<slug>/index.html` with the files of the page's folder that it
  loads at the same addresses beside it. SVG pictures go inside the page as data (an SVG opened on its own runs its
  scripts on that site); script files are never carried; at most a save's limits (60 files, 40 MB). The slug is the
  page file's name (lowercase letters, digits and dashes; -2, -3… when taken in the home), kept as the page moves.
- **Share** gets a "Your website" row under the link: Not set up (with where to set it up), Not published (Publish), or
  Published with its address, Copy, Open, Publish again and Unpublish. The first publish to a new Website (or a new
  place or address) asks first, as it puts the page on the internet. After each upload Mercbot reads the page back at
  its address and says plainly when it doesn't answer there (a wrong base URL, or a server that doesn't serve the
  folder).
- **Safety:** each copy carries `.mercbot-page.json` with its publication's random id; Mercbot replaces or removes only a
  folder holding it, and refuses a publish whose address holds anything else. The Website's place can't change, nor
  can it be removed, while pages are on it.
- **Following the page:** publishing again replaces the copy (files it no longer has go), Unpublish removes it, a page
  moved keeps its place and address, and a page deleted is taken off the website.
- **Who:** owners and admins publish, anyone in the home unpublishes, as with the link (D-66, D-74). A folder on this
  computer is chosen only by the people who run the copy (D-59; on a person's own copy, its one person), since Mercbot
  writes there with the server's own rights; anyone else's Website is S3-compatible storage and an address on the
  internet: its storage is reached, and its pages read back, only at public internet addresses
  (`@local/account/public-address`), so a private endpoint or address, or a name or redirect leading to one, is refused.
- **Where it lives:** the `@local/websites` package (`home_websites`, `page_publications`) and
  `src/components/mercbot/websiteParts.js`; the copy itself is `files.pages.published`, beside the link's own serving.
  A composition can leave both out.
- **Proposed, not built:** the page's scripts on the person's site (D-84 says why not, and how if ever).

## Writing and editing

- `save_page { title, content, path? }` takes the page's HTML and saves the whole page, as now.
- "Add X to the page" edits the same file with the existing file-editing tool, so a small change
  doesn't rewrite the whole page. One card, one Library entry.
- `packages/bots/skills/pages.md` teaches the blocks with one example, and when a page, a view or an
  app fits.
- **How to write a good page**, as guidance with its reasons in the skill and the
  tool's description:
  - put on the page what the person said or the bot found; when something essential is missing (time,
    place), ask, or show it plainly as "to be confirmed", rather than filling it with guesses;
  - use the chat's own pictures where they fit (an invitation's picture at its top);
  - choose a layout for the kind of page: an invitation, a plan, a guide and a checklist read
    differently.

## Not in the first version

Views inside pages, live data, comments, pages people answer (an RSVP, a course's questions: LATER.md;
through the doorway to an app meanwhile), and passing data back from apps. A page could later show a
view through a `<mercbot-view>` placeholder that Mercbot fills in outside the frame.

## Answers (2026-11-06)

1. **Bots' scripts are dropped:** pages hold content only, with Mercbot's helper. **Proposed
   2026-11-11:** allow them, with nothing loaded from outside (above). Pages are private today, and the
   risk that made scripts dangerous was mostly the public link.
2. **Sharing:** Only you, Everyone in the home, and Anyone with the link (Only you dropped on 2026-11-11).
3. **Every saved version is kept,** with Restore, as views do.

## Answers (2026-11-11, D-74)

All as recommended:

1. **Bots' scripts are allowed**, with nothing loaded from outside, as above.
2. Pages opened by **Anyone with the link** run no scripts: the policy forbids them and they're taken
   out, so the page still reads well.
3. The rest goes in: the bot's own look with Mercbot's as the default, the chat's pictures on pages, the
   writing guidance; pages people answer stay for later.
4. **D-66 recheck: "Only you" is dropped.** A page belongs to the home like every file: sharing is the
   home, always, and an optional Anyone with the link that can be turned off. Pages still live in the
   bot's Pages folder.
5. **D-40's quiz:** the app opens in its own view through the doorway, never inside the page.
