# Pages

Bots write pages people keep (D-40, D-74): HTML in the bot's Pages folder with Mercbot's look and
blocks, the bot's own look and scripts if it wants, and nothing loaded from outside. A page is shown
sealed off from Mercbot, opened from its card in place of the chat, ticked, versioned with Restore, and
copied as one standalone file. Older Markdown pages
(`.md`) still open and tick as before.

## Sources

- Main: `packages/files/src/server/pages.js`
- `packages/files/src/server/pageDocument.js`
- `packages/files/src/server/pageFiles.js`
- `packages/files/src/server/pageRoutes.js`
- `packages/files/src/server/page-shell/shell.css`
- `packages/files/src/server/page-shell/helper.js`
- `migrations/20261113120000_baseline.cjs`
- `packages/files/src/server/pageHeaders.js`
- `packages/bots/skills/pages.md`
- `src/components/mercbot/pageMessages.js`
- `src/components/mercbot/useOpenPage.js`
- `src/components/mercbot/MercbotPageCard.vue`
- `src/components/mercbot/MercbotPageFrame.vue`
- `src/components/mercbot/MercbotPageView.vue`
- `src/components/mercbot/MercbotPageShare.vue`
- `src/components/mercbot/MercbotPageVersions.vue`
- `src/components/mercbot/MercbotMarkdownPage.vue`
- `tests/server/pages.test.js`
- `tests/server/pages.integration.js`
- `tests/client/pages.vitest.js`
- `tests/e2e/pages.spec.ts`

## Public contract

The `mercbot.files` capability's `pages` (`createPages`) does everything to a page; the bots' tools
and the files routes call it.

- **Where a page is:** `/files/bot/Pages/<name>.html` (or a Pages folder under `/files/bot` or
  `/files/shared`; `isPagePath`), the bot's folder for everyone, so the page is the home's like every
  file there (D-66). Its own files are in the sibling folder `<name>.files/`. The file carries its key
  (`<meta name="mercbot-page">`), which a save, an edit, a restore and a move keep (`keyOf`).
- **Saving** (`save`, save_page): the bot's HTML becomes a whole document (character set, viewport, title,
  key, `lang`), without frames, plugins, `<base>`, meta refreshes, preloading links or `ping`
  (`withoutForbidden`). `pageFiles.bringIn` copies everything it loads from outside into its folder and
  names the copies: pictures and `srcset`, CSS `url()`s and the files a copied style sheet names, fonts,
  video, sound, tracks and `<script src>` libraries, from public internet addresses only (checked on the
  address connected to, `@local/account/public-address`, and by number), and the chat's own pictures by
  their `/files/…` path. At most 60 files, 10 MB each, 40 MB in all, 10 seconds each (however slowly a
  site sends, redirects included) and a minute in all, 3 redirects; a file is kept only when its content
  type fits where the page uses it. What can't be copied is taken out and listed for the bot. The same
  title saves the same page and keeps its key.
- **Changed with a command:** a page file the bot's command line changed is saved again the same way
  (`edited`), as an edit with its own card (`botTools.js`).
- **Versions:** every save, edit and restore whose result differs is a `page_versions` row with the whole
  document; `versions` lists the newest 50, and `restore` writes an earlier one back as the newest,
  keeping the current key, by the person who asked.
- **Shown sealed** (`frame`, `serve`): the viewer gets `/api/pages/<token>/<name>.html`, where the token
  is the home, bot and path, good for 12 hours, signed with an HMAC under a key derived from
  `AUTH_LOCAL_SESSION_SECRET`, so every server checks it (D-15). The address answers only the page and
  the files of its folder (`partOf`); anything else is the same 404. The page gets Mercbot's shell first
  (its look, `page-shell/shell.css`, and the helper, `page-shell/helper.js`), with each checklist item
  numbered (`data-tick`) and each link card's domain. `pageHeaders` (`pageHeaders.js`) seals it: a policy allowing only
  `'self'` files and inline styles and scripts, `connect-src`, `form-action`, frames, workers, objects
  and `base-uri` all `'none'`, `frame-ancestors 'self'`, `sandbox allow-scripts`, no referrer, devices off
  and no caching.
