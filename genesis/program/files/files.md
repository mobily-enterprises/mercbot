# Bots' files and office apps

Bots make and change documents, spreadsheets, presentations and PDFs with the
ArtCraft office apps, without a window, and the person gets each saved file as a
card in the chat with a viewer and a download (D-20, D-21).

## Sources

- Main: `packages/files/src/server/FilesFeature.js`
- `packages/files/src/server/filesRuntime.js`
- `packages/files/src/server/registerRoutes.js`
- `packages/files/src/server/sheetPreview.js`
- `packages/files/src/server/types.js`
- `packages/files/src/server/fileStore.js`
- `packages/files/src/server/fileTransfer.js`
- `packages/files/src/server/fileCopies.js`
- `packages/files/src/server/filesVolume.js`
- `packages/files/src/server/s3Bucket.js`
- `packages/files/src/server/filesCipher.js`
- `packages/files/src/server/syncedTree.js`
- `packages/files/src/server/profilePictures.js`
- `packages/files/src/server/officeApps.js`
- `packages/files/src/server/mcpClient.js`
- `packages/files/src/server/remoteMounts.js`
- `packages/files/src/server/storageSettings.js`
- `packages/files/src/server/fileMoves.js`
- `packages/files/src/server/fileStorageRepository.js`
- `packages/files/src/server/driveStorage.js`
- `packages/files/src/server/driveTokenRoute.js`
- `packages/files/src/server/ownMachine.js`
- `packages/files/src/server/mediaChecks.js`
- `packages/files/src/server/uploadedFile.js`
- `migrations/20261117120000_media_checks.cjs`
- `migrations/20261113120000_baseline.cjs`
- `src/components/mercbot/MercbotSettingsFiles.vue`
- `packages/files/package.json`
- `scripts/install-tools.sh`
- `scripts/tools-store.sh`
- `scripts/serve.sh`
- `scripts/namespace.sh`
- `scripts/hosting/vibe64.sh`
- `src/components/mercbot/filesApi.js`
- `src/components/mercbot/storageNotices.js`
- `src/components/mercbot/MercbotFileViewer.vue`
- `src/components/mercbot/useEscapeToClose.js`
- `src/components/files/FileBrowser.vue`
- `src/components/files/FileBrowser.css`
- `src/components/files/MercbotPlacePicker.vue`
- `src/components/files/filePlaces.js`
- `src/components/files/useFileTransfer.js`
- `src/components/files/HomeFiles.vue`
- `src/components/files/MercbotFilesEntry.vue`
- `src/pages/w/[workspaceSlug]/files/index.vue`

## Public contract

