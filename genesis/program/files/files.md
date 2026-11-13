# Bots' files and office apps

Bots make and change documents, spreadsheets, presentations and PDFs with the
ArtCraft office apps, without a window, and the person gets each saved file as a
card in the chat with a viewer and a download (D-20, D-21).

## Sources

- Main: `packages/files/src/server/FilesFeature.js`
- `packages/files/src/server/filesRuntime.js`
- `packages/files/src/server/registerRoutes.js`
- `packages/files/src/server/types.js`
- `packages/files/src/server/fileStore.js`
- `packages/files/src/server/profilePictures.js`
- `packages/files/src/server/officeApps.js`
- `packages/files/src/server/mcpClient.js`
- `packages/files/src/server/remoteMounts.js`
- `packages/files/src/server/storageSettings.js`
- `packages/files/src/server/fileMoves.js`
- `packages/files/src/server/driveStorage.js`
- `packages/files/src/server/driveTokenRoute.js`
- `packages/files/src/server/ownMachine.js`
- `migrations/20261113120000_baseline.cjs`
- `src/components/mercbot/MercbotSettingsFiles.vue`
- `packages/files/package.json`
- `scripts/install-tools.sh`
- `scripts/tools-store.sh`
- `scripts/mount-files.sh`
- `scripts/serve.sh`
- `scripts/namespace.sh`
- `scripts/hosting/vibe64.sh`
- `src/components/mercbot/filesApi.js`
- `src/components/mercbot/storageNotices.js`
- `src/components/mercbot/MercbotFileViewer.vue`
- `src/components/mercbot/useEscapeToClose.js`
- `src/components/files/FileBrowser.vue`
- `src/components/files/HomeFiles.vue`
- `src/components/files/MercbotFilesEntry.vue`
- `src/pages/w/[workspaceSlug]/files/index.vue`
- `tests/server/files.test.js`
- `tests/server/driveMount.test.js`
- `tests/server/driveStorage.integration.js`
- `tests/server/fileMoves.integration.js`
- `tests/server/memberRemoval.integration.js`
- `tests/support/fakeDrive.mjs`
- `tests/support/filesServer.mjs`
- `tests/support/moveServer.mjs`
- `tests/client/storageNotices.vitest.js`
- `tests/e2e/files.spec.ts`
- `tests/e2e/drive-storage.spec.ts`

## Public contract

The `mercbot.files` capability gives `store`, `apps`, `mounts`, `shell` (the bots' command
line, see `shell.md`) and `pages` (the pages bots write, see `pages.md`).

- Files live under `MERCBOT_FILES_DIR` (a JuiceFS volume shared by every server,
  mounted by `scripts/mount-files.sh`, which leaves a `.mercbot-files` marker; deployed servers
  start through `scripts/serve.sh`, which mounts it first and unmounts it on exit), or
  `.data/files` when it isn't set. Files belong to a home (D-36, D-47), in three folders:
  `homes/<home>/shared/` (`/files/shared`, everyone and every bot in the home),
  `homes/<home>/bots/<bot>/everyone/` (`/files/bot`, everyone in the home using that bot) and
  `homes/<home>/bots/<bot>/people/<user>/` (`/files/mine`, one person with that bot). A place is
  `{homeId, botId, userId}`; `{homeId, botId, everyone: true}` where nothing personal may be
  reached (a shared bot, a group), which has no private folder and whose `/files/mine/…` paths
  lead to the bot folder; or `store.homePlace(homeId)`, the home's folder alone. A configured
  folder without the marker is unavailable, so files never land on one server's own disk.
- People's profile pictures (D-19) are on the volume too, in `profile-pictures/<user>/avatar`
  (`store.profilePicturesFolder()`, unavailable like the rest without the volume). JSKIT's users
  package keeps them in its runtime storage under `users/avatars`; the files feature mounts
  `profilePictureDriver` there (`profilePictures.js`), so JSKIT's own folder (`data/storage`, or
  `JSKIT_STORAGE_FS_BASE_PATH`) no longer holds them. Each is written whole and then renamed. A picture
  still in JSKIT's folder from before is moved to the volume the first time that server reads it,
  linked in only where there's none yet, so a picture saved meanwhile through any server stays;
  removing a picture removes both copies.