- **The helper** makes tabs switch and gives checklists switches, a counter and Reset, and sends the
  page around it `{mercbotPage: 1, kind}` messages: `height`, `ticks` (`[{tick, done}]`), `link` (a
  clicked web link) and `open-app` (`<a class="app" data-app data-screen data-…>` or
  `mercbot.openApp`).
- **Ticks** (`tick`) are saved into the file as the item's `data-done`, written only while the file is as
  the tick read it: a save landing meanwhile gets the tick, and a page deleted meanwhile stays deleted.
- **Opened on its own** (`serveOnItsOwn`, `keyOf`), for a feature that opens a page outside its viewer by
  an address it made itself: the page and the files of its folder (`partOf`, no `.js`) without any script
  (`withoutScripts`, and a policy of `script-src 'none'`, `sandbox`, `frame-ancestors 'none'`), only while
  the file still carries the key it is given; anything else is the same 404. `keyOf` reads the page's key
  (null when there's no page), and with `give` gives an older page without one a key, written into its
  file. The request log names a page's address without its token (`server/lib/loggerOptions.js`: under
  `/api`, the long base64url part after a `pages/` folder, with its seal).
- **Moved or deleted** through the file routes, the bot's `move_file` or the Library's Delete, a page's
  versions follow it, or go (`pathChanged`, in the home's own context), so a later page at the same path
  has none; then whatever else follows pages (`follow`, the home's website D-84 among them) is told.
- **Standalone copy** (`standalone`, keep_page_copy and the viewer's download): the page with its shell
  and helper and every file of its folder inlined as data, under a meta policy that loads nothing.

Routes, for people in the home, under the bot whose folder holds the page
(`/api/w/:home/bots/:botId/pages`): `GET frame?path=`, `POST ticks {path, items}` (up to 500),
`GET versions?path=`, `POST restore {path, versionId}` and `GET copy?path=` (an attachment). The
page-only address carries no session.

## The page in the app

- `MercbotPageCard.vue`: the chat's card, a live look at the page's top (`MercbotPageFrame` in preview,
  loaded once in sight and never answered) with a footer; the whole card opens the page.
- `useOpenPage.js`: the open page is in the address, `?page=<path>&pageBot=<bot>` (and `pageGroup` for an
  old Markdown page from a group), so it survives a reload; opening a chat or another bot closes it. The
  card, a reply's inline link to the page's path (`richText.js`, `data-page`), the Library and search
  open it.
- `MercbotPageView.vue` replaces the chat (the chat stays where it was, hidden, under it; the composer
  stays): Close, the title, Share and a ⋯ menu with Versions and Download a copy. A new card of the same
  page reloads it. On a phone the shell's bots menu button gives way to its Close (`MercbotShell.vue`).
- `MercbotPageFrame.vue` frames the page with `sandbox="allow-scripts"`, `credentialless`, no referrer and
  no devices, and takes a message only from its own frame, from origin `"null"`, of a shape
  `pageMessages.readPageMessage` accepts; a link or an app only right after the person's own click or key in the
  page (the frame has the focus and `navigator.userActivation` is still active, so the click on the card
  that opened the page doesn't count). Links open in a new tab without an opener. A page's own script can
  take the focus itself as it loads, though, and then the opening click still counts for the few seconds
  it stays active: such a page can open one link or app unasked (docs/next.md).
- The doorway (`pageMessages.doorwayLocation`): only an app or view on the home's list (`GET apps`, what
  everyone in the home may open, D-66), on the screen named if it has it (else its first), with only
  that screen's parameters; it opens in the app's own view.

## Owned data

- `page_versions`: every version of every page, by home, bot and path, with its key, kind and whole
  document.
