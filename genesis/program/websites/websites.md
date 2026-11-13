# A home's own website

A home's owners and admins set up the person's own website once (D-84): a folder on this computer that a web server
already serves, or S3-compatible storage, and the address that place is served at. A page bots wrote is then published
there as a copy of the page on its own, without its scripts, published again, unpublished, and
followed as it moves or goes in the home's files.

## Sources

- Main: `packages/websites/src/server/websites.js`
- `packages/websites/src/server/WebsitesFeature.js`
- `packages/websites/src/server/websiteRoutes.js`
- `packages/websites/src/server/folderSite.js`
- `packages/websites/src/server/s3Site.js`
- `packages/websites/src/server/answerCheck.js`
- `packages/websites/src/server/marker.js`
- `packages/websites/src/server/tableResources.js`
- `packages/websites/src/server/websiteError.js`
- `packages/websites/migrations/constraints/20261113090000_websites.cjs`
- `packages/websites/package.json`
- `src/components/mercbot/websiteParts.js`
- `src/components/mercbot/websitesApi.js`
- `src/components/mercbot/MercbotSettingsWebsite.vue`
- `src/components/mercbot/MercbotPageWebsite.vue`
- `tests/server/websites.test.js`
- `tests/server/websites.integration.js`
- `tests/support/fakeS3.mjs`
- `tests/support/staticSite.mjs`
- `tests/e2e/website.spec.ts`

## Public contract

`mercbot.websites` (`WebsitesFeature`) is the whole server side: its tables, its routes and its following of pages.
It requires `mercbot.files` and `mercbot.account` (who runs the copy), and calls `files.pages.published` for a page's
copy and `files.pages.follow` for its moves.

- **The website** (`save`, `describe`, `remove`): one `home_websites` row per home, its kind (`folder` or `s3`), its
  base URL (http or https, without a query or user, ending in `/`) and where it uploads, sealed with the vault key
  (`MERCBOT_VAULT_KEY`, `@local/account/vault-crypto`); without a vault key it refuses (503). A folder is a whole,
  normalised path; S3 is an endpoint (empty for Amazon S3), a bucket, a region, an optional folder in the bucket, an
  access key and its secret. Keys left empty keep the saved ones for the same endpoint. The place is checked before
  it's saved: the folder is there and writable, or the bucket lists with the keys. `describe` never answers the keys,
  only `hasKeys`. While a page is published, the place can't change and the website can't be removed (409
  `websites_pages_published`). A new place or base URL is confirmed again at its next first publish.
- **Publishing** (`publish`): refused without a website (409 `websites_not_set_up`) and, until the website's first
  publish, without `confirmed` (409 `websites_confirm_first`). The copy is `files.pages.published`: the page as it
  opens on its own (`withoutForbidden`, `withoutScripts`, the shell's look without its helper), the same policy in a
  meta tag, a no-referrer meta and a stamp; the files of its folder it loads at their own paths, SVG pictures inside
  the page as data, never a script file, at most the save's limits (413 `files_page_too_big`). It goes to
  `<base URL>/<slug>/index.html` with `.mercbot-page.json` naming the publication's random marker. The slug is the
  file's name in lowercase letters, digits and dashes, with -2, -3… up to 50 when taken in the home
  (`page_publications`, reserved before the upload; a page never published forgets it when the upload fails). Anything
  at that place without this publication's marker is left and the publish refused (409 `websites_place_taken`). A
  folder copy is written beside the old one and swapped in by two renames; an S3 copy is uploaded marker first,
  `index.html` last, then the keys it no longer has are deleted. Afterwards Mercbot reads the address back
  (`checkAnswer`, 10 seconds) and answers `check`: ok, or why not (`websites_check_unreachable`,
  `websites_check_status`, `websites_check_other_page`).
- **Unpublishing** (`unpublish`) takes the copy away when it still holds this publication's marker, then the row.
- **Following the page** (`pageChanged`, through `files.pages.follow`): a moved page keeps its publication and address;
  a deleted page's copy is taken off the website and its row goes (a copy that can't be taken off now stays there,
  with a warning in the server's log).
- **Errors** from the folder (`websites_folder_missing`, `_not_writable`, `_failed`) or the storage
  (`websites_storage_unreachable`, `_keys_rejected`, `_bucket_missing`, `_region_wrong`, `_access_denied`, `_failed`)
  name the folder, bucket or service and never the keys.
- **Anyone else's website is on the internet:** the sealed settings keep `setUpByRunner`, whether the person who last
  saved it runs the copy (missing counts as no). For a website nobody who runs the copy set up, `createS3Site({ guarded })`
  refuses an endpoint written as a private address before connecting and connects only through agents whose lookup is
  `publicLookup`, and `checkAnswer({ guarded })` reads through `publicFetch`, following each redirect itself so every
  address is checked (`@local/account/public-address`; the SDK follows no redirect). `save` also refuses such a
  website's base URL on a private network, written as one or a name leading to one, before the storage is asked. The
  refusals: 403 `websites_storage_private` (on saving or any later upload), 403 `websites_address_private`, and the
  read-back's `websites_check_private`. A website set up by someone who runs the copy reaches any address, as before.

Routes, for people in the home: `GET`, `PUT` and `DELETE /api/w/:home/website`, and `GET ?path=`, `POST {path,
confirmed}` and `DELETE ?path=` on `/api/w/:home/bots/:botId/pages/website`, the page being in that bot's folder of the
request's home. Setting up, removing and publishing need `workspace.settings.update` (owners and admins, D-66) and
refuse a member first (403 `websites_manage_forbidden`); anyone in the home reads and unpublishes. The
answers carry `canManage` or `canPublish`. A folder on this computer is chosen only by whoever runs the copy
(`mercbot.account`'s `runsThisCopy`), since Mercbot writes there with the server's own rights: in Mercbot that is its
one person (D-81); a copy built on Mercbot may name its runners through `mercbot.copy-runners`; one with many people
and no such list has nobody who can choose a folder, so its websites are in S3-compatible storage. `save` refuses
anyone else first (403 `websites_folder_forbidden`), and the website's answers carry `canUseFolder`. A home's admins
publish to a folder someone who runs the copy chose.

## In the app

`websiteParts.js` is the client's one registration: the Settings section Website (`MercbotSettingsWebsite.vue`,
`?settings=website`, offering a folder only with `canUseFolder`) and the "Your website" row in a page's Share
(`MercbotPageWebsite.vue`): Not set up, Not published with Publish (the first one confirmed in "Publish to your
website?"), or Published with its address, Copy, Open, Publish again and Unpublish, and the answer check's warning
when the page doesn't answer at its address. A composition
that leaves websites out replaces this file with no section and no row and drops `@local/websites` from its packages.

## Owned data

- `home_websites`: a home's website, one per home: kind, base URL, sealed settings and when its first publish was
  confirmed.
- `page_publications`: a page published to its home's website: bot, path, slug, marker and when it was published.
