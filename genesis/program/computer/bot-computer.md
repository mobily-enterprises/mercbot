# Bot computer

Gives each bot its own small desktop with a web browser that the person can
watch and take over (docs/architecture.md §3.5, decisions D-11 to D-14).

## Sources

- `migrations/20261113120000_baseline.cjs`
- Main: `packages/computer/src/server/ComputerFeature.js`
- `packages/computer/src/server/registerRoutes.js`
- `packages/computer/src/server/shellQuote.js`
- `packages/computer/src/server/types.js`
- `src/components/mercbot/useLiveView.js`
- `packages/computer/src/server/computerManager.js`
- `packages/computer/src/server/signInChain.js`
- `packages/computer/src/server/webPage.js`
- `tests/server/signInChain.test.js`
- `tests/e2e/sign-in-chain.spec.ts`
- `packages/computer/src/server/computers.js`
- `packages/computer/src/server/recorder.js`
- `packages/computer/src/server/browserState.js`
- `tests/server/resilience.integration.js`
- `tests/server/computers.integration.js`
- `packages/computer/src/server/desktopSandbox.js`
- `packages/computer/src/server/cdpBridge.js`
- `tests/server/cdpBridge.test.js`
- `packages/computer/src/server/gateway.js`
- `tests/server/gateway.test.js`
- `packages/computer/assets/terminal.svg`
- `scripts/measure-browser-speed.mjs`
- `packages/computer/src/server/stagehandModel.js`
- `packages/computer/src/server/desktop.js`
- `packages/computer/assets/wallpaper.png`
- `packages/computer/assets/browser.svg`
- `packages/computer/src/server/vncBridge.js`
- `src/components/mercbot/MercbotVncScreen.vue`
- `packages/computer/package.json`
- `src/components/mercbot/computerApi.js`
- `src/components/mercbot/MercbotLiveView.vue`
- `src/components/mercbot/MercbotHandoverCard.vue`
- `src/components/mercbot/MercbotLightbox.vue`
- `packages/computer/src/server/codingRuns.js`
- `packages/computer/src/server/codingSandbox.js`
- `tests/server/codingSandbox.test.js`
- `scripts/measure-coding-sandbox.mjs`
- `scripts/coding-tools/package.json`
- `scripts/coding-tools/package-lock.json`
- `tests/server/codingHandoff.test.js`

## Public contract

**One computer per conversation** (D-36). A bot's computer belongs to a conversation:
- each person's own with a private or mixed bot, so their browser sign-ins never reach anyone else;
- one per shared conversation, which everyone in it uses.

**Keying.** The computer service is keyed by `computerId`, the conversation's id.
`bot_computers`, `computer_tickets` and `bot_browser_state` hold
`conversation_id`. What a bot had before went with its maker's conversation.

**Routes.** `…/bots/:botId/computer…` and `…/screenshots/:name` use the person's own conversation
with that bot. For a shared bot they use the conversation asked for (`room`), else the open tab,
else the first. Settings → Reset restarts the person's own computers in the home; shared
conversations' computers stay.

Everything a computer runs is in gVisor (D-49), and nothing listens on a TCP port but the server's
own (D-68), which is all a published server may bind. Waking a bot's computer starts, on a free
display number picked at that moment: `Xvfb :N` (1280×800, no TCP, no shared memory), the desktop,
`x11vnc` on that display listening only on a Unix socket of the server's own temporary folder
(`-unixsock`, `-rfbport 0`, no IPv6, `-noshm`), and the computer's **desktop
sandbox** (`desktopSandbox.js`). That sandbox is one gVisor sandbox (`runsc --rootless
--network=none`, on KVM only with `MERCBOT_GVISOR_PLATFORM=kvm`) holding Chrome and the Craft
apps:
- **What it sees:** the toolbox (Chrome for Testing in `/opt/chrome`), the display's socket,
  the profile at `/profile`, Stagehand's extension, and the conversation's folders (`noexec`).
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
- **Internet:** the only way out is the gateway (`gateway.js`), an HTTP proxy on the sandbox's
  `/io/gateway.sock`, reached through a forwarder inside it. It resolves names itself, and refuses
  loopback, private, link-local (cloud metadata), CGNAT, reserved and multicast addresses, the
  server's own addresses and mail ports. It keeps a short list of where it connected.
- **Without gVisor:** without gVisor or a toolbox with Chrome, computers don't start.
- **Cleanup:** sandboxes of a server that's gone are removed when the next one starts; their
  folders are named after their server's process.

Sleeping, or Mercbot stopping, shuts everything down, with any apps the person opened. If x11vnc
stops while the computer is awake, why is logged and it starts again on a new socket (open live
views reconnect with a new ticket); only after more than 3 stops in a minute does the computer
sleep with "The screen connection stopped."