The `mercbot.files` capability gives `store`, `apps`, `mounts`, `shell` (the bots' command
line, see `shell.md`), `pages` (the pages bots write, see `pages.md`) and `storageKinds(workspaceIds, options)`: where
each of a batch of homes keeps its files (`mercbot`, `webdav`, `drive`; a home with no row keeps them in Mercbot's own storage), in
one statement over every home the options reach. The runtime also gives `volume` (`filesVolume.js`): where Mercbot's own
files are kept.

- Mercbot's own files are kept in an S3 bucket every server shares (D-91), when `MERCBOT_FILES_S3_BUCKET`,
  `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` and `MERCBOT_FILES_PASSPHRASE` are all set (`_ENDPOINT`, AWS's
  for the region by default, and `_PREFIX`, a folder of the bucket every key goes under, are optional). Each server
  works on a copy of what it uses in its files folder (`MERCBOT_FILES_DIR`, else `<data folder>/files`; `filesFolder`
  in `@local/account/data-folder`), kept in step with the bucket by a synced tree (`syncedTree.js`): a folder is pulled
  before it's read (again once its last pull is a second old, at once when a file asked for isn't there), and what
  changed here is pushed when it's settled (`store.settle(home)`, `settleRuns`, `settleComputer`,
  `settleProfilePicture`, `settlePrivate`), every 5 seconds once the server listens (`volume.startSyncing`), and when
  it stops (`volume.stop`). The bucket is the truth: a change here not yet pushed wins at the next pull, and between
  servers the last pushed wins; a folder is an empty object named with a trailing `/`; links stay on their server.
  Objects are addressed path-style (`<endpoint>/<bucket>/<key>`) and signed with aws4fetch (`s3Bucket.js`), and each
  file is sealed before it leaves (`filesCipher.js`: AES-256-GCM in 64 KiB pieces, a key per object made from the
  files key). The files key is kept in the bucket as `.mercbot-files`, sealed with a key made from the passphrase
  (scrypt): a server that finds none makes one and offers it to the database (`files_keys`, one row a bucket), which
  keeps the first offer; every server writes and uses the kept one, so servers starting together use one key on any S3
  store, with no conditional write (some stores refuse If-None-Match, 501). The files folder is the server's own: it's
  emptied when the server starts using it, and one holding files Mercbot didn't put there keeps the bucket off. The
  bucket is unavailable (503 `files_unavailable`) until its key opens; a failure is logged and tried again after
  30 seconds. With any setting missing, files are in the files folder itself: `MERCBOT_FILES_DIR`, a folder the host
  shares between servers, which must hold a `.mercbot-files` marker, or `.data/files` when it isn't set.
  Files belong to a home (D-36, D-47, D-112), in three kinds of folder:
  `homes/<home>/chats/<chat>/` (`/files/chat`, one chat's, for whoever can open it, R6),
  `homes/<home>/bots/<bot>/everyone/` (`/files/bot`, one bot's, in every chat it's in and for everyone in the home:
  its Knowledge files and pages) and `homes/<home>/shared/` (`/files/shared`, the whole home's). A place is
  `store.placeFor({homeId, chatId, chatKind, botId?})` (a chat's files, with its bot's when a bot works there),
  `store.botPlace({homeId, botId})` (a bot's own folder and the home's) or `store.homePlace(homeId)` (the home's folder
  alone). What a bot makes in a chat belongs to that chat (D13): in a Private chat, or one whose kind isn't given, the
  place only reads `/files/bot` and `/files/shared`, in the store and in every sandbox (403
  `files_wider_needs_card`: "This is a private chat, so its bots only read …"), unless it is widened
  (`store.widened(place)`): what a person does themselves (the file routes) or a card a person tapped, never the bot
  alone; only server code can mark a place so. `store.removeChatFolder(homeId, chatId)` removes a deleted chat's
  folder. A configured folder without the marker is unavailable, so files
  never land on one server's own disk. What writes into the files folder outside the store (the
  usage archive, D-73) reaches the bucket through the working copy the files feature hands the account's sweeps (`files.volume.sync`, `useFilesSync`).
- People's profile pictures (D-19) are kept with the bots' files, in `profile-pictures/<user>/avatar`
  (`store.profilePicturesFolder(user)`, which pulls that person's folder first; unavailable like the rest), and
  pushed once written or removed (`settleProfilePicture`). JSKIT's users
  package keeps them in its runtime storage under `users/avatars`; the files feature mounts
  `profilePictureDriver` there (`profilePictures.js`), so JSKIT's own folder (`data/storage`, or
  `JSKIT_STORAGE_FS_BASE_PATH`) no longer holds them. Each is written whole and then renamed. A picture
  still in JSKIT's folder from before is moved over the first time that server reads it,
  linked in only where there's none yet, so a picture saved meanwhile through any server stays;
  removing a picture removes both copies.
- A copy built on Mercbot may keep files of its own where nothing serves them (D-90): `store.privateFolder(name)`
  makes and answers `<files folder>/<name>` (mode 700, pulled from the bucket first; `store.settlePrivate(name)` sends
  what's written there), beside the store's own folders and outside every place, so no route
  serves it and no sandbox mounts it. `name` is 3 to 41 lowercase letters, digits and hyphens, starting with a letter,
  and not one the store uses (`homes`, `runs`, `computers`, `profile-pictures`, `usage-archive`); while the files
  aren't available it answers 503 `files_unavailable`.
- **Checking pictures and videos (D-90):** a copy built on Mercbot may provide `mercbot.media-check` (`MediaCheck`,
  `@local/account/server/types`), which the files feature reads and gives on as `files.media` (`mediaChecks.js`):
  `check` and `checkText` (the guard of `@local/account/media-check`, which sniffs a file's first bytes, passes
  only pictures and videos to the checker, and counts a failure as `unavailable`), `screenshotLater`, `filesLater`,
  `remove`, `sweep`, `startSweeping` and `stop`. Mercbot has none: everything is allowed and nothing is queued. With
  one, an upload (`uploadedFile.js` `writeUpload`) and a new profile picture are checked before they're written;
  refused, the upload route answers 422 `media_blocked` or 503 `media_check_unavailable` with `{error, code}`, and
  JSKIT's avatar route the same `FilesError`. An upload's check gets the place the route writes to (a chat's, a bot's
  or the home's) as the item's `place`, and a saved file's the place in its
  row; every other origin's is null. The screenshots a bot's reply shows (the last four under it and a hand-over
  card's) and the files a bot's turn saves are checked afterwards, every file a command changes included: a
  command's `changed` names its newest 50, so the shell queues the rest itself from `store.changedSince(place,
  since)` (every file, hidden ones too, without `list`'s limits, read only with a checker), and all of them once the
  command runs on after its turn. Each picture or video among them gets a `media_checks` row (`{workspaceId, origin,
  place, path, chatBotId, userId, conversationId, attempts, checkAfter}`; a screenshot's computer is its
  `chatBotId`, and the check is handed it as `conversationId`), a shown screenshot's once its reply's turn is
  over (botTools.js `close`, after it was written) and taken 30 seconds later, a turn's once its saves are settled;
  a screenshot nobody is shown is never queued. Every server sweeps every 20 seconds once it listens: one
  transaction claims up to 25 due rows (`SKIP LOCKED`) and holds them five minutes; they're checked three at a time,
  and the rows done go in one statement. A blocked file is removed (a file through `existingFile(…, {writing:
  true})`, so it waits while the home's files move, D-80); one that can't be checked now waits a minute, then twice as long each time, up to 30 minutes;
  a file gone, or no longer a picture or video, leaves the queue; one over 100 MB is removed unchecked. Shutdown
  stops the sweep; rows this server held go to another once their hold ends. A copy whose own review later judges a
  file its check allowed removes it with `remove({origin, place, path, conversationId, workspaceId})`, as the check
  gave them: an upload's or a saved file's from its place as the sweep does (`existingFile(…, {writing: true})`,
  then `store.settle(place.homeId)`), a screenshot's from its computer's folder (`store.computerFile`, then
  `store.settleComputer`), answering `"removed"` or `"gone"`; any other origin answers `"not_kept_here"` and does
  nothing. A path outside the place is refused (`files_path_outside`), as are a place missing or in another home
  than the item's (`media_place_invalid`) and a name or computer that isn't a screenshot's
  (`media_screenshot_invalid`), each a 400 `FilesError`.
- `store.prepare(place)` answers the place's real folders, `{chat, bot, shared, readOnly}` (each null when the place
  has none; `readOnly` the ones it may only read). `resolve`, `existingFile`,
  `list(place)` (the files of each folder and its sub-folders, newest first, `{chat?, bot?,
  shared, left, partial}`: each folder's newest 300 files, and in `left` how many older ones each
  longer folder has; a folder's walk stops at 5,000 files, so listings stay cheap on every turn
  and command, and `partial` names the folders it stopped in; the three folders are walked at
  once, and each folder's files are looked at 32 at a time), `listFolder(place, folder)` (what
  is directly in one folder, for the file browser: `{path, entries, left, partial}`, its
  sub-folders as `{path, folder: true}` by name, then its newest 300 files; `left` counts its
  older files, only its first 5,000 entries are read and `partial` says it has more; a folder
  that isn't there is empty), `folderTree(place)` (`{chat?, bot?, shared}`: every sub-folder's
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

- **Nothing mounts (D-91):** the bucket is reached over HTTP and people's storage through
  rclone's remote control, so no host is asked for FUSE. `serve.sh` and `npm run develop` still
  run Mercbot through `scripts/namespace.sh`, in a user and mount namespace of its own, for its
  sandboxes (D-68).

- A home may keep its files in its own WebDAV storage instead (D-26): the home's
  `file_storage` row holds the choice, sealed with the vault key. `storage.folder`
  starts the home's `rclone rcd` (`remoteMounts`: rclone's remote control on a private
  socket, its settings from the environment, no mount) and answers `{dir, tree}`: the
  home's folders are a working copy in `<data folder>/mounts/<home>` (emptied when it
  starts; still called the home's mount), a synced tree whose remote is that rclone
  (`operations/list`, `copyfile`, `deletefile`, `mkdir`, `rmdir`), pulled before
  they're read and pushed every 2 seconds. `store.settle(home)` waits
  until what changed there has reached the storage (at most 30 s); a reply that saved
  files waits for it before it's done, and shutdown settles every home's copy.

- Or in a Google Drive account connected in Connect apps (D-26, D-80; `driveStorage`):
  one of the home's (`google-drive` plugin), as every account is (D-111). Choosing it
  makes one folder, `Mercbot – <home>`, in that Drive through
  Drive's own API (v3) and saves `{accountId, userId, label, folderId, folderName,
  driveFolders}` sealed. `driveFolders` (the folders Mercbot made for the home, by
  account) stays whatever the home chooses next, in a row of kind `mercbot` when
  nothing else is kept, so the same account chosen again reuses its folder while
  it's there and not in the bin; only a folder that's gone (404) or in the bin is
  made again. `userId` is whose account it is: the home's jobs reach it as that
  person (`forWorkspaceUser`). rclone's Drive backend reaches that folder
  (`root_folder_id`, scope `drive`) through the home's `rclone rcd`, as for WebDAV, and asks this server for
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
  nowhere) and its answers for Drive's 401 and asks `storage.driveKey(…, {refused})` at once
  (`remoteMounts.keyRefused`), once per key, under the account's row lock
  (`connections.accessToken`), so a refused renewal signs the account out within
  seconds; a renewal that fails otherwise waits 15 s before the next, doubling to
  5 minutes. Until a renewal works or the account is signed in again (the mount
  was refused a key for good, or Drive turned its key down and the renewal
  failed), the mount's saves can't arrive, so `store.settle` and shutdown don't
  wait for them; they stay in the home's copy here and go with a later push. `storage.folder` refuses a Drive whose
  account needs signing in again (409 `files_storage_sign_in_again`) or was
  removed (409 `files_storage_drive_gone`) before starting it, and the bots'
  recent-files note says so. A home's own storage that answers its folders with an
  error (WebDAV offline, a Drive key turned down, its rclone gone) is 503
  `files_storage_not_answering`, after `storage.explain` waits up to 1.5 s for that
  home's mount here to renew a turned-down key and answers 409
  `files_storage_sign_in_again` instead when Google refused it. Mercbot looks at
  the Drive (`drive.look`: Mercbot's folder's `trashed`, and `about`'s
  `storageQuota`, two calls) when Settings → Files opens (`GET …/files/storage?fresh=1`)
  or saves, and after each renewal of the home's key (about hourly, in the
  background), never for a file; it keeps what it saw in `file_storage.drive_look`
  (`{folderId, folder: here|bin|missing, used, limit, at}`, nothing secret), told
  only while `folderId` is still the home's folder. Outside staging and production only,
  `MERCBOT_TEST_GOOGLE_DRIVE_URL`, `_PROXY` and `_CA` name the stand-in Drive
  (`tests/support/fakeDrive.mjs`), which the Test Preview starts.

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
  their way from other servers' copies when the files are in a Drive or WebDAV, a Drive source's folder out of the
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
  `storage.heldInTheirDrive(home, user)` answers whether a Google Drive account that person added holds the home's
  files (`{account, moving, into}`, `into` while they move into it), else null: their accounts go when they leave
  the home (D-111), so the files would go with them. Mercbot's own pages remove no one from a home;
  a copy built on Mercbot that lets people be removed refuses while this answers.

Routes, all under `/api/w/:workspaceSlug/files`, name their place in the query (`registerRoutes.js` `placeOf`):
`?chat=` the chat's folder, `?bot=` the bot's, both a bot in that chat, always with the home's; without either, the
home's folder alone. A chat the caller can't open, a bot not in the home or not in that chat is 404
`files_place_not_found` ("That chat or bot isn't here."). What a person does here is their own doing, so a Private
chat's wider folders take it (the place is widened, D13). The page names the chat in every address (`filesApi.js`
through `chatPlace.js` `placeQuery`), and `path` is a bot path (`/files/chat/…`, `/files/bot/…`, `/files/shared/…`):

- `GET …/files?folder=` lists one of the place's folders (`listFolder`), and
  `GET …/files/folders` every folder there is (`folderTree`, for Move to…); `POST …/files/move
  {from, to}` (moving and renaming inside one place), `POST …/files/folder {path}` and `DELETE …/files?path=` change
  them.

Two routes name their places in the body instead (`fileTransfer.js`, D-120), each place
`{kind: "home"} | {kind: "bot", botId} | {kind: "chat", chatId}`, resolved with the caller's rights as `placeOf` does
(404 `files_place_not_found` for one they can't open, a bot of another home or an id that isn't one; a chat's place is
widened, the person's own doing):

- `GET …/files/places` answers `{places}`: `{kind: "home", label: "Home files"}`, then every bot of the home that isn't
  archived, in id order (`{kind: "bot", botId, name, color, shape, main}`), then every chat the person can open, newest
  made first (`{kind: "chat", chatId, title, private, direct: "bot" | "person" | null, archived}`): their own, hidden
  and archived ones too, and the public rooms they aren't in, a direct chat titled by its other side. Three reads (the
  bots, `directory.openableChats`, the other people's names) whatever the number of chats.
- `POST …/files/transfer {mode: "copy" | "move", from: {place, path}, to: {place, folder}, confirmed?}` copies or moves
  a file or a whole folder and answers `{path}`, the full path where it arrived. Paths are full bot paths under the
  place's own folder: `/files/shared/…` for the home, `/files/bot/…` for a bot, `/files/chat/…` for a chat (400
  `files_path_outside` for any other, or for the folder itself as the source). A folder that isn't there yet is made;
  a name taken there gets " (2)", " (3)" before its extension. Refusals: 404 `files_file_gone` for a source that isn't
  there; 409 `files_transfer_same` for a move into the folder it's in, or a folder into itself or one of its folders;
  409 `bots_chat_archived` into an archived chat, or a move out of one; 409 `files_storage_moving` while the home's
  files move (D-80); and 409 `files_wider_needs_confirm` ("Everyone who can open <place> will see this file.
  Continue?", `params.place`) when the source is a private chat (a private room, a chat with a bot or between two
  people) and the destination is the home's files, a bot's, a public room, or a private chat with someone not among
  the source's people, unless `confirmed` is `true`. The store's `transfer` (`fileCopies.js` `placeTransfer`) renames
  a move (copying then removing across disks), and copies a folder one directory entry at a time, links left out,
  never reading the tree into memory. Every file that arrived is queued for a copy's check like a bot's saved file
  (`media.filesLater`, 200 at a time, each batch after the files are settled, D-90); the moved pages' versions and
  publications follow them, into another bot's folder too, all of the move's pages together once the files have moved
  (`pages.pathsChanged` with `toBotId`, D-74: the same statements for 2 pages or 40); a copied page gets a
  new key and no versions (`pages.copied`).

- `GET …/files/content?path=[&download=1]` sends the file (read whole;
  the router doesn't pass streams through). Only
  PDFs, pictures and plain text are shown inline; everything else downloads.
- `POST …/files/upload` (multipart, field `file`, up to 25 MB, through
  JSKIT's `runtime.uploads`) keeps a file the person attached in `Uploads` in the chat's folder, whoever else is in
  the chat, people alone included (D-114; with only a bot, the bot's; with neither, the home's), or the folder named by `?folder=` (a taken name gets a number) and answers `{path, name, size, type}`.
  A copy that checks pictures and videos (D-90) checks one before anything is written, read whole up to the limit:
  422 `media_blocked` ("This file can't be used.") or 503 `media_check_unavailable` ("This file can't be checked
  right now. Try again in a few minutes."), or the checker's own sentence; the chat's attachments and the file
  browser show it.
  `apps.textOf` reads a document's text in the sandbox for the bot's `read_file` tool.
- `GET …/files/storage` answers `{kind: "mercbot"}`, `{kind: "webdav", url,
  user, vendor}` or `{kind: "drive", accountId, account, folder, folderState, space,
  signedIn, gone, canSignIn}` for the home, each with `driveAccounts` (`[{id, label}]`, the home's
  connected Google Drive accounts). `canSignIn`: as in Connect apps, the person added the account, or they
  may change the home's settings (D-111).
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
- `GET …/files/preview?path=` answers `{kind: "pages", pages,
  more}`, `{kind: "image"}` or `{kind: "text", text, more}`, or 415 when there's no
  preview.

The file browser (D-47): one `FileBrowser` everywhere. On the left it lists every place the person can open, read
once as it opens (`GET …/files/places`, ordered by `filePlaces.js` `orderPlaces`): the chat it was opened from first
("This room", or "This chat" for a direct chat), then Home files, then the bots (the home's main bot first, when the
place says `main`), then the rooms and chats ("Rooms and chats", an archived one taking nothing new). On the right it
shows one folder of the place chosen, with breadcrumbs, upload and new folder, reading each folder as it is opened
(`useFolderListing`), so a folder's older files and folders that hold only old files are reached however many newer
files the rest of the place has. Where it is narrower than 600px (a phone, or the details panel) the places are a
picker at the top instead. Each place is reached by the per-place routes as before: the home's naming neither chat nor
bot, a bot's naming the bot, a chat's naming the chat (through the bot whose card it's on, or the chat's first bot, for
the chat it was opened from, so the viewer offers Edit on computer there). The sidebar's Files button, beside Search
and before Apps, opens `/w/<home>/files`, the browser at Home files; chat details' Files tab opens it at the chat; a
bot's card's Files tab at the bot's own files (`?bot=<id>&files=1` still opens that card on Files).

Every file and folder has Open, Download (files), Rename, Copy to…, Move to… and Delete. Copy to… and Move to… open
`MercbotPlacePicker` (a place, then a folder in it, then "Copy here" or "Move here"; it refuses an archived chat, a
folder into itself and a move to where it already is). Rows drag onto the places in the left column: a move, or a copy
with Ctrl held (⌥ on a Mac), the place saying "Move to <place>" or "Copy to <place>" while something is over it.
`useFileTransfer` runs all of them alike: a move inside one place is the place's own `POST …/files/move`; anything else
is `POST …/files/transfer`, and its 409 `files_wider_needs_confirm` asks "Everyone who can open <place> will see this
file. Continue?", sending it again with `confirmed: true` on Continue. Refusals go to the shared snackbar, in the
server's words. The message box's + has Add from files…: the same picker over every other place, choosing files, each
copied into the chat's `Uploads` by the same transfer and attached to the message being written as an attached upload
is (`useComposerFiles` `addCopies`: its name, size and path in the chat's folder); a file not copied is left out.

The bots package gives each reply the tools `list_files`, `app_help`, `use_app`,
`move_file` (inside one folder) and `transfer_file` (to another place, on a card; `genesis/program/bots/bot-tools.md`). Every file under `/files/` that an app call names and that was
saved during the reply becomes a `files` message (`{files: [{path, name, size}]}`)
after the reply's text. The timeline shows it as file cards, and the viewer shows them: `GET …/files/preview` answers an
.xlsx or .csv as `{kind: "sheet", sheets: [{name, rows, more}], more}` (`sheetPreview.js`: every sheet by name, at
most 10 sheets, 500 rows and 40 columns each, cells as text with dates as `2026-11-23` and their time when they have
one, empty rows at the end and empty columns on the right left out; one it can't read falls back on pictures), which
the viewer draws as a table with column letters and row numbers that stay in view, numbers to the right, and a tab per
sheet; a Markdown file formatted, tables and task boxes included, with Formatted and Source to read it as written;
other text as it is; and documents, other spreadsheets, slides and PDFs as page pictures.

## Proved by

- `tests/server/files.test.js`
- `tests/server/sheetPreview.test.js`
- `tests/server/filesBucket.test.js`
- `tests/server/mediaChecks.integration.js`
- `tests/server/mediaCheckRoutes.integration.js`
- `tests/server/driveMount.test.js`
- `tests/server/driveStorage.integration.js`
- `tests/server/fileMoves.integration.js`
- `tests/server/fileTransfer.integration.js`
- `tests/client/storageNotices.vitest.js`
- `tests/client/uploadRefusal.vitest.js`
- `tests/client/fileBrowser.vitest.js`
- `tests/e2e/files.spec.ts`
- `tests/e2e/drive-storage.spec.ts`
- `tests/server/filesRoutes.integration.js`
- `tests/server/chatUploads.integration.js`
- `tests/server/filesKeys.integration.js`
- `tests/server/profilePictures.integration.js`
- `tests/server/profilePictures.test.js`
