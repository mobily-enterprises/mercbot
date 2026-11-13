import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createRecorder } from "./recorder.js";
import { BROWSER_ICON, startDesktop } from "./desktop.js";
import { createSignInChain } from "./signInChain.js";
import { createStagehandModel } from "./stagehandModel.js";
import { clickDirectly, covering, fingerprint, isOnSite, loginFields, readPage, settled, siteName, typeValues } from "./webPage.js";


// Stagehand and Puppeteer, with the AI SDK Stagehand brings, are a large share of the code a server
// would load at start, and only a bot's computer uses them, so they load when the first one starts.
let browserLibraries = null;
function loadBrowserLibraries() {
  browserLibraries ??= Promise.all([import("@browserbasehq/stagehand"), import("puppeteer-core")]).then(
    ([stagehand, pptr]) => ({ Stagehand: stagehand.Stagehand, localBrowser: stagehand.localBrowser, puppeteer: pptr.default }),
    (error) => {
      browserLibraries = null;
      throw error;
    }
  );
  return browserLibraries;
}

// The flags Stagehand gives a Chrome it launches itself; Mercbot starts Chrome in gVisor and
// connects, so it passes them (from @browserbasehq/stagehand 4.3.0).
const CHROME_FLAGS = [
  "--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion," +
    "InterestFeedContentSuggestions,CertificateTransparencyComponentUpdater,AutofillServerCommunication," +
    "PrivacySandboxSettings4,RenderDocument",
  "--disable-component-extensions-with-background-pages", "--disable-background-networking", "--disable-component-update",
  "--disable-client-side-phishing-detection", "--disable-sync", "--metrics-recording-only", "--disable-default-apps", "--mute-audio",
  "--no-default-browser-check", "--no-first-run", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling", "--disable-ipc-flooding-protection", "--password-store=basic", "--use-mock-keychain",
  "--disable-hang-monitor", "--disable-prompt-on-repost", "--disable-domain-reliability", "--enable-unsafe-extension-debugging",
  "--remote-allow-origins=*", "--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport"
];
// Each bot's computer (docs/architecture.md §3.5, D-11 to D-13): a small desktop of its
// own Xvfb display, the desktop of desktop.js (D-23) and a headful Chrome that Stagehand launches,
// shown to the person
// over VNC (x11vnc on that display). Display numbers are picked free at start and kept in the
// computer's own state. Nothing listens on a TCP port (D-68): the display, the screen and the
// browser's remote control are Unix sockets, and Stagehand and Puppeteer reach the browser
// through this server's own port (cdpBridge.js). Sleeping, or Mercbot
// stopping, shuts all four down. This manager only knows the computers running on this server;
// computers.js shares their state, screens and screenshots with every server (D-15).
const WIDTH = 1280;
const HEIGHT = 800;
const FIRST_DISPLAY = 110;
const LAST_DISPLAY = 499;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A computer's display offers no shared memory (MIT-SHM, D-68). Shared memory ids belong to an IPC
// namespace: the apps in gVisor send ids from gVisor's own, which Xvfb looks up in Mercbot's, where
// the same id can name another program's segment (x11vnc's), so Chrome drew into memory Xvfb never
// read and its frames never finished. Every client sends its images over the display's socket.
const NO_SHARED_MEMORY = ["-extension", "MIT-SHM"];
/** Xvfb's arguments for a computer's display; scripts/measure-browser-speed.mjs starts its display with them too. */
export const xvfbArgs = (display) => [`:${display}`, "-screen", "0", `${WIDTH}x${HEIGHT}x24`, "-nolisten", "tcp", ...NO_SHARED_MEMORY];
// Stagehand's extension dials CDP from inside the browser's gVisor sandbox, which can't reach
// Mercbot's port and the bridge (D-68): it gets Chrome's own address there instead.
const insideBrowserUrl = (cdpUrl, debugPort) => `ws://127.0.0.1:${debugPort}${cdpUrl.slice(cdpUrl.indexOf("/devtools/"))}`;