- `store.prepare(place)` answers `{mine, bot, shared, personal}`. `resolve`, `existingFile`,
  `list(place)` (the files of each folder and its sub-folders, newest first, `{mine?, bot?,
  shared, left, partial}`: each folder's newest 300 files, and in `left` how many older ones each
  longer folder has; a folder's walk stops at 5,000 files, so listings stay cheap on every turn
  and command, and `partial` names the folders it stopped in; the three folders are walked at
  once, and each folder's files are looked at 32 at a time), `listFolder(place, folder)` (what
  is directly in one folder, for the file browser: `{path, entries, left, partial}`, its
  sub-folders as `{path, folder: true}` by name, then its newest 300 files; `left` counts its
  older files, only its first 5,000 entries are read and `partial` says it has more; a folder
  that isn't there is empty), `folderTree(place)` (`{mine?, bot?, shared}`: every sub-folder's
  path, in name order, at most 5,000 in each folder), `move`
  (files and folders, between any of the folders, never over a file or a folder into itself),
  `remove` (a file or an empty folder) and `makeFolder` only reach the place's folders;
  `existingFile` also checks the link-free real path.
- Everything the office apps run is in the bots' gVisor sandbox (D-49), through
  `gvisorProcess` in `shell.js`: the toolbox, no network, the place's folders (`noexec`) and the
  shell's limits. Without gVisor, the toolbox or the apps, `apps.available()` is false and nothing
  runs.
- `apps.session(place)` starts each app (`word`, `sheet`, `slides`, `pdf`) on first use, as
  `<app>-cli mcp` in its own sandbox, and keeps its open documents until `close()`, which also
  removes the sandbox.
- `apps.pagesOf` turns a file into PNGs of its first 20 pages in one sandbox run, and `apps.textOf`
  reads a document's text; both see the folders read-only and write only to a scratch `/out`.
  `apps.chartImage` draws a chart into the folders; `apps.voiceMemo` runs Piper (mounted at
  `/opt/piper`) on the text, into the folders.
- `appFor(path)` names the app that opens a file, and `appIcon(app)` its icon. On a computer's
  desktop the apps run in its desktop sandbox (`computer/bot-computer.md`).

- **Mounts live in Mercbot's own namespace (D-68):** `serve.sh` and `npm run develop` run Mercbot
  through `scripts/namespace.sh`, in a user and mount namespace of its own, where it mounts FUSE
  through `/dev/fuse` as that namespace's root. The files volume and people's rclone storage are
  seen only inside it, never by the host or other apps. JuiceFS mounts directly; rclone, whose FUSE
  library mounts only through a program named `fusermount3`, gets the hosting script's copy without
  the set-user-ID bit (`.tools/fuse`) first on its `PATH`, which mounts directly too. Both come off
  with plain `umount` (`serve.sh`, `remoteMounts`). With `MERCBOT_SANDBOX_USER` (outside
  Vibe64) it stays in the host's namespace, since sudo can't work in one, and mounts and unmounts
  with the host's `fusermount3`.

- A home may keep its files in its own WebDAV storage instead (D-26): the home's
  `file_storage` row holds the choice, sealed with the vault key. `storage.folder`
  mounts it with rclone (`remoteMounts`: rclone's settings come from the
  environment, uploads one second after a file closes, a 10-second listing cache,
  a private control socket) and the home's folders live under that mount.
  `store.settle(home)` waits until rclone's upload queue is empty; a reply that
  saved files waits for it before it's done, and shutdown settles every mount.

