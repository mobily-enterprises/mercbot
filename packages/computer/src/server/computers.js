import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createBrowserState } from "./browserState.js";
import { createCdpBridge } from "./cdpBridge.js";
import { createCodingRuns } from "./codingRuns.js";
import { startCodingSandbox } from "./codingSandbox.js";
import { createComputerManager } from "./computerManager.js";
import { createComputerRecords } from "./computerRecords.js";
import { createComputerDays } from "./computerDays.js";
import { APPS, appFor, appIcon } from "@local/files/office-apps";
import { desktopSandboxAvailable, startDesktopSandbox } from "./desktopSandbox.js";
import { TERMINAL_ICON, program } from "./desktop.js";

const NO_SAVED_BROWSERS = "MERCBOT_VAULT_KEY isn't set, or there's no files volume: bots' browser sign-ins won't survive this machine.";
const HEARTBEAT_MS = 15000;
const SWEEP_MS = 60 * 60 * 1000;
// Each minute, an awake computer is counted a new day that has begun (D-73).
const NEW_DAY_MS = 60 * 1000;
const FORWARD_MS = 180000;
const OPERATIONS = new Set([
  "wake", "sleep", "reset", "browse", "act", "screenshot", "startRecording", "stopRecording", "hold", "open", "fill", "code",
  "startSignIn", "signInPage", "endSignIn"
]);
const ASLEEP = Object.freeze({ state: "asleep", url: "", error: "" });
// What a computer that isn't awake anywhere has in front: no page, so no sign-in chain (D-77).
const NO_PAGE = Object.freeze({ url: "", inChain: false, startedFrom: "" });

function privateAddress() {
  const candidates = Object.values(os.networkInterfaces()).flat().filter((entry) => entry && entry.family === "IPv4" && !entry.internal);
  return candidates[0]?.address || "127.0.0.1";
}

/**
 * Whose files the computer works on: the home's shared folder and the person's own with the bot
 * (a shared bot's are everyone's). `found` is the computer's conversation (records.directory.computerOf).
 */
function filePlace(files, found) {
  return found ? files.store.placeFor({ id: found.botId, workspace_id: found.workspaceId, sharing: found.botSharing }, found.userId) : null;
}

/**
 * An xterm window on the desktop titled `title`, showing `argv`; null without xterm. One this server
 * opens itself names the computer's `display`; the dock's are started on it already.
 */
function xtermCommand(env, title, argv, display = null) {
  const xterm = program(env, "xterm");
  if (!xterm || !argv) return null;
  const libraries = path.join(path.resolve(env.MERCBOT_TOOLS_DIR || ".tools"), "desktop", "usr", "lib", "x86_64-linux-gnu");
  return ["env", `LD_LIBRARY_PATH=${libraries}`, "LANG=C.UTF-8", "LC_ALL=C.UTF-8",
    xterm, ...(display === null ? [] : ["-display", `:${display}`]), "-u8", "-T", title, "-fa", "DejaVu Sans Mono", "-fs", "11", "-geometry", "118x34",
    "-bg", "#16181D", "-fg", "#E8EAED", "-xrm", "XTerm*selectToClipboard: true", "-e", ...argv];
}

/**
 * The Terminal (D-47): xterm draws it on the desktop; what runs in it is the computer's
 * command-line session in gVisor, where the bot's commands show too. Only text passes between.
 */
function terminalLauncher(env, attach) {
  const argv = xtermCommand(env, "Terminal", attach);
  return argv ? { id: "terminal", label: "Terminal", icon: TERMINAL_ICON, argv } : null;
}

/** The coding tools (scripts/install-tools.sh), shown to each coding sandbox as /opt/coding (codingSandbox.js). */
const codingInstalled = (env) => existsSync(path.join(path.resolve(env.MERCBOT_TOOLS_DIR || ".tools"), "coding", "node_modules", ".bin"));