The desktop (D-23, `desktop.js`) is written fresh into
`<data>/computers/desktop-<bot>` on every wake: openbox with our theme (red,
yellow and green buttons on the left, apps opening maximised), the wallpaper set
by `hsetroot`, and two `tint2` bars: a translucent top bar ("Mercbot", the open
windows, a clock) and a centred dock with Browser (a new window of the bot's
Chrome) and the office apps, and a Terminal. Right-clicking the desktop shows the same apps. The
office apps run in the desktop sandbox. The Terminal is an xterm attached to the
conversation's command-line session (`files/shell.md`): the bot's commands live above, the
person's own shell below. Without `tint2` or `hsetroot` the desktop has no bars or wallpaper.
`POST /api/bots/:botId/computer/open` (`{path}`, a bot path) wakes the computer
where it runs (the `open` operation is forwarded like the others) and opens that
file in its app; the viewer's "Edit on computer" calls it, then opens the live
view in control.

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
  its place among the bot's files (`/files/mine/site`); nothing else of the browser profile, the
  computer's `/io` or the bot's folders, and nothing of the server. The computer's own sandbox has
  no `/opt/coding`.
- **Its own gateway:** no network (`--network=none`); a gateway of its own (`gateway.js`) on a
  socket in its folder (`--host-uds=open`), behind the same forwarder at 127.0.0.1:3128, so public
  addresses only: never Chrome's port 9222 (another sandbox's network), the server's loopback,
  private, link-local or own addresses, or mail ports.
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
  folder. When a run ends, `onCodingEnd` listeners hear it with the computer's conversation (the
  bots queue the report, `bots/conversations.md`).

Downloads land in the bot's files (`HOME` is `/files/mine`); Mercbot's folders are not visible.
`scripts/measure-browser-speed.mjs` times the gVisor browser on a development machine, on a display
started with the computers' own Xvfb arguments (`xvfbArgs`). Up to `MERCBOT_MAX_COMPUTERS` (default 3) are awake at once;
idle ones sleep after 5 minutes unless someone is watching or a hand-over is
pending. While awake, a browser profile lives under `MERCBOT_DATA_DIR` (default
`.data`) on the server running the computer.

**The computer's files (D-50)** are on the shared files volume, in
`<files>/computers/<conversation>/` (`store.computerFolder`), outside every person's folders, and
never in the database or on a server's own disk: without the volume there are no screenshots and
nothing is saved.
- **Screenshots:** `screenshots/<conversation>-<16 hex>.jpg`, served only for that conversation.
- **Lifetime:** a conversation's folder goes with it. Each server looks, at most hourly
  (`sweepFiles`), for folders whose conversation is gone, whatever way it went.

Disposable machines (D-19): each bot's browser is kept off the machine, as sealed files in that
folder. `bot_browser_state` holds only which profile file is current, its sha256 and size, the
cookies file's sha256, when each was saved, and the address.
- **Saving:** when a computer sleeps or its server shuts down, Chrome is closed and
  the profile is archived (tar with zstd, caches and lock files left out), sealed
  with the vault key and written under a new name (`profile-<time>-<random>.sealed`); the row is
  updated, and only then is the previous file removed. While it's awake, its cookies are read
  from Chrome every 30 seconds and saved, sealed, to `cookies.sealed` (written whole, then renamed
  into place) when they've changed, with the current address.
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
silent for 45 seconds counts as gone. Any server answers the computer routes: it
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
and only the server holding a computer may record its state. Rows silent for a
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
/api/bots/:botId/computer/ticket` (bot owner only, computer awake) returns a
one-time ticket valid for 30 seconds; the page opens
`/api/computer-vnc?ticket=…` as a WebSocket, which the server relays to that
bot's x11vnc socket. Watching is view-only; Take control sends mouse and keys through
the same connection. Other routes: `GET /api/bots/:botId/computer`, `POST
.../computer/wake`, `GET .../computer/stream` (server-sent state and address, ending with its page) and
`GET /api/bots/:botId/screenshots/:name`. The bot's own browsing uses Stagehand
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
typing into them) is in `webPage.js`.
`signInPage` says whether the page in front is in the open chain and where it started. `fill` with
`inChain` types a code only while that holds, checked just before typing (otherwise
`{outsideChain: true}` and nothing typed), and with `onlyAt` only while the page in front is still
at that address. The manager's `startBrowser`, `libraries` and `clock` let
`tests/e2e/sign-in-chain.spec.ts` run it on a plain Chromium with a stand-in for Stagehand's AI.