function displayInUse(display) {
  return existsSync(`/tmp/.X11-unix/X${display}`) || existsSync(`/tmp/.X${display}-lock`);
}

/** Start a helper program; reject with its own words if it exits before `ready()` is true. */
function startProcess(name, command, args, { env, ready, timeoutMs = 8000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    let output = "";
    let settled = false;
    child.stderr.on("data", (chunk) => {
      output = (output + chunk).slice(-2000);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`${name} couldn't start: ${error.message}`));
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      reject(new Error(`${name} exited with code ${code}: ${output.trim().slice(-500)}`));
    });
    (async () => {
      const deadline = Date.now() + timeoutMs;
      while (!settled && Date.now() < deadline) {
        if (await ready()) {
          settled = true;
          resolve(child);
          return;
        }
        await sleep(100);
      }
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`${name} didn't get ready within ${timeoutMs / 1000}s: ${output.trim().slice(-500)}`));
      }
    })();
  });
}

function canConnect(socketPath) {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    socket.once("connect", () => {
      socket.destroy(); resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/**
 * `changed(computerId, change)` hears every state and address change; `store(computerId, jpeg)` keeps a
 * screenshot and returns its name.
 * A cookie as read from Chrome, in the form Chrome takes it back.
 */
function cookieParam(cookie) {
  const { size, session, expires, ...rest } = cookie;
  return session || !(expires > 0) ? rest : { ...rest, expires };
}

/**
 * The bot computers this server runs.
 * @param {object} dependencies
 * @param {(computerId: string, status: object) => Promise<void>} dependencies.changed Records a
 *   computer's new state.
 * @param {(computerId: string, jpeg: Buffer) => Promise<string>} dependencies.store Keeps a screenshot.
 * @param {ReturnType<typeof import("./browserState.js").createBrowserState>} dependencies.state Keeps
 *   the browser's sign-ins and site data off the machine (D-19).
 * @param {object} dependencies.apps The office apps on the desktop (D-23).
 * @param {(computerId: string, display: number) => Promise<object[]>} dependencies.apps.launchers The dock's apps.
 * @param {(computerId: string) => Promise<void>} dependencies.apps.closed The computer went to sleep.
 * @param {(computerId: string, display: number, virtualPath: string) => Promise<string[]>} dependencies.apps.command
 *   The command that opens one of the bot's files.
 * @param {ReturnType<typeof import("./codingRuns.js").createCodingRuns>} dependencies.coding Coding runs, one per computer.
 * @param {(computerId: string, options: object) => Promise<{ program: string, debugPort: number, cdpSocket: string } | null>}
 *   dependencies.browser The browser in the computer's gVisor sandbox (D-49): its program, its remote-control port where it
 *   runs and the Unix socket that leads there; when it says no, the computer doesn't start.
 * @param {ReturnType<typeof import("./cdpBridge.js").createCdpBridge>} dependencies.cdp How Stagehand and
 *   Puppeteer reach a browser's Unix socket (D-68).
 * @param {(computerId: string, start: () => Promise<unknown>) => Promise<unknown>} dependencies.withDay Starts the computer
 *   with its day opened, counted once it has started (D-73); when it throws, such as for a paused home, the
 *   computer stays asleep with its message.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {string} [dependencies.dataDir]
 * @param {number} [dependencies.maxAwake]
 * @param {number} [dependencies.idleMs]
 * @param {(computer: object) => Promise<{ cdpUrl: string, extensionCdpUrl: string, saved: { cookies: object[], url: string } }>}
 *   [dependencies.startBrowser] Starts the computer's desktop and Chrome, up to where Chrome answers (startDesktopBrowser).
 *   A test passes a plain Chromium of its own instead (D-54).
 * @param {typeof loadBrowserLibraries} [dependencies.libraries] Stagehand and Puppeteer; a test passes a stand-in for
 *   Stagehand, which needs AI.
 * @param {() => number} [dependencies.clock] The time sign-in chains count their 10 minutes by (D-77).
 */
export function createComputerManager({
  env,
  changed,
  store,
  state,
  apps,
  browser,
  cdp,
  coding,
  withDay,
  dataDir = path.resolve(process.cwd(), env.MERCBOT_DATA_DIR || ".data"),
  maxAwake = Number(env.MERCBOT_MAX_COMPUTERS) || 3,
  idleMs = 5 * 60 * 1000,
  startBrowser = null,
  libraries = loadBrowserLibraries,
  clock = Date.now
}) {
  const computers = new Map();
  let stopping = false;

  function entry(computerId) {
    const key = String(computerId);
    if (!computers.has(key)) {
      computers.set(key, { computerId: key, state: "asleep", url: "", viewers: 0, lastUsed: 0, held: false, error: "" });
    }
    return computers.get(key);
  }

  function setState(computer, state, extra = {}) {
    Object.assign(computer, { state, ...extra });
    changed(computer.computerId, { state, url: computer.url, error: computer.error });
  }

  function freeDisplay() {
    const used = new Set([...computers.values()].map((computer) => computer.display).filter(Boolean));
    const start = FIRST_DISPLAY + Math.floor(Math.random() * (LAST_DISPLAY - FIRST_DISPLAY));
    for (let offset = 0; offset <= LAST_DISPLAY - FIRST_DISPLAY; offset += 1) {
      const display = FIRST_DISPLAY + ((start - FIRST_DISPLAY + offset) % (LAST_DISPLAY - FIRST_DISPLAY + 1));
      if (!used.has(display) && !displayInUse(display)) return display;
    }
    throw new Error("No free display for another computer.");
  }

  /**
   * A computer in the middle of a bot's work (a step running, or one in the last minute) is busy
   * too, so another bot's wake never closes it mid-task.
   */
  function busy(computer) {
    return computer.held || computer.viewers > 0 || Boolean(computer.recorder?.active) || coding.running(computer) ||
      computer.working > 0 || Date.now() - computer.lastUsed < 60000;
  }

  async function evictIfFull(except) {
    // When every computer here is busy, wait up to 90 seconds for one to come free.
    for (const deadline = Date.now() + 90000; ;) {
      const awake = [...computers.values()].filter((computer) => computer.state !== "asleep" && computer !== except);
      if (awake.length < maxAwake) return;
      const candidates = awake.filter((computer) => !busy(computer)).sort((a, b) => a.lastUsed - b.lastUsed);
      if (candidates[0]) {
        await putToSleep(candidates[0].computerId);
        return;
      }
      if (Date.now() > deadline) throw new Error(`All ${maxAwake} computers are in use right now. Try again in a moment.`);
      await sleep(2000);
    }
  }

  async function launch(computer) {
    await evictIfFull(computer);
    const { cdpUrl, extensionCdpUrl, saved } = await (startBrowser || startDesktopBrowser)(computer);
    const { Stagehand, localBrowser, puppeteer } = await libraries();
    // Chrome answers before its connections are always ready; a failed first try is retried.
    for (let attempt = 1; ; attempt += 1) {
      try {
        computer.browser = await localBrowser.connect({ cdpUrl, extensionCdpUrl });
        break;
      } catch (error) {
        if (attempt >= 5) throw error;
        await sleep(1000);
      }
    }
    computer.stagehand = await Stagehand.create({
      browser: computer.browser,
      model: createStagehandModel(env),
      selfHeal: false,
      logging: { level: "off" }
    });
    computer.pptr = await puppeteer.connect({ browserWSEndpoint: cdpUrl, defaultViewport: null });
    /** One tab to start with: earlier sessions and launch leave extra blank or restored tabs. */
    const pages = (await computer.pptr.pages()).filter((page) => !page.url().startsWith("chrome-extension:"));
    computer.page = pages.shift() || (await computer.pptr.newPage());
    computer.front = computer.page;
    // Teaching: every tab, including ones the person opens, can be recorded.
    computer.recorder = createRecorder();
    await computer.recorder.attach(computer.page);
    // Every tab is followed for the sign-in chain (D-77) from when it opens.
    computer.chain = createSignInChain({ clock });
    await computer.chain.follow(computer.page);
    computer.pptr.on("targetcreated", (target) => {
      if (target.type() !== "page") return;
      target.page().then((page) => page && tabOpened(computer, page, target)).catch(() => {});
    });
    await Promise.all(pages.map((page) => page.close().catch(() => {})));
    await computer.page.bringToFront();
    computer.cdp = await computer.pptr.target().createCDPSession();
    // Cookies saved after the profile, and the page the bot was on, come back too.
    if (saved.cookies.length) await computer.cdp.send("Storage.setCookies", { cookies: saved.cookies.map(cookieParam) }).catch(() => {});
    if (/^https?:/u.test(saved.url)) await computer.page.goto(saved.url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    computer.url = computer.page.url();
    computer.page.on("framenavigated", (frame) => {
      if (frame === computer.page.mainFrame()) {
        computer.url = frame.url();
        changed(computer.computerId, { state: computer.state, url: computer.url, error: computer.error });
      }
    });
  }

  /**
   * A tab opened while the computer runs. A popup a page opened ("Sign in with Google") comes to the front, where the
   * bot's next step and fill work, as Stagehand's do, until it closes.
   */
  async function tabOpened(computer, page, target) {
    await computer.recorder?.attach(page);
    await computer.chain?.follow(page);
    if (!target.opener()) return;
    computer.front = page;
    page.once("close", () => {
      if (computer.front === page) computer.front = computer.page;
    });
  }

  /** The page in front: the bot's tab, or a popup open over it. */
  const frontPage = (computer) => (computer.front && !computer.front.isClosed() ? computer.front : computer.page);

  /** The bot's own tab, brought to the front for its next step. */
  async function toBotTab(computer) {
    await computer.page.bringToFront();
    computer.front = computer.page;
  }

  /**
   * The computer's desktop and Chrome in its gVisor sandbox (D-49), up to where Chrome answers on its remote control,
   * with the saved browser put back first (D-19).
   */
  async function startDesktopBrowser(computer) {
    const display = freeDisplay();
    computer.display = display;
    const displayEnv = { ...env, DISPLAY: `:${display}` };
    computer.xvfb = await startProcess("Xvfb", env.MERCBOT_XVFB || "Xvfb", xvfbArgs(display), {
      env: displayEnv,
      ready: async () => existsSync(`/tmp/.X11-unix/X${display}`)
    });
    const profile = path.join(dataDir, "computers", `bot-${computer.computerId}`);
    await mkdir(profile, { recursive: true });
    const { program: chrome, debugPort, cdpSocket } = (await browser(computer.computerId, { profile, display })) || {};
    if (!chrome) throw new Error("This server can't sandbox the bot's browser, so its computer can't start.");
    const launchers = [{
      id: "browser",
      label: "Browser",
      icon: BROWSER_ICON,
      argv: [chrome, `--user-data-dir=${profile}`, `--display=:${display}`, "--no-first-run", "--test-type", "--new-window"]
    }, ...await apps.launchers(computer.computerId, display).catch(() => [])];
    computer.desktop = await startDesktop({
      dir: path.join(dataDir, "computers", `desktop-${computer.computerId}`),
      display,
      env: displayEnv,
      launchers
    });
    await startScreen(computer, displayEnv);
    const saved = await state.restore(computer.computerId, profile);
    computer.profile = profile;
    // Chrome starts in the computer's gVisor sandbox (D-47); Stagehand connects to it there.
    computer.chromeProcess = spawn(chrome, [
      ...CHROME_FLAGS,
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
      `--display=:${display}`, `--window-size=${WIDTH},${HEIGHT}`, "--window-position=0,0",
      "--remote-debugging-address=127.0.0.1", "--test-type"
    ], { stdio: "ignore" });
    computer.chromeProcess.once("error", () => {});
    computer.cdpRoute = cdp.route(cdpSocket);
    let cdpUrl = "";
    for (const deadline = Date.now() + 60000; ;) {
      cdpUrl = await computer.cdpRoute.browserUrl().catch(() => "");
      if (cdpUrl) break;
      if (Date.now() > deadline || computer.chromeProcess.exitCode !== null) throw new Error("The bot's browser didn't start.");
      await sleep(300);
    }
    return { cdpUrl, extensionCdpUrl: insideBrowserUrl(cdpUrl, debugPort), saved };
  }

  async function wake(computerId) {
    // A stopping server has put its computers away (D-19): none starts here again, as nothing would put it away.
    if (stopping) {
      throw new AppError(503, "This server is stopping; the computer starts again on the next one.", {
        code: "computer_server_stopping"
      });
    }
    const computer = entry(computerId);
    computer.lastUsed = Date.now();
    if (computer.state === "awake") return computer;
    if (computer.starting) return computer.starting;
    setState(computer, "waking", { error: "" });
    computer.starting = withDay(computer.computerId, () => launch(computer))
      .then(() => {
        setState(computer, "awake");
        return computer;
      })
      .catch(async (error) => {
        await teardown(computer);
        setState(computer, "asleep", { error: error.message });
        throw error;
      })
      .finally(() => {
        computer.starting = null;
      });
    return computer.starting;
  }

  /**
   * Chrome goes through Stagehand; once it's closed, its profile is saved (D-19); then VNC, the
   * window manager and the display.
   */
  async function teardown(computer) {
    // A coding run stops first, its sandbox gone and its report passed on, so the tool's sign-in
    // (in the profile) is complete when it's saved; so does a tool's sign-in window.
    await coding.stop(computer, "asleep");
    // Chrome is closed first, so its profile is complete when it's saved.
    if (computer.chromeProcess) {
      await computer.pptr?.close().catch(() => {});
      if (computer.chromeProcess.exitCode === null) {
        await Promise.race([new Promise((resolve) => computer.chromeProcess.once("exit", resolve)), sleep(10000)]);
      }
    }
    try {
      computer.pptr?.disconnect();
    } catch { /* already gone */ }
    await computer.stagehand?.close().catch(() => {});
    await computer.browser?.close().catch(() => {});
    computer.cdpRoute?.close();
    if (computer.profile && computer.browser) {
      await state.save(computer.computerId, computer.profile, computer.url).catch((error) => {
        console.error(`Bot ${computer.computerId}'s browser state couldn't be saved: ${error.message}`);
      });
    }
    for (const child of [computer.vnc, ...(computer.desktop || []), ...(computer.opened || []), computer.xvfb]) {
      if (child && child.exitCode === null) child.kill("SIGTERM");
    }
    await apps.closed(computer.computerId);
    Object.assign(computer, {
      pptr: null,
      page: null,
      front: null,
      chain: null,
      cdp: null,
      stagehand: null,
      browser: null,
      chromeProcess: null,
      recorder: null,
      cookieHash: "",
      vnc: null,
      desktop: null,
      opened: null,
      xvfb: null,
      display: null,
      vncSocket: null,
      cdpRoute: null,
      screenStops: []
    });
  }

  /**
   * The screen-sharing server (x11vnc). If it stops while the computer is awake, why is logged
   * and it starts again: the browser and the bot's work carry on, and open live views reconnect
   * with a new ticket. Only when it stops more than 3 times in a minute does the computer sleep.
   */
  async function startScreen(computer, displayEnv) {
    computer.vncSocket = path.join(os.tmpdir(), `mbvnc-${process.pid}-${computer.display}.sock`);
    await rm(computer.vncSocket, { force: true });
    const vnc = await startProcess("x11vnc", env.MERCBOT_X11VNC || "x11vnc", [
      "-display", `:${computer.display}`, "-unixsock", computer.vncSocket, "-rfbport", "0", "-localhost",
      "-forever", "-shared", "-nopw", "-quiet", "-noxdamage", "-noipv6", "-rfbportv6", "-1", "-noshm"
    ], { env: displayEnv, ready: () => canConnect(computer.vncSocket) });
    computer.vnc = vnc;
    let errors = "";
    vnc.stderr.on("data", (chunk) => {
      errors = (errors + chunk).slice(-2000);
    });
    vnc.once("exit", async (code, signal) => {
      // Putting the computer away stopped it: a stopping server's computers stay "awake" while they're put away.
      if (stopping || computer.vnc !== vnc || computer.state !== "awake") return;
      console.error(
        `Computer ${computer.computerId}: the screen-sharing server stopped (${signal || `code ${code}`}): ` +
        `${errors.trim().slice(-500) || "no message"}`
      );
      const now = Date.now();
      computer.screenStops = (computer.screenStops || []).filter((at) => now - at < 60000).concat(now);
      if (computer.screenStops.length <= 3) {
        try {
          await startScreen(computer, displayEnv);
          if (computer.state !== "awake") computer.vnc?.kill("SIGKILL");
          return;
        } catch (error) {
          console.error(`Computer ${computer.computerId}: the screen-sharing server didn't start again: ${error.message}`);
        }
      }
      if (computer.state === "awake") putToSleep(computer.computerId, "The screen connection stopped.");
    });
  }

  async function putToSleep(computerId, error = "") {
    const computer = entry(computerId);
    if (computer.state === "asleep") return;
    await teardown(computer);
    setState(computer, "asleep", { url: "", error });
  }

  // Every 30 seconds an awake computer's cookies are saved if they changed, so a machine that
  // dies without warning loses at most that much of its sign-ins (D-19).
  const cookieTimer = setInterval(async () => {
    for (const computer of computers.values()) {
      if (computer.state !== "awake" || !computer.cdp) continue;
      try {
        const { cookies } = await computer.cdp.send("Storage.getCookies");
        const hash = JSON.stringify(cookies);
        if (hash === computer.cookieHash) continue;
        await state.snapshotCookies(computer.computerId, cookies, computer.url);
        computer.cookieHash = hash;
      } catch {
        // The browser is busy or closing; the next round tries again.
      }
    }
  }, 30000);
  cookieTimer.unref();

  const idleTimer = setInterval(() => {
    for (const computer of computers.values()) {
      const idle = Date.now() - computer.lastUsed > idleMs;
      if (computer.state === "awake" && idle && !busy(computer)) putToSleep(computer.computerId);
    }
  }, 30000);
  idleTimer.unref();

  /** If Mercbot exits without a clean shutdown, still don't leave helpers running. */
  const killAll = () => {
    for (const computer of computers.values()) {
      for (const child of [computer.vnc, ...(computer.desktop || []), ...(computer.opened || []), computer.xvfb]) {
        if (child && child.exitCode === null) child.kill("SIGTERM");
      }
    }
  };
  process.once("exit", killAll);

  /** The screen of an awake computer, for the VNC bridge; viewers keep it awake (D-13). */
  function screen(computerId) {
    const computer = entry(computerId);
    if (computer.state !== "awake" || !computer.vncSocket) return null;
    computer.lastUsed = Date.now();
    return {
      socketPath: computer.vncSocket,
      opened: () => {
        computer.viewers += 1;
      },
      closed: () => {
        computer.viewers = Math.max(0, computer.viewers - 1); computer.lastUsed = Date.now();
      }
    };
  }

  async function saveScreenshot(computer, page = frontPage(computer)) {
    return store(computer.computerId, await page.screenshot({ type: "jpeg", quality: 70 }));
  }

  /** One web action at a time per computer, so parallel tool calls don't fight over the page. */
  function queued(computerId, work) {
    const computer = entry(computerId);
    computer.working = (computer.working || 0) + 1;
    const counted = () => Promise.resolve().then(work).finally(() => {
      computer.working -= 1;
    });
    const run = (computer.queue || Promise.resolve()).then(counted, counted);
    computer.queue = run.catch(() => {});
    return run;
  }

  /**
   * The bot's own browsing goes through Stagehand and the page. A later
   * screenshot-and-click mode would add another set of actions here, over the same display.
   */
  const browse = (computerId, url) => queued(computerId, () => openPage(computerId, url));
  const startSignIn = (computerId, url) => queued(computerId, () => openPage(computerId, url, { signIn: true }));
  const act = (computerId, instruction) => queued(computerId, () => actOnPage(computerId, instruction));
  const fill = (computerId, values) => queued(computerId, () => fillOnPage(computerId, values));

  /** What the bot reads of a page, with a screenshot. */
  const readWithScreenshot = async (computer, page) => ({ ...(await readPage(page)), screenshot: await saveScreenshot(computer, page) });

  /**
   * An address opened in the bot's tab, which ends a sign-in's chain (D-77). With `signIn`, it's the first page of a
   * sign-in the person asked for: its chain starts there, on the page the address led to.
   */
  async function openPage(computerId, url, { signIn = false } = {}) {
    const computer = await wake(computerId);
    computer.lastUsed = Date.now();
    const target = /^https?:\/\//iu.test(url) ? url : `https://${url}`;
    // Re-reading the page that's already open mustn't reload it (it may hold the person's work).
    const front = frontPage(computer);
    if (!signIn && front.url() === target) {
      await settled(front);
      return readWithScreenshot(computer, front);
    }
    if (signIn || computer.page.url() !== target) {
      computer.chain.end();
      await computer.page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    await toBotTab(computer);
    if (signIn) computer.chain.start(computer.page, target);
    await settled(computer.page);
    return readWithScreenshot(computer, computer.page);
  }

  async function actOnPage(computerId, instruction) {
    const computer = await wake(computerId);
    computer.lastUsed = Date.now();
    const page = frontPage(computer);
    await settled(page);
    const before = await fingerprint(page);
    // Stagehand's own limit ends a stuck step, so the steps queued behind it aren't stuck too.
    let result = await computer.stagehand.act(instruction, { timeout: 90000 });
    await settled(page);
    // A popup the step opened is in front now, and what it says is the popup's.
    const after = frontPage(computer);
    if (after !== page) await settled(after);
    // Some pages sometimes ignore the mouse click Stagehand sends while the element itself works
    // (a shop's "Add to cart"). A click that changed nothing is tried once more as a
    // click on the element Stagehand picks, so the bot isn't told it worked when it didn't.
    if (/^\s*(click|press|tap|select|choose|tick|check)\b/iu.test(instruction) && after === page && before && before === await fingerprint(page)) {
      const clicked = await clickDirectly(computer.stagehand, page, instruction).catch(() => false);
      if (clicked) {
        await settled(page);
        const changed = before !== await fingerprint(page);
        result = { success: changed, message: changed ? "Clicked." : "The click didn't change the page." };
      } else {
        result = { success: false, message: "The click didn't change the page." };
      }
    }
    const shown = frontPage(computer);
    return {
      success: Boolean(result?.data?.success ?? result?.success),
      message: String(result?.data?.message ?? result?.message ?? ""),
      url: shown.url(),
      title: await shown.title(),
      covering: await covering(shown),
      screenshot: await saveScreenshot(computer, shown)
    };
  }

  /**
   * A login or code typed straight into the page in front: from the vault
   * or the person's secure form, never through the bot. The page must be on the expected site.
   * Returns which fields were filled; the values themselves never come back. A code from the person's
   * inbox (D-77) goes only into a page of the open sign-in chain (`inChain`), or the one page they said
   * yes to (`onlyAt`): otherwise nothing is typed, and `outsideChain` says why.
   */
  async function fillOnPage(computerId, { site = "", url = "", username = "", password = "", code = "", inChain = false, onlyAt = "" } = {}) {
    const computer = await wake(computerId);
    computer.lastUsed = Date.now();
    let page = frontPage(computer);
    const wanted = siteName(site);
    const onSite = () => isOnSite(page, wanted);
    // The computer may have moved on or restarted since the form was asked for: the sign-in page
    // it was asked on is opened again, as long as it's on the same site.
    // It opens in the bot's tab, as an address the bot opens itself, so a sign-in's chain ends (D-77).
    if (!onSite() && /^https?:/u.test(url)) {
      computer.chain.end();
      page = computer.page;
      await toBotTab(computer);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await settled(page);
    }
    if (!onSite()) throw new Error(`The page open on the computer isn't on ${wanted}.`);
    if (onlyAt && page.url() !== onlyAt) throw new Error("The page has moved on since, so nothing was typed.");
    const fields = await loginFields(page);
    // Checked last, just before typing: the page may have moved on while the code was found.
    if (inChain && !computer.chain.holds(page)) {
      await fields.dispose();
      return { filled: [], outsideChain: true, url: page.url() };
    }
    const filled = await typeValues(fields, [["username", username], ["password", password], ["code", password ? "" : code]]);
    await fields.dispose();
    await sleep(300);
    return { filled, url: page.url(), screenshot: await saveScreenshot(computer, page) };
  }

  /**
   * The page in front and whether it's in the open sign-in chain (D-77), with where that started; nothing for a
   * computer that isn't awake. Read as it is, without waiting for a step under way.
   */
  async function signInPage(computerId) {
    const computer = entry(computerId);
    if (computer.state !== "awake" || !computer.page) return { url: "", inChain: false, startedFrom: "" };
    const page = frontPage(computer);
    const inChain = computer.chain.holds(page);
    return { url: page.url(), inChain, startedFrom: inChain ? computer.chain.startedFrom() : "" };
  }

  /** The sign-in is over (D-77): its chain ends. */
  async function endSignIn(computerId) {
    entry(computerId).chain?.end();
  }

  async function screenshot(computerId) {
    const computer = await wake(computerId);
    return saveScreenshot(computer);
  }

  /** Teaching: recording keeps the computer awake; stopping returns what was seen. */
  async function startRecording(computerId) {
    const computer = await wake(computerId);
    computer.recorder.start(computer.page.url());
    computer.lastUsed = Date.now();
  }

  function stopRecording(computerId) {
    const computer = entry(computerId);
    computer.lastUsed = Date.now();
    return computer.recorder?.stop() || null;
  }

  function hold(computerId, held) {
    const computer = entry(computerId);
    computer.held = Boolean(held);
    computer.lastUsed = Date.now();
  }

  /** One of the bot's files in its app, on the desktop, for the person to work on (D-23). */
  async function open(computerId, virtualPath) {
    const computer = await wake(computerId);
    computer.lastUsed = Date.now();
    const [command, ...args] = await apps.command(computerId, computer.display, virtualPath);
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", () => {});
    computer.opened = [...(computer.opened || []).filter((running) => running.exitCode === null), child];
    return status(computerId);
  }

  function status(computerId) {
    const computer = entry(computerId);
    return { state: computer.state, url: computer.url, error: computer.error };
  }


  async function shutdown() {
    stopping = true;
    clearInterval(idleTimer);
    clearInterval(cookieTimer);
    process.removeListener("exit", killAll);
    await Promise.all([...computers.values()].map((computer) => teardown(computer)));
  }

  /**
   * Settings → Reset: the computer goes to sleep and its browser profile, with any
   * saved sign-ins, is deleted, so it starts fresh next time.
   */
  async function reset(computerId) {
    await putToSleep(computerId);
    await rm(path.join(dataDir, "computers", `bot-${computerId}`), { recursive: true, force: true });
    await state.forget(computerId);
  }

  return Object.freeze({
    wake,
    sleep: putToSleep,
    reset,
    screen,
    browse,
    startSignIn,
    act,
    fill,
    signInPage,
    endSignIn,
    screenshot,
    startRecording,
    stopRecording,
    hold,
    open,
    status,
    shutdown
  });
}