/** A Craft app on the desktop, run in the computer's desktop sandbox. */
function craftCommand(box, app, file = "") {
  const bin = APPS[app].bin;
  return box.exec(["/usr/bin/env", "HOME=/files/mine/.apps", `/opt/apps/${bin}/bin/${bin}`, ...(file ? [file] : [])]);
}

/**
 * The office apps on bots' desktops (D-23) and the Terminal on the computer's command line (D-47),
 * each run in its computer's desktop sandbox (`boxes`).
 */
function desktopApps(conversationOf, env, files, boxes) {
  /** A coding run's project: `folder` of the computer's bot's files, by its link-free path here. */
  async function projectFolder(computerId, folder) {
    const place = filePlace(files, await conversationOf(computerId));
    const found = place ? await files.store.prepare(place).then(() => files.store.existingFolder(place, folder)).catch(() => null) : null;
    if (!found) throw new Error(`There's no folder ${folder} in the bot's files.`);
    return { source: found.real, destination: found.virtualPath };
  }

  return {
    async launchers(computerId) {
      const found = await conversationOf(computerId);
      const place = filePlace(files, found);
      const box = boxes.get(String(computerId));
      const office = box && existsSync(path.join(path.resolve(env.MERCBOT_TOOLS_DIR || ".tools"), "apps"))
        ? Object.entries(APPS).map(([app, { label }]) => ({ id: app, label, icon: appIcon(env, app), argv: craftCommand(box, app) }))
        : [];
      let terminal = null;
      if (place && files.shell.available()) {
        await files.shell.attach({ key: computerId, place, label: `${found?.botName || "The bot"}'s commands` }).catch((error) => console.warn("Attaching the bot's command line to its computer failed; the computer works without it.", error));
        terminal = terminalLauncher(env, files.shell.terminalCommand(computerId));
      }
      return [...office, ...(terminal ? [terminal] : [])];
    },
    // The computer went to sleep: its command-line session ends with it.
    async closed(computerId) {
      await files.shell.detach(computerId).catch((error) => console.warn("Ending a sleeping computer's command-line session failed.", error));
      const box = boxes.get(String(computerId));
      boxes.delete(String(computerId));
      await box?.stop().catch(() => {});
    },
    async command(computerId, display, virtualPath) {
      const app = appFor(virtualPath);
      const box = boxes.get(String(computerId));
      if (!app || !box) throw new Error("There's no app for that file here.");
      return craftCommand(box, app, virtualPath);
    },
    /**
     * A coding tool in a gVisor sandbox of its own (D-77): a run on `folder`,
     * an existing folder of the bot's files (/files/mine, /files/bot or /files/shared, or one in
     * them) given by its link-free path, or with `title` its sign-in, in a window on the screen.
     * Either way it has the tool's sign-in, /profile/.coding in the computer's browser profile,
     * and nothing else of the computer.
     */
    async coding(computer, { folder, title, argv, env: toolEnv, maxSeconds, onOutput }) {
      const box = boxes.get(String(computer.computerId));
      if (!box || !computer.profile) throw new Error("The computer isn't awake.");
      const home = await signInFolder(computer.profile);
      const project = folder === undefined ? null : await projectFolder(computer.computerId, folder);
      return startCodingSandbox({
        runtimeEnv: env,
        home,
        project,
        argv,
        env: toolEnv,
        maxSeconds,
        onOutput,
        ...(title ? { terminal: (command) => xtermCommand(env, title, command, box.display) } : {})
      });
    },
    /** A window on the computer's screen showing a program run in its sandbox. */
    window(computerId, title, argv) {
      const box = boxes.get(String(computerId));
      return box ? xtermCommand(env, title, box.exec(argv), box.display) : null;
    },
    /** A file of this server's the computer's sandbox sees (desktopSandbox.js `shared`). */
    shared(computerId, name) {
      return boxes.get(String(computerId))?.shared(name) ?? null;
    }
  };
}

/**
 * The coding tools' sign-in folder in a computer's browser profile, made if it's missing, by its
 * link-free path: a link there (which the computer's own sandbox could make) is refused.
 */
