# Bot computer

Gives each bot in each chat its own small desktop with a web browser that the chat's people can
watch and take over (docs/architecture.md §3.5, decisions D-11 to D-14; D-112's D14 and D16).

## Sources

- `migrations/20261113120000_baseline.cjs`
- `migrations/20261122120000_chats_core.cjs`
- `migrations/20261122130000_computer_control.cjs`
- Main: `packages/computer/src/server/ComputerFeature.js`
- `packages/computer/src/server/registerRoutes.js`
- `packages/computer/src/server/shellQuote.js`
- `packages/computer/src/server/types.js`
- `packages/computer/src/server/computerControl.js`
- `packages/computer/src/server/computers.js`
- `packages/computer/src/server/computerRecords.js`
- `src/components/mercbot/MercbotChatComputers.vue`
- `src/components/mercbot/MercbotChatComputer.vue`
- `src/components/mercbot/MercbotLiveView.vue`
- `src/components/mercbot/computerApi.js`
- `src/components/mercbot/chatPlace.js`
- `src/components/mercbot/useLiveView.js`
- `packages/computer/src/server/computerManager.js`
- `packages/computer/src/server/signInChain.js`
- `packages/computer/src/server/webPage.js`
- `packages/computer/src/server/recorder.js`
- `packages/computer/src/server/browserState.js`
- `packages/computer/src/server/desktopSandbox.js`
- `packages/computer/src/server/cdpBridge.js`
- `packages/files/src/server/gateway.js`
- `packages/computer/assets/terminal.svg`
- `scripts/measure-browser-speed.mjs`
- `packages/computer/src/server/stagehandModel.js`
- `packages/computer/src/server/desktop.js`
- `packages/computer/assets/wallpaper.png`
- `packages/computer/assets/browser.svg`
- `packages/computer/src/server/vncBridge.js`
- `src/components/mercbot/MercbotVncScreen.vue`
- `packages/computer/package.json`
- `src/components/mercbot/MercbotHandoverCard.vue`
- `src/components/mercbot/MercbotLightbox.vue`
- `packages/computer/src/server/codingRuns.js`
- `packages/computer/src/server/codingSandbox.js`
- `scripts/measure-coding-sandbox.mjs`
- `scripts/coding-tools/package.json`
- `scripts/coding-tools/package-lock.json`

## Public contract

**One computer per bot in each chat** (D14, D-112). A bot's computer belongs to its seat in a chat: everyone who can
open the chat can watch it and use what is signed in on it (a Public chat's computer is the whole home's), and nothing
on it reaches another chat. A bot in three chats has three computers.

**Keying.** The computer service is keyed by `computerId`, the bot's seat (`chat_bots.id`). `bot_computers`,
`bot_browser_state` (whose key it is) and `computer_tickets` hold `chat_bot_id`, and go with the seat (ON DELETE
CASCADE): taking a bot out of a chat, or deleting the chat, the bot or the home, takes its computers there with it.
`bot_computers.controlled_by` and `controlled_at` say which person has control now, and `bot_browser_state.sign_ins`
lists what it is signed in to (`[{ label, kind, since }]`, kind `site`, `coding` or `sedna`;
`migrations/20261122130000_computer_control.cjs`).

**Routes** (`/api/w/:workspaceSlug/bots/:botId/computer…?chat=<chatId>` and `…/screenshots/:name`): that bot's computer
in that chat, for anyone who can open the chat; a chat they can't open, or a bot not in it, is 404
`computer_not_found` ("That computer isn't here."). The page names the chat in every address (`chatPlace.js`
`placeQuery`, `computerApi.js`). `GET …/computer` answers `{ state, url, error, control, signIns }`; `POST …/wake`,
`…/ticket`, `…/open`, `…/take-over`, `…/hand-back` and `…/reset`, and `GET …/stream`. A computer's files are its chat's
(`/files/chat`, `files.store.placeFor`), and `POST …/computer/open` opens a file from there. `POST …/computer/reset`
starts one computer afresh, its saved browser and sign-ins gone, for anyone who can open its chat, as they all use it.
`POST /api/w/:workspaceSlug/computers/reset` (Settings → Computer → Reset) resets the computers of the chats whose only
person is the caller; a chat with other people keeps its computers, which are theirs too (their chat list a page of
100 at a time, as `GET …/chats` reads it, then two reads). A paused home's wake answers 402.

**Taking over and handing back** (D16, `computerControl.js`): anyone who can open the chat takes a bot's computer over,
from the bot or from another person, and anyone who can open it hands it back. Each posts a line in the chat ("<Name>
took over <Bot>'s computer.", " from <Other>" when taken from someone; "<Name> handed <Bot>'s computer back.") and
answers `{ messages, control }`; the chat's people hear a `messages` and a `computer` event on bot events, on any
server. While a person has control the bot's own computer actions are refused (409 `computer_person_in_control`
"<Name> has control of <Bot>'s computer. Wait until they hand it back."); a computer that goes to sleep is the bot's
again. Each sign-in the bot makes there (a website's, a coding tool's, Sedna's) is noted in its sign-ins list, and the
chat gets D14's line, "Everyone who can open this chat can use this sign-in."

**In the chat's details** (`MercbotChatComputers.vue`, `MercbotChatComputer.vue`): its Computers tab has one entry per
bot, "<Bot>'s computer", with "It belongs to this chat. The chat is public, so everyone in <home> can watch it and use
what's signed in on it." (or, Private, "Only the chat's members can watch it and use what's signed in on it."), its
state ("Asleep", "Awake", "Starting up", with " · You have control" or " · <Name> has control"), "Signed in on it" (each
sign-in, coding ones as "<label> (coding)", or "Nothing yet."), Watch and Take over, or Hand back while the person has
control; Take over is greyed out while someone else has it. A bot's card opened beside another chat says "<Bot> has its
own computer in each chat it's in. Open one from that chat's details." The live view (`MercbotLiveView.vue`) shows "Watching" with
Take over, or "You have control. <Bot> waits until you hand it back." with Hand back ("I'm done" when the bot asked the
person to do something there); Escape hands back.

**A chat deleted** (`chatRemoved({ homeId, chatId, chatBotIds })`): its computers go to sleep wherever they run (a
notice every server hears) and its folder, its computers' folders and its command outputs go from where the home's
files are kept; each step's failure is said and the rest go on. Every server sweeps at most hourly for computer
folders whose seat is gone.

Everything a computer runs is in gVisor (D-49), and nothing listens on a TCP port but the server's
own (D-68), which is all a published server may bind. Waking a bot's computer starts, on a free
display number picked at that moment: `Xvfb :N` (1280×800, no TCP, no shared memory), the desktop,
`x11vnc` on that display listening only on a Unix socket of the server's own temporary folder
(`x11vncArgs`: `-unixsock`, `-rfbport 0`, no IPv6, `-noshm`), and the computer's **desktop
sandbox** (`desktopSandbox.js`). That sandbox is one gVisor sandbox (`runsc --rootless
--network=none`, on KVM only with `MERCBOT_GVISOR_PLATFORM=kvm`) holding Chrome and the Craft
apps:
- **What it sees:** the toolbox (Chrome for Testing in `/opt/chrome`), the display's socket,
  the profile at `/profile`, Stagehand's extension, and the chat's folders (`noexec`). On a host whose
  programs come from a read-only Nix store (`MERCBOT_TOOLBOX_STORE`, D-86), the toolbox is links into the store made at
  start (`files/shell.md`), `/opt/chrome/chrome` is the store's Chromium, and the sandbox sees the store read-only at
  its own path; the desktop's own programs (`Xvfb`, `x11vnc`, `openbox`, `tint2`, `hsetroot`, `xterm`) are found on
  `PATH` as anywhere, and the browser's launcher (`chrome.sh` in the server's temporary folder) needs that folder to
  allow programs. The office apps there start through the toolbox's nix-ld (D-89) and draw with the store's Mesa,
  whose manifests are where `VK_ICD_FILENAMES` and `__EGL_VENDOR_LIBRARY_FILENAMES` lead (`DESKTOP_GRAPHICS`, the
  same places as in Mercbot's own toolbox). The display's socket folder is mounted `noexec` and every folder keeps `nosuid,nodev`, so a host's
  `/tmp` that forbids programs doesn't stop the sandbox.
- **Chrome:** Mercbot starts it itself (headful, `--display=:N`, `--no-sandbox` since gVisor is
  the sandbox, `--proxy-server=http://127.0.0.1:3128`), with remote control on port 9222 inside
  the sandbox, which the forwarder offers as `/io/cdp.sock`, a Unix socket on the server
  (`cdpSocket`). Stagehand (`localBrowser.connect`) and Puppeteer take only a `ws://` address, so
  they connect through the server's own port: `cdpBridge.js` gives each browser a route
  `/api/computer-cdp/<key>/devtools/…`, with a fresh random 256-bit key known only to the server
  process, and passes the WebSocket byte for byte to the Unix socket. It refuses an unknown key,
  any path but `/devtools/…`, a connection from another machine, and any request carrying proxy
  headers (`Forwarded`, `X-Forwarded-*`, `X-Real-IP`, `Via`; `@local/files/own-machine`, which a
  Google Drive mount's key route shares), so nothing that comes through the public proxy reaches a
  browser. Stagehand's extension, which dials CDP from inside the sandbox
  where the server's port can't be reached, gets Chrome's own address there (`extensionCdpUrl`).
- **No shared memory on the display:** shared memory ids belong to an IPC namespace, and the apps
  in gVisor would send ids from gVisor's own that Xvfb looks up in Mercbot's, where the same id can
  name x11vnc's segment; Chrome then drew into memory Xvfb never read and produced no frames
  (found on a real host, 2026-11-10). So Xvfb offers no MIT-SHM and x11vnc doesn't use it.
- **No `-localhost`:** it only limits TCP, which `-rfbport 0` and `-rfbportv6 -1` already turn off. x11vnc (nixpkgs'
  0.9.17, which a store host's machines get (D-86), Ubuntu 26.04's and 24.04's) holds the Unix socket's clients to it too:
  it names each "localhost", which doesn't match the 127.0.0.1 it allows, and drops it right after the version
  exchange, so every live view ended in "Couldn't reach the screen" (found on a real store host, 2026-11-19).
  `tests/e2e/live-screen.spec.ts` wakes a computer with a real Xvfb, x11vnc and Chromium, reads its pixels through
  noVNC and the relay, and checks that x11vnc listens on no TCP port, with `MERCBOT_X11VNC`'s x11vnc or the one on
  `PATH`.
- **Internet:** the only way out is the gateway (`@local/files/gateway`, which bots' commands and coding runs use
  too, D-126), an HTTP proxy on the sandbox's `/io/gateway.sock`, reached through a forwarder inside it. It resolves names itself, and refuses
  loopback, private, link-local (cloud metadata), CGNAT, reserved and multicast addresses, the
  server's own addresses and mail ports. It keeps a short list of where it connected. The browser's gateway has none
  of the commands' limits on amounts and connections (D-127).
- **Without gVisor:** without gVisor or a toolbox with Chrome, computers don't start.
- **Cleanup:** sandboxes of a server that's gone are removed when the next one starts; their
  folders are named after their server's process.

Sleeping, or Mercbot stopping, shuts everything down, with any apps the person opened. If x11vnc
stops by itself while the computer is awake, why is logged and it starts again on a new socket (open live
views reconnect with a new ticket); only after more than 3 stops in a minute does the computer
sleep with "The screen connection stopped." One stopped by putting the computer away is neither: a computer
stays awake until its put-away has ended (`puttingAway`), and its x11vnc, ended with the display, used to be taken
for a stop, logged ("stopped (code 2): caught signal: 15"), started again on the display already gone ("didn't start
again", x11vnc's can't-open-display text) and the computer put away a second time with that error. A computer is
put away once: an idle timer or anything else asking while it's under way waits for the same put-away.

The desktop (D-23, `desktop.js`) is written fresh into
`<data>/computers/desktop-<bot>` on every wake: openbox with our theme (red,
yellow and green buttons on the left, apps opening maximised), the wallpaper set
by `hsetroot`, and two `tint2` bars: a translucent top bar ("Mercbot", the open
windows, a clock) and a centred dock with Browser (a new window of the bot's
Chrome) and the office apps, and a Terminal. Right-clicking the desktop shows the same apps. The
office apps run in the desktop sandbox. The Terminal is an xterm attached to the
seat's command-line session in the chat (`files/shell.md`): the bot's commands live above, the
person's own shell below. Without `tint2` or `hsetroot` the desktop has no bars or wallpaper.
Every xterm the server opens there (`xtermCommand`: the Terminal, a coding run's progress, a sign-in) runs, in
Mercbot's own namespace (D-68), in a user namespace of its own as the host's own user (`asHostUser`): as that
namespace's root, xterm gives its program root's groups before starting it, which a user namespace refuses, and the
window closed at once. `tests/server/xtermWindow.test.js` starts one there with a real Xvfb and xterm.
`POST …/computer/open?chat=` (`{path}`, a path in the chat's files) wakes the computer
where it runs (the `open` operation is forwarded like the others) and opens that
file in its app; the viewer's "Edit on computer" calls it, then opens the live
view in control. An archived bot's computer (D-108) neither wakes nor opens a file: both answer 409
`bots_bot_archived` ("<bot> is archived. Unarchive it to use its computer."), and archiving puts its awake computers to
sleep through the capability's `sleepHome(home, among)`, which with `among` sleeps only those computers (without it,
every computer of the home, as a move of its files does, D-80). An archived bot's computers stay asleep in every chat.

**Coding tools (`codingRuns.js`, `codingSandbox.js`, D-77).** Claude Code and
Codex CLI, pinned in `scripts/coding-tools` (npm lock with integrity) and installed by
`scripts/install-tools.sh` into `.tools/coding`. Each is signed in by the person with their own
account, never a shared one (Mercbot resells no credits), through the `code` operation
(`{action: "status"|"signIn"|"start"|"stop"}`, forwarded to the computer's server like the others,
waking it).
- **A sandbox of its own (`startCodingSandbox`).** Every run and every sign-in is a fresh rootless
  gVisor sandbox beside the computer's, never inside it (`runSandboxed`, `@local/files/gvisor`). It
  sees the toolbox read-only, the tools read-only at `/opt/coding`, a private 1 GB `/tmp`, the
  tool's sign-in folder at `/profile/.coding` (its `HOME`) and, for a run, the project's folder at
  its place among the chat's files (such as `/files/chat/website`, or in a Public chat `/files/bot` or
  `/files/shared`); nothing else of the browser profile, the
  computer's `/io` or the bot's folders, and nothing of the server. The computer's own sandbox has
  no `/opt/coding`.
- **Its own gateway:** no network (`--network=none`); a gateway of its own (`sandboxGateway`, as a command's, D-126)
  on a socket in its folder made through the folder's open handle (`--host-uds=open`), behind the same forwarder at
  127.0.0.1:3128, so public
  addresses only: never Chrome's port 9222 (another sandbox's network), the server's loopback,
  private, link-local or own addresses, or mail ports. A coding run's gateway has none of the commands' limits on
  amounts and connections (D-127).
- **Exactly its folders:** both folders are given by their link-free real paths
  (`store.existingFolder`; the sign-in folder must be a real folder of the profile). Since a link
  swapped in as it starts would be mounted instead, the sandbox writes a random mark in each and
  waits for `/gateway/go`: the server opens each path without following links, checks it is still
  that folder, finds the mark through that handle and removes it (`marked`). Otherwise it is killed
  within 20 s ("folders") and the tool never starts.
- **Limits** (`CODING_LIMITS`): 3 GB for the whole sandbox, as gVisor counts it, read from
  outside every second; 512 processes, 4096 open files, 4 GB per file; no per-process memory limit (the tools'
  runtimes reserve far more address space than they use); the run's time, also kept inside by
  `timeout`, so a sandbox whose server is gone still ends. Its folder is named after the server's
  process, so a later server removes what a gone one left. Measured cost: D-77.
- **Sign-in:** an xterm on the screen running the sandbox on its terminal, with no project, for up
  to 30 minutes, one at a time (Codex with a device code), for the person to finish through a
  hand-over. It runs in its own sandbox rather than the computer's because a run can write into
  `.coding` (a tool's settings can name commands to run at its next start). Its `HOME` is
  `/profile/.coding`, inside the browser profile, so the sign-in is sealed and saved with the
  browser's (D-19), removed by Reset, and never in the bot's files or on its command line; a tool
  counts as signed in when its credentials file is there.
- **A run:** `start` runs the tool once per computer, in an existing folder of the bot's files, on
  the bot's brief behind fixed rules (change only this folder; never push, merge, publish, delete or
  sign in; end with a summary), with gVisor as its sandbox (no prompts), for up to two hours. Its
  output goes to the server (the last 20,000 characters) and to a log in the computer's `/io`
  (`coding-N-<random>.log`, at most 4 MB; the server makes it new, so a link the computer's sandbox
  left there is never followed) that an xterm on the screen follows (`FOLLOW_LOG`, reading it again every
  half second: gVisor tells a program inside of no change made outside), so the person can watch; the
  windows the server opens name the computer's display. A computer with a run going is busy and
  doesn't sleep. Putting one to sleep, or a server draining, first stops its run and sign-in and
  waits until the run's ending has been passed on (`stop(computer, "asleep")`); every ending
  (finished, failed, stopped, time, memory, sleep, a start that failed) removes the sandbox and its
  folder. When a run ends, `onCodingEnd` listeners hear it with the computer's seat in its chat (`{ computerId,
  place, run }`; the bots queue the report in that chat, `genesis/program/bots/bot-tools.md`).

Downloads land in the chat's files (`HOME` is `/files/chat`, the apps' own settings in `/files/chat/.apps`); Mercbot's
folders are not visible.
`scripts/measure-browser-speed.mjs` times the gVisor browser on a development machine, on a display
started with the computers' own Xvfb arguments (`xvfbArgs`). Up to `MERCBOT_MAX_COMPUTERS` (default 3) are awake at once;
idle ones sleep after 5 minutes unless someone is watching or a hand-over is
pending. While awake, a browser profile lives under `MERCBOT_DATA_DIR` (default
`.data`) on the server running the computer.

**The computer's files (D-50)** are kept with the bots' files, in
`<files>/computers/<chat_bots id>/` (`store.computerFolder`), outside every chat's and bot's folders, and
never in the database or only on a server's own disk: with the files bucket (D-91) the folder here is
a working copy, its own files pulled before they're read, a screenshot fetched alone
(`store.computerFile`), and what's written sent to the bucket at once (`store.settleComputer`).
While the files aren't available there are no screenshots and nothing is saved.
- **Screenshots:** `screenshots/<chat_bots id>-<16 hex>.jpg`, served only for that computer, to whoever can open its
  chat. With a copy
  built on Mercbot that checks pictures (D-90), only the ones a reply shows people are queued in `media_checks`, by
  that reply once its turn is over (bots' `botTools.js`), and checked within minutes; a blocked one is removed and
  then answers as missing. `storeScreenshot` queues none, so every other screenshot is kept unchecked.
- **Lifetime:** a computer's folder goes with its seat. Each server looks, at most hourly
  (`sweepFiles`), for folders whose seat is gone, whatever way it went.

Disposable machines (D-19): each bot's browser is kept off the machine, as sealed files in that
folder. `bot_browser_state` holds only which profile file is current, its sha256 and size, the
cookies file's sha256, when each was saved, and the address.
- **Saving:** when a computer sleeps or its server shuts down, Chrome is closed and
  the profile is archived (tar with zstd, caches and lock files left out), sealed
  with the vault key and written under a new name (`profile-<time>-<random>.sealed`); the row is
  updated, and only then is the previous file removed. While it's awake, its cookies are read
  from Chrome every 30 seconds and saved, sealed, to `cookies.sealed` (written whole, then renamed
  into place) when they've changed, with the current address.
- **Shutting down:** a server that's closing puts every computer away (`serveComputers`, in Fastify's
  `preClose`) before Fastify waits for its connections to end, because Puppeteer and Stagehand reach
  each browser through the server's own port (D-68): left until those had ended, it never came. A
  stopping server then starts no computer again (`computer_server_stopping`), and a screen server
  stopped by the put-away isn't restarted.
- **Waking:** on any server, waking unpacks the newest saved profile (a marker file
  says which one is already there), reapplies cookies saved after it and reopens the
  last page.
- **Checked:** a file whose sha256 isn't the recorded one, or that's missing, isn't restored.
- **Reset:** clears the saved state too (the row and its files; screenshots stay with the chat).
- **No key:** without `MERCBOT_VAULT_KEY`, nothing is saved and a warning is logged.

Several servers (D-15): each computer runs on one server, its owner, recorded in
`bot_computers` with its state, address and last error. Servers record
themselves in `mercbot_servers` when they start listening (`MERCBOT_SERVER_ID`,
default host name and port; `MERCBOT_SERVER_URL`, the address other servers
reach it on, default the machine's private IPv4 address when listening on every
interface, otherwise the bound address) and refresh it every 15 seconds; one
silent for 45 seconds counts as gone. A server shut down while it records itself
(closed soon after it listened) starts nothing afterwards and leaves no row. Any server answers the computer routes: it
reads state from the database, and passes wake, browse, act, fill, screenshot, hold,
sleep and a sign-in's start, page check and end (`startSignIn`, `signInPage`,
`endSignIn`; the last two run only where the computer is awake already, and never
wake or claim one) to the owner through `POST /api/internal/computer`, signed with a secret
kept in `mercbot_settings`. A computer wakes again on its last server while that
server is alive; otherwise the server that needs it claims it in one statement
and restores its saved browser. Tickets live in
`computer_tickets`; a server given another server's ticket relays the WebSocket
to that server, which uses the ticket up. State changes reach every server's
open streams as PostgreSQL notices (`@local/notices`). A server that can't be
reached at all counts as gone at once: its row is removed and the computer moves
to the server that needs it; a live server re-registers on its next heartbeat,
and only the server holding a computer may record its state, one write at a time per
computer in the order its states change (the manager doesn't wait for a write, and a
first write that loses the race to create the row would otherwise land last). Rows silent for a
day are removed when a server starts. An open live view wakes the computer again
if it goes to sleep.

Where computers run (D-85): a computer no live server holds goes where the
placement says: `PLACE_HERE`, the server that needs it, unless a feature
provides `mercbot.computer-placement` (`ComputerPlacement`, `types.js`). Its
`choose(computerId, servers)` names the server; `servers.here` is the server
asking, and `servers.live()` answers the live servers (`liveServers`: each seen
in the last 45 seconds, with how many computers it holds that aren't asleep).
The computer is taken for that server in the same one statement and its work is
passed there. Null means none can take it: "No computer can start right now.
Try again in a minute." (503 `computer_none_free`). A server that doesn't answer
counts as gone and the computer is placed again, once. The placement's `secret`
signs the servers' calls to each other; `PLACE_HERE`'s is null, for the one in
`mercbot_settings`. A relayed screen carries the same header.

When computers run out of room (D-88): a wake that finds every place on its
server taken puts the least recently used computer that isn't busy to sleep
(`made_room`), or after 90 seconds of every one staying busy is refused
("All N computers are in use right now. Try again in a moment.",
`computer_all_busy`); a computer no server can take is refused with
`computer_none_free`. Each goes to `mercbot.computer-events` (`ComputerEvents`,
`types.js`) when a feature provides it, with the server it happened on, and
otherwise to the server log (`LOG_COMPUTER_EVENTS`); nothing waits for it.
`servers()` answers every server seen in the last day with its address, when it
was last seen, whether it is alive and how many computers it holds awake.

Teaching: `startRecording` and `stopRecording` run on the owner. While
recording, every tab gets a page script that reports clicks, typed values (never
password or card fields) and Enter presses, Chrome reports page changes, and the
computer stays awake; recordings stop counting after 10 minutes and hold at most
400 events. The live view's teach banner offers Start recording; while
recording it shows a counting timer chip that stops it, a red outline, and an ×
that throws the recording away and removes the banner. The waking screen shows a
dot cluster and "Starting the desktop…". The page gives a ticket request 8 seconds
and a VNC handshake 15; after three failed tries it shows "Couldn't reach the
screen" with Try again. It counts as connected only once a first non-blank frame
is drawn, which is when Start recording becomes available; Escape closes the live
view while the screen isn't showing.

The person sees the whole desktop through noVNC. `POST
…/computer/ticket?chat=` (anyone who can open the chat, computer awake) returns a
one-time ticket valid for 30 seconds; the page opens
`/api/computer-vnc?ticket=…` as a WebSocket, which the server relays to that
bot's x11vnc socket. A page that gives up while its ticket is checked, or once it was refused, ends its own socket only, never the server, and leaves no socket to another server open behind it. Watching is view-only; Take over sends mouse and keys through
the same connection. `GET …/computer/stream` sends state and address as server-sent events, ending with its page. The bot's own browsing uses Stagehand
(DeepSeek through our client-model adapter) and the page; a screenshot-and-click
mode can be added beside it later.

**The page in front and sign-in chains (D-77, `signInChain.js`).** A popup a page opens ("Sign in
with Google") comes to the front until it closes, as it does for Stagehand's act: the bot's next
step, `fill`, what it reads and its screenshots use it; opening an address goes back to the bot's
own tab. `startSignIn` opens the first page of a sign-in the person asked for in the bot's tab and
starts its chain there, ending any other. Every tab is followed from when it opens on its own CDP
session, through Chrome's `Page.frameRequestedNavigation` (the page asked for this navigation: a
link, a form, its script), `Page.frameStartedNavigating` (its kind) and `Page.frameNavigated`: a tab
stays in the chain while it moves on by itself or stays on the same page (an anchor, a reload, a
frame inside it), and leaves it when an address is typed into it or it moves in its history. A
popup a tab of the open chain opens is in it, its opening navigation included. That costs three
commands once per tab and none per navigation. The chain ends with `endSignIn`, 10 minutes after it
started, or when the bot opens an address itself (`browse`, `fill` reopening its page); it lives in
the owner's memory with the browser, so a computer that sleeps or moves starts without one. The
page work itself (waiting for a page to settle, what covers it, a direct click, a login's fields and
typing into them) is in `webPage.js`. What `browse` reads of a page includes the HTTP status its
document answered with, from Navigation Timing (`responseStatus`) after any redirects: a missing
page's 404, a redirected address's page's own 200, the same when the open page is read again
without reloading, and null when the browser doesn't say. The stand-in computers' pages answer 200.
`signInPage` says whether the page in front is in the open chain and where it started. `fill` with
`inChain` types a code only while that holds, checked just before typing (otherwise
`{outsideChain: true}` and nothing typed), and with `onlyAt` only while the page in front is still
at that address. The manager's `startBrowser`, `libraries` and `clock` let
`tests/e2e/sign-in-chain.spec.ts` and `tests/e2e/page-status.spec.ts` run it on a plain Chromium with a stand-in
for Stagehand's AI.

## Proved by

- `tests/server/signInChain.test.js`
- `tests/e2e/sign-in-chain.spec.ts`
- `tests/e2e/page-status.spec.ts`
- `tests/server/computers.integration.js`
- `tests/server/cdpBridge.test.js`
- `tests/server/vncBridge.test.js`
- `tests/server/gateway.test.js`
- `tests/server/codingSandbox.test.js`
- `tests/server/codingHandoff.test.js`
- `tests/server/chatComputers.integration.js`
- `tests/client/chatComputers.vitest.js`
- `tests/client/liveControl.vitest.js`
- `tests/e2e/chat-computers.spec.ts`
- `tests/e2e/live-screen.spec.ts`
- `tests/server/computerManager.test.js`
- `tests/server/computerDays.test.js`
- `tests/server/xtermWindow.test.js`
- `tests/server/standInDesktops.test.js`
- `tests/server/resilience.integration.js`