- Or in a Google Drive account connected in Connect apps (D-26, D-80; `driveStorage`):
  the person's own (`google-drive` plugin, reached `{ personal: true }`) or the
  home's. Choosing it makes one folder, `Mercbot – <home>`, in that Drive through
  Drive's own API (v3) and saves `{accountId, userId, label, folderId, folderName,
  driveFolders}` sealed. `driveFolders` (the folders Mercbot made for the home, by
  account) stays whatever the home chooses next, in a row of kind `mercbot` when
  nothing else is kept, so the same account chosen again reuses its folder while
  it's there and not in the bin; only a folder that's gone (404) or in the bin is
  made again. `userId` is whose account it is: the home's jobs reach it as that
  person (`forWorkspaceUser`). rclone's Drive backend mounts that folder
  (`root_folder_id`, scope `drive`, no change polling) and asks this server for
  each key at `POST /api/files/drive-token` (`driveTokenRoute`), on the server's
  own port (D-68): a form with a random key of that mount as its refresh key,
  answered only for this machine's own connections that came through no proxy
  (`ownMachine.js`, shared with the browsers' bridge; 403 `access_denied`
  otherwise). The answer is a token endpoint's: the account's key from
  `integrations.connections.accessToken`, while that Drive and folder are still
  the home's choice (`storage.driveKey`), with `expires_in` at most 60 s; each
  mount keeps what it was given and asks `storage.driveKey` again every 240 s, or
  when the key has less than two minutes left, so a mount follows the account and
  the home's choice within minutes; `400 invalid_grant` once the
  account needs signing in again or was removed, or the home keeps its files
  elsewhere (a mount another server kept), `503` otherwise. The account's
  refresh key never leaves Mercbot. rclone asks for a key only once its own runs
  out, even when Drive turns it down: the mount reads rclone's log (stderr, kept
  nowhere) for Drive's 401 and asks `storage.driveKey(…, {refused})` at once
  (`remoteMounts.keyRefused`), once per key, under the account's row lock
  (`connections.accessToken`), so a refused renewal signs the account out within
  seconds; a renewal that fails otherwise waits 15 s before the next, doubling to
  5 minutes. Until a renewal works or the account is signed in again (the mount
  was refused a key for good, or Drive turned its key down and the renewal
  failed), the mount's saves can't arrive, so `store.settle` and shutdown don't
  wait for them. `storage.folder` refuses a Drive whose
  account needs signing in again (409 `files_storage_sign_in_again`) or was
  removed (409 `files_storage_drive_gone`) before mounting, and the bots'
  recent-files note says so. A home's own storage that answers its folders with an
  I/O error (WebDAV offline, a Drive key turned down, a mount gone) is 503
  `files_storage_not_answering`, after `storage.explain` waits up to 1.5 s for that
  home's mount here to renew a turned-down key and answers 409
  `files_storage_sign_in_again` instead when Google refused it. Mercbot looks at
  the Drive (`drive.look`: Mercbot's folder's `trashed`, and `about`'s
  `storageQuota`, two calls) when Settings → Files opens (`GET …/files/storage?fresh=1`)
  or saves, and after each renewal of the home's key (about hourly, in the
  background), never for a file; it keeps what it saw in `file_storage.drive_look`
  (`{folderId, folder: here|bin|missing, used, limit, at}`, nothing secret), told
  only while `folderId` is still the home's folder. Outside production only, `MERCBOT_TEST_GOOGLE_DRIVE_URL`,
  `_PROXY` and `_CA` name the stand-in Drive (`tests/support/fakeDrive.mjs`),
  which the Test Preview starts.

- Choosing another place moves every file there first (D-80, `fileMoves`). `storage.choose` saves at once only the
  same place again, or `withoutFiles` when the files can't be read where they are (`unreadable`: a Drive to sign in
  again, removed or whose folder was deleted, WebDAV not answering; 409 `files_storage_move_needed` when they can).
  Otherwise it refuses unreadable files (409 `files_storage_source_unreadable`) or starts a move (`moves.start`): under
  the home's `file_storage` row lock (made first, kind `mercbot`, if the home has none) it refuses one already going
  (409 `files_storage_move_going`) and writes `move` (`{id, stage, from, to, target, startedAt, startedBy, files,
  bytes, filesDone, bytesDone, copied}`, `target` the new settings sealed), `move_status` `running`, an expired
  `move_lease_until` and `move_cancel` false. A server claims it under the same lock when its lease ran out
  (`moveLeaseExpired`), sets `move_claim` and a 60-second lease, and beats every 10 s, writing the progress; another
  server's sweep (every 30 s, `startSweeping`) takes over a move whose lease ran out. The move: the
  `whenStarting` listeners (the computer feature puts the home's awake computers to sleep), 15 s for saves still on
  their way through other servers' mounts when the files are in a Drive or WebDAV, a Drive source's folder out of the
  bin, then rclone (`mounts.transfer`: one run with `src:`/`dst:` remotes from the environment, Drive keys asked of
  this server like a mount's, its JSON stats as progress) `size`, `sync` (`--ignore-times` the first time,
  `--checksum` after, `--create-empty-src-dirs`, `--drive-stop-on-upload-limit`), the home's commands that started
  before the move waited for (stage `commands`, `runs.runningBefore`, at most 31 minutes) and what they changed
  copied again, then up to three rounds of `size` on both sides plus `check`, copying again when they differ. The
  switch writes the new kind and settings and `move_status` `switched` under the row lock while the claim holds and
  nobody cancelled; cleaning up puts a Drive source's folder in its bin
  (`drive.trash`), deletes Mercbot's own folder (`store.ownFolder`), stops the mount and ends `done`, dropping the
  sealed settings. Cancelled (`DELETE …/files/storage/move`, `move_cancel`) or failed, it ends `cancelled` or
  `failed` with a plain `error` and `sourceUnreadable`, the home unchanged, its partial copy in the Drive's bin or
  deleted from Mercbot's storage. While `move_status` is `running`, `storage.folder` refuses everything but reading
  (409 `files_storage_moving`): `store.prepare`, `resolve`, `move`, `remove`, `makeFolder` and
  `existingFile(…, {writing: true})` write, while listings, `existingFile`, previews and `textOf` read; a command
  started meanwhile is refused with that reason, and a computer woken meanwhile opens without the home's folders.
  `storage.heldInTheirDrive(home, user)` answers whose own Drive holds the home's files when it's that person's
  (`{account, moving, into}`, `into` while they move into it), else null. Mercbot's own pages remove no one from a home;
  a copy built on Mercbot that lets people be removed refuses while this answers.

Routes, under `/api/w/:workspaceSlug` for a bot in that home (404 otherwise), work
on the signed-in person's place with the bot, with `path` a bot path. The same `content`,
`preview`, `upload`, listing, `move`, `folder` and `DELETE` routes exist for the home's own folder
at `/api/w/:workspaceSlug/files…`:

- `GET …/bots/:botId/files?folder=` lists one of the place's folders (`listFolder`), and
  `GET …/files/folders` every folder there is (`folderTree`, for Move to…); `POST …/files/move
  {from, to}`, `POST …/files/folder {path}` and `DELETE …/files?path=` change them.

- `GET …/bots/:botId/files/content?path=[&download=1]` sends the file (read whole;
  the router doesn't pass streams through). Only
  PDFs, pictures and plain text are shown inline; everything else downloads.
- `POST …/bots/:botId/files/upload` (multipart, field `file`, up to 25 MB, through
  JSKIT's `runtime.uploads`) keeps a file the person attached in the bot's own
  `Uploads` folder, or the folder named by `?folder=` (a taken name gets a number) and answers `{path, name, size, type}`.
  `apps.textOf` reads a document's text in the sandbox for the bot's `read_file` tool.
- `GET …/files/storage` answers `{kind: "mercbot"}`, `{kind: "webdav", url,
  user, vendor}` or `{kind: "drive", accountId, account, folder, folderState, space,
  signedIn, gone, canSignIn}` for the home, each with `driveAccounts` (`[{id, label, home}]`, the
  connected Google Drive accounts the person reaches). `canSignIn`: the
  account is the person's own, or the home's and they may change its settings.
  `folderState` is `here`, `bin` or `missing` (null before Mercbot looked), and
  `space` `{used, limit, free, nearlyFull, at}` in bytes (`limit` and `free`
  null for a Drive without a limit), `nearlyFull` under 1 GB free
  (`NEARLY_FULL_BYTES`); with `?fresh=1` (Settings → Files) Mercbot looks at the
  Drive now, otherwise (the Files page) it tells what it last saw. Settings →
  Files shows the space beside the folder and, through `storageNotices.js`, says
  when the folder is in the bin (what the bots save goes there with it; Google
  empties the bin after 30 days) or deleted, with Choose again for owners and
  admins (the same account saved again: a new folder, the files moved into it, or none for a deleted folder), and when
  the Drive is nearly full or full; the home's Files page tells everyone the same. Every answer has `move`, the home's
  latest move (`{status, cancelling, from, to, stage, files, bytes, filesDone, bytesDone, error, sourceUnreadable,
  startedAt, finishedAt}`, `from` and `to` as `{kind, label}`) or null; Settings → Files follows a running one every
  2 s, with Cancel for owners and admins (Cancelling… until the move ends), and the Files page says the files are
  read-only meanwhile.
  `PUT …/files/storage` (owners and admins, else 403) chooses one: `{kind:
  "drive", accountId}` makes or reuses Mercbot's folder (400
  `files_storage_drive_account_unknown` for an account the person doesn't
  reach, 409 `files_storage_sign_in_again` when it needs signing in again);
  WebDAV storage is checked
  first (400 with the reason when it can't be reached or refuses the sign-in); `withoutFiles: true` switches without
  the files. `DELETE …/files/storage/move` (owners and admins, else 403) cancels the running move (409
  `files_storage_move_none` when there's none).
- `GET …/bots/:botId/files/preview?path=` answers `{kind: "pages", pages,
  more}`, `{kind: "image"}` or `{kind: "text", text, more}`, or 415 when there's no
  preview.

The file browsers (D-47): `FileBrowser` shows a place's folders with breadcrumbs and open,
download, upload, new folder, Move to…, rename and delete. It reads each folder as it is opened,
so a folder's older files and folders that hold only old files are reached however many newer
files the rest of the place has. Each bot's Details has a Files tab
(Just me for private and mixed bots, Everyone using the bot, the home's); the sidebar's Files
entry, above Apps, opens `/w/<home>/files`, with the home's folder and the home's bots (`GET
/api/w/:workspaceSlug/files/bots`: `{bots: [{id, name, color, shape}]}`, group chats left out),
each leading to `?bot=<id>&files=1` (that bot's Details on Files).

The bots package gives each reply the tools `list_files`, `app_help`, `use_app`
and `move_file`. Every file under `/files/` that an app call names and that was
saved during the reply becomes a `files` message (`{files: [{path, name, size}]}`)
after the reply's text. The timeline shows it as file cards, and the viewer shows
page pictures.