async function signInFolder(profile) {
  const dir = path.join(await fs.realpath(profile), ".coding");
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  if (!(await fs.lstat(dir).catch(() => null))?.isDirectory()) {
    throw new Error("The coding tools' sign-in folder on this computer isn't a folder. Reset the computer in Settings to start it afresh.");
  }
  return dir;
}

/**
 * Bot computers on several servers (D-15). Each computer runs on one server, its owner,
 * recorded in bot_computers; every other server passes work for it to the owner over HTTP,
 * signed with a secret kept in the database. A bot's computer wakes again on its last server
 * while that server is alive, so its browser profile (sign-ins) is still there. State, screen
 * tickets and screenshots live in PostgreSQL, and state changes reach every server as notices.
 * A server that can't be reached counts as gone straight away, so its computers move to the
 * server that needs them; if it was only a blip, its next heartbeat registers it again.
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.resources the computer feature's handles
 * @param {(reason: string) => object} dependencies.systemContext the computer feature's system scope
 * @param {{ computerOf: Function, liveConversationIds: Function }} dependencies.directory records.directory
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env Read when needed, so a change to it shows (tests change
 *   MERCBOT_SERVER_ID).
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {import("@local/files/server/types").Files} dependencies.files
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {typeof createComputerManager} [dependencies.createManager] The computers this server runs
 *   (tests use stand-ins).
 */
export function createComputers({
  resources,
  systemContext,
  directory,
  env,
  notices,
  files,
  meter,
  createManager = createComputerManager
}) {
  // Computers run on no request and pass between servers, so their reads and writes are this
  // feature's system context's, by the conversation's id.
  const system = () => ({ context: systemContext("run bot computers across servers: which server holds each, its state, saved browser and screen tickets") });
  /**
   * A bot's computer belongs to a conversation (D-36): each person's own with a private or mixed
   * bot, so their sign-ins never reach anyone else, or a shared bot's conversation, seen by everyone.
   * Its key, computerId, is that conversation's id.
   */
  const conversationOf = (computerId, options = system()) => directory.computerOf(String(computerId), options);
  const records = createComputerRecords({
    resources,
    system,
    homeOf: async (computerId, options) => (await conversationOf(computerId, options))?.workspaceId ?? null
  });
  /** A computer's screenshots and saved browser are files on the shared volume (D-50). */
  const folderOf = (computerId) => files.store.computerFolder(computerId);
  const state = createBrowserState({ records, env, folderOf });
  // Each awake computer's apps run in gVisor (D-47, branch computer-gvisor): Chrome and the Craft
  // apps in one desktop sandbox per computer, on the internet only through its gateway.
  const boxes = new Map();
  if (!state.available) console.warn(NO_SAVED_BROWSERS);
  // Stagehand and Puppeteer reach each browser's Unix socket through this server's own port (D-68).
  const cdp = createCdpBridge();
  const desktop = desktopApps(conversationOf, env, files, boxes);
  // Who hears that a coding run ended (the bots, to report it in its chat).
  const codingListeners = new Set();
  // Coding tools on the computers' screens, one run per computer.
  const coding = createCodingRuns({
    sandbox: desktop.coding,
    window: desktop.window,
    shared: desktop.shared,
    installed: () => codingInstalled(env),
    /**
     * A run ended: told with the computer's conversation, so its bot can report in it. Resolves once
     * every listener has, so a server shutting down hands the report on before it stops.
     */
    ended: async (computerId, run) => {
      const found = await conversationOf(computerId).catch((error) => {
        console.warn(`Computer ${computerId}'s finished coding run couldn't be reported: ${error.message}`);
        return null;
      });
      if (!found) return;
      await Promise.all([...codingListeners].map((listener) => listener({ computerId: String(computerId), conversation: found, run })));
    }
  });
  // A computer is recorded a day at a time, up front, for its conversation's bot, person and home (D-73).
  const whose = async (computerId) => {
    const found = await conversationOf(computerId);
    return { computerId, botId: found?.botId ?? null, userId: found?.userId ?? null, workspaceId: found?.workspaceId ?? null };
  };
  const days = createComputerDays({
    start: async (computerId) => meter.startComputerDay(await whose(computerId)),
    count: async (computerId) => meter.computerDay(await whose(computerId)),
    sleep: (computerId, why) => local.sleep(computerId, why)
  });
  const local = createManager({
    env,
    withDay: days.withDay,
    changed: (computerId, change) => {
      days.changed(computerId, change.state);
      return record(computerId, change);
    },
    store: storeScreenshot,
    coding,
    state,
    apps: desktop,
    // A computer starts only when its apps can run in gVisor; there's no other way (legal, 2026-10-31).
    browser: async (computerId, options) => {
      if (!desktopSandboxAvailable(env)) return null;
      const place = filePlace(files, await conversationOf(computerId));
      const folders = place ? await files.store.prepare(place).catch(() => null) : null;
      await boxes.get(String(computerId))?.stop().catch(() => {});
      const box = await startDesktopSandbox({
        runtimeEnv: env,
        computerId,
        display: options.display,
        profile: options.profile,
        folders
      });
      boxes.set(String(computerId), box);
      return { program: box.chrome, debugPort: box.debugPort, cdpSocket: box.cdpSocket };
    },
    cdp
  });
  let me = null;
  let secret = null;
  let heartbeat = null;
  let sweeper = null;
  let newDays = null;

  /**
   * Called once this server listens, so its address is known. Other servers reach it on
   * MERCBOT_SERVER_URL if set, otherwise on this machine's private IPv4 address when it listens
   * on every interface (as on AWS), or on the address it's bound to.
   */
  async function register(address) {
    const anyInterface = !address.address || address.address === "0.0.0.0" || address.address === "::";
    const host = anyInterface ? privateAddress() : address.address;
    const url = env.MERCBOT_SERVER_URL || `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`;
    me = env.MERCBOT_SERVER_ID || `${os.hostname()}:${address.port}`;
    cdp.listening(address);
    secret = await records.sharedSecret();
    await records.seen(me, url);
    await records.forgetOldServers();
    // Computers this server ran before a restart are gone now.
    await records.putToSleep(me);
    heartbeat = setInterval(() => {
      records.seen(me, url).catch(() => {});
    }, HEARTBEAT_MS);
    heartbeat.unref();
    sweeper = setInterval(() => sweepFiles().catch(() => {}), SWEEP_MS);
    sweeper.unref();
    newDays = setInterval(() => days.countNewDays().catch(() => {}), NEW_DAY_MS);
    newDays.unref();
  }

  /**
   * A deleted conversation's computer files (its screenshots and saved browser) go with it.
   * Conversations go in many ways (a bot, a group, a home or an account deleted), so this looks
   * for folders whose conversation is gone, at most hourly, on every server; doing it twice is
   * harmless.
   */
  async function sweepFiles() {
    if (!await files.store.available()) return;
    const names = (await fs.readdir(files.store.computersRoot).catch(() => [])).filter((name) => /^\d+$/u.test(name));
    for (let start = 0; start < names.length; start += 1000) {
      const batch = names.slice(start, start + 1000);
      const alive = await directory.liveConversationIds(batch, system());
      for (const name of batch.filter((id) => !alive.has(id))) {
        await fs.rm(path.join(files.store.computersRoot, name), { recursive: true, force: true });
      }
    }
  }

  /**
   * Only the server holding a computer records its state; one that lost it to another server
   * can't take it back.
   */
  async function record(computerId, change) {
    if (!me) return;
    await records.recordState(computerId, me, { state: change.state, url: change.url || "", error: change.error || "" }).catch(() => {});
    await notices.publish("computer", computerId, {}).catch((error) => console.warn("Publishing a computer's state failed; screens catch up on their next read.", error));
  }

  /**
   * Screenshots are files in the computer's folder on the shared volume, never anywhere else:
   * without the volume there are none (D-50).
   */
  async function storeScreenshot(computerId, data) {
    if (!folderOf) throw new Error("Screenshots need the files volume.");
    const name = `${computerId}-${randomBytes(8).toString("hex")}.jpg`;
    const dir = path.join(await folderOf(computerId), "screenshots");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), data);
    return name;
  }

  /** The bot's computer record, if the server holding it is alive. */
  const owner = (computerId) => records.owner(computerId);

  /** Take the computer for this server unless a live server already has it. */
  const claim = (computerId) => records.claim(computerId, me);

  async function gone(serverId) {
    await records.forgetServer(serverId).catch(() => {});
  }

  async function forward(url, operation, computerId, args) {
    let response;
    try {
      response = await fetch(`${url}/api/internal/computer`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mercbot-internal": secret },
        body: JSON.stringify({ operation, computerId: String(computerId), args, meter: meter.currentMeter() }),
        signal: AbortSignal.timeout(FORWARD_MS)
      });
    } catch (error) {
      // Nothing answered at all (refused, reset, no route): the server is gone.
      const unreachable = error?.name !== "TimeoutError" && error?.name !== "AbortError";
      throw Object.assign(new Error("The server running this computer didn't answer."), { unreachable });
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `The server running this computer answered ${response.status}.`);
    return body.result;
  }

  /** Run an operation where the computer lives: here, or on its owner. */
  async function run(operation, computerId, ...args) {
    const key = String(computerId);
    let found = await owner(key);
    if (!found && me && !(await claim(key))) found = await owner(key);
    if (found && found.serverId !== me) {
      try {
        return await forward(found.serverUrl, operation, key, args);
      } catch (error) {
        if (!error.unreachable) throw error;
        await gone(found.serverId);
        if (!me || !(await claim(key))) throw error;
      }
    }
    return runHere(operation, key, args);
  }

  /**
   * Run an operation only where the computer is awake already: one that is asleep everywhere has nothing to say, and
   * is neither woken nor taken for this server.
   */
  async function runIfAwake(operation, computerId, args, asleep) {
    const key = String(computerId);
    const found = await owner(key);
    if (found?.state !== "awake") return asleep;
    if (found.serverId === me) return runHere(operation, key, args);
    try {
      return await forward(found.serverUrl, operation, key, args);
    } catch (error) {
      if (!error.unreachable) throw error;
      await gone(found.serverId);
      return asleep;
    }
  }

  async function runHere(operation, computerId, args) {
    if (operation === "wake") {
      await local.wake(computerId);
      return local.status(computerId);
    }
    // A coding tool (codingRuns.js handle): the computer wakes for it, since a tool's sign-in is in
    // its browser profile.
    if (operation === "code") return coding.handle(await local.wake(computerId), args[0] || {});
    return local[operation](computerId, ...args);
  }

  /** The internal route: another server asks this one to run work on a computer it holds. */
  async function answer(headers, body) {
    const given = Buffer.from(String(headers["x-mercbot-internal"] || ""));
    const expected = Buffer.from(String(secret || ""));
    if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new AppError(403, "Not allowed.", { code: "computer_internal_forbidden" });
    }
    if (!OPERATIONS.has(body?.operation)) throw new AppError(400, "Unknown operation.", { code: "computer_internal_operation_unknown" });
    const who = body.meter && typeof body.meter === "object" ? { userId: body.meter.userId, botId: body.meter.botId } : {};
    return meter.track(who, () => runHere(body.operation, String(body.computerId), Array.isArray(body.args) ? body.args : []));
  }

  async function status(computerId) {
    const found = await owner(String(computerId));
    return found ? { state: found.state, url: found.url, error: found.error } : ASLEEP;
  }

  /**
   * Current state first, then again after every change from whichever server runs the
   * computer. Each send rereads the record, one at a time, so a late read can't go backwards.
   */
  function subscribe(computerId, send) {
    let reads = Promise.resolve();
    const refresh = () => {
      reads = reads.then(() => status(computerId)).then((current) => send("state", current)).catch(() => {});
    };
    const unsubscribe = notices.subscribe("computer", String(computerId), refresh);
    refresh();
    return unsubscribe;
  }

  /** A one-time ticket lets the page open the VNC socket for one bot's screen (D-13). */
  async function issueTicket(computerId) {
    const ticket = randomBytes(24).toString("hex");
    await records.issueTicket(computerId, ticket);
    return ticket;
  }

  /** Where a ticket's screen is: here (the ticket is used up) or another server's address. */
  async function findScreen(ticket) {
    const row = await records.ticketFor(ticket);
    if (!row) return null;
    const found = await owner(row.computerId);
    if (found && found.serverId !== me) return { remote: found.serverUrl, gone: () => gone(found.serverId) };
    return (await records.useTicket(row.ticket)) ? local.screen(row.computerId) : null;
  }

  async function screenshotData(computerId, name) {
    if (!new RegExp(`^${Number(computerId)}-[0-9a-f]{16}\\.jpg$`, "u").test(String(name))) return null;
    return fs.readFile(path.join(files.store.computersRoot, String(Number(computerId)), "screenshots", String(name))).catch(() => null);
  }

  async function shutdown() {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    clearInterval(newDays);
    await local.shutdown();
    if (me) await records.forgetServer(me).catch(() => {});
  }

  const wake = (computerId) => run("wake", computerId);

  const sleep = (computerId) => run("sleep", computerId);

  /**
   * Puts the home's awake computers to sleep, wherever they run, when a move of its files starts (D-80): their
   * folders were opened for writing, and the files are read-only until the move is done.
   */
  async function sleepHome(homeId) {
    for (const computerId of await records.awakeInHome(homeId)) {
      await sleep(computerId).catch((error) => console.warn(`Putting computer ${computerId} to sleep for a move of its home's files failed.`, error?.message));
    }
  }

  const reset = (computerId) => run("reset", computerId);

  const browse = (computerId, url) => run("browse", computerId, url);

  /** The first page of a sign-in the person asked for, where its chain starts (D-77). */
  const startSignIn = (computerId, url) => run("startSignIn", computerId, url);

  /** The page in front on the computer, and whether it's in an open sign-in chain (D-77). */
  const signInPage = (computerId) => runIfAwake("signInPage", computerId, [], NO_PAGE);

  /** The sign-in is over: its chain ends (D-77). */
  const endSignIn = (computerId) => runIfAwake("endSignIn", computerId, [], null);

  const act = (computerId, instruction) => run("act", computerId, instruction);

  const fill = (computerId, values) => run("fill", computerId, values);

  const screenshot = (computerId) => run("screenshot", computerId);

  const hold = (computerId, held) => run("hold", computerId, held);

  const open = (computerId, virtualPath) => run("open", computerId, virtualPath);

  /** A coding tool on the computer, where the computer runs: see computerManager's code. */
  const code = (computerId, request) => run("code", computerId, request);

  /**
   * Hears each coding run that ends on this server, with its conversation (computerOf's record):
   * `listener({ computerId, conversation, run })`. Returns a function that stops listening.
   */
  function onCodingEnd(listener) {
    codingListeners.add(listener);
    return () => codingListeners.delete(listener);
  }

  const startRecording = (computerId) => run("startRecording", computerId);

  const stopRecording = (computerId) => run("stopRecording", computerId);

  /** Lets this server's own browser connections through its port (D-68); returns a function that stops. */
  const attachBrowserBridge = (httpServer) => cdp.attach(httpServer);

  return Object.freeze({
    register,
    attachBrowserBridge,
    answer,
    status,
    subscribe,
    issueTicket,
    findScreen,
    screenshotData,
    sweepFiles,
    wake,
    sleep,
    sleepHome,
    reset,
    browse,
    startSignIn,
    act,
    fill,
    signInPage,
    endSignIn,
    screenshot,
    hold,
    open,
    code,
    onCodingEnd,
    startRecording,
    stopRecording,
    shutdown
  });
}

/** Pure helpers the tests reach directly (rule 64). */
export const __testables = Object.freeze({ xtermCommand });
