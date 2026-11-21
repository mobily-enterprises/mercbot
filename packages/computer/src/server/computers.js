import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createBrowserState } from "./browserState.js";
import { createCdpBridge } from "./cdpBridge.js";
import { createCodingRuns } from "./codingRuns.js";
import { startCodingSandbox } from "./codingSandbox.js";
import { createComputerControl } from "./computerControl.js";
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
// A coding tool's requests that act on the computer, which wait while a person has control (D16); status and stop don't.
const CODING_ACTS = new Set(["signIn", "start"]);
const ASLEEP = Object.freeze({ state: "asleep", url: "", error: "" });
// The notice every server hears when a chat's computers go with it (chatRemoved).
const REMOVED = "computers-removed";
const EVERY_SERVER = "every-server";

// No live server can take a computer that runs nowhere (D-85).
const noneFree = () => new AppError(503, "No computer can start right now. Try again in a minute.", { code: "computer_none_free" });
// What a computer that isn't awake anywhere has in front: no page, so no sign-in chain (D-77).
const NO_PAGE = Object.freeze({ url: "", inChain: false, startedFrom: "" });

function privateAddress() {
  const candidates = Object.values(os.networkInterfaces()).flat().filter((entry) => entry && entry.family === "IPv4" && !entry.internal);
  return candidates[0]?.address || "127.0.0.1";
}

/**
 * Whose files the computer works on: its chat's, its bot's and the home's (R6, D14), the last two only read in a
 * private chat (D13). `found` is the computer's bot in its chat (records.directory.computerOf's ComputerPlace).
 */
function filePlace(files, found) {
  return found
    ? files.store.placeFor({ homeId: found.workspaceId, chatId: found.chatId, chatKind: found.chatKind, botId: found.botId })
    : null;
}

/**
 * What starts xterm as the host's own user. In Mercbot's own user namespace (MERCBOT_NAMESPACE=own, D-68) Mercbot is
 * that namespace's root, and xterm started as root gives the program in its window root's groups (initgroups) before
 * starting it, which a user namespace refuses (setgroups is denied there): the program never started and the window
 * closed at once ("Cannot chown /dev/pts/N to 0,5"), the Terminal on every host without MERCBOT_SANDBOX_USER. There
 * xterm runs in a user namespace of its own as the user and group Mercbot's namespace maps its root to, the host's own,
 * as it runs where Mercbot keeps the host's namespace (D-51). Nothing is given up: Mercbot's namespace has only those.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
function asHostUser(env) {
  if (env.MERCBOT_NAMESPACE !== "own") return [];
  const outside = (file) => readFileSync(file, "utf8").trim().split(/\s+/u)[1];
  return [env.MERCBOT_UNSHARE || "unshare", "--user", `--map-user=${outside("/proc/self/uid_map")}`,
    `--map-group=${outside("/proc/self/gid_map")}`, "--"];
}

/**
 * An xterm window on the desktop titled `title`, showing `argv`; null without xterm. One this server
 * opens itself names the computer's `display`; the dock's are started on it already.
 */
function xtermCommand(env, title, argv, display = null) {
  const xterm = program(env, "xterm");
  if (!xterm || !argv) return null;
  const libraries = path.join(path.resolve(env.MERCBOT_TOOLS_DIR || ".tools"), "desktop", "usr", "lib", "x86_64-linux-gnu");
  return [...asHostUser(env), "env", `LD_LIBRARY_PATH=${libraries}`, "LANG=C.UTF-8", "LC_ALL=C.UTF-8",
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
  return box.exec(["/usr/bin/env", "HOME=/files/chat/.apps", `/opt/apps/${bin}/bin/${bin}`, ...(file ? [file] : [])]);
}

/**
 * The office apps on bots' desktops (D-23) and the Terminal on the computer's command line (D-47),
 * each run in its computer's desktop sandbox (`boxes`).
 */
function desktopApps(placeOf, env, files, boxes) {
  /** A coding run's project: `folder` of the computer's files, by its link-free path here. */
  async function projectFolder(computerId, folder) {
    const place = filePlace(files, await placeOf(computerId));
    const found = place ? await files.store.prepare(place).then(() => files.store.existingFolder(place, folder)).catch(() => null) : null;
    if (!found) throw new Error(`There's no folder ${folder} in the bot's files.`);
    return { source: found.real, destination: found.virtualPath };
  }

  return {
    async launchers(computerId) {
      const found = await placeOf(computerId);
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
     * an existing folder of the computer's files it may change (/files/chat, or in a public chat
     * /files/bot or /files/shared, or one in them) given by its link-free path, or with `title` its sign-in, in a window on the screen.
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
 * Where a computer runs unless a copy built on Mercbot says otherwise (D-15): on the server that needs it, with the
 * servers' calls to each other signed with the secret kept in the database.
 * @type {import("./types.js").ComputerPlacement}
 */
export const PLACE_HERE = Object.freeze({
  choose: async (_computerId, servers) => servers.here,
  secret: null
});

/** Where computers running out of room is told without a feature that listens (`mercbot.computer-events`, D-88): the log. */
export const LOG_COMPUTER_EVENTS = Object.freeze({
  /** @type {import("./types.js").ComputerEvents["record"]} */
  async record({ kind, computerId, serverId, code }) {
    if (kind === "made_room") console.info(`Computer ${computerId} was put to sleep on ${serverId} to make room for another.`);
    else console.warn(`Computer ${computerId} couldn't start (${code}, on ${serverId}).`);
  }
});

/**
 * Bot computers on several servers (D-15). Each computer runs on one server, its owner,
 * recorded in bot_computers; every other server passes work for it to the owner over HTTP,
 * signed with a secret kept in the database. A bot's computer wakes again on its last server
 * while that server is alive, so its browser profile (sign-ins) is still there. State, screen
 * tickets and screenshots live in PostgreSQL, and state changes reach every server as notices.
 * A server that can't be reached counts as gone straight away, so its computers move to the
 * server that needs them; if it was only a blip, its next heartbeat registers it again.
 * A copy built on Mercbot may say where computers run instead (`placement`, D-85): it chooses the
 * server for each computer no live server holds, and gives the secret servers sign their calls with.
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.resources the computer feature's handles
 * @param {(reason: string) => object} dependencies.systemContext the computer feature's system scope
 * @param {{ computerOf: Function, liveChatBotIds: Function }} dependencies.directory records.directory
 * @param {{ names: Function, people: Function }} dependencies.chats records.chats: who takes over, and who hears of it
 * @param {{ append: Function }} dependencies.messages records.messages: a take-over's line in its chat
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env Read when needed, so a change to it shows (tests change
 *   MERCBOT_SERVER_ID).
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {import("@local/files/server/types").Files} dependencies.files
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {import("./types.js").ComputerPlacement} dependencies.placement Where computers run: `PLACE_HERE`, or where a
 *   copy built on Mercbot says (`mercbot.computer-placement`).
 * @param {import("./types.js").ComputerEvents} [dependencies.events] Who hears when computers run out of room (D-88):
 *   `LOG_COMPUTER_EVENTS`, or a feature (`mercbot.computer-events`).
 * @param {typeof createComputerManager} [dependencies.createManager] The computers this server runs
 *   (tests use stand-ins).
 */
export function createComputers({
  resources,
  systemContext,
  directory,
  chats,
  messages,
  env,
  notices,
  files,
  meter,
  placement,
  events = LOG_COMPUTER_EVENTS,
  createManager = createComputerManager
}) {
  // Computers run on no request and pass between servers, so their reads and writes are this
  // feature's system context's, by the computer's id.
  const system = () => ({ context: systemContext("run bot computers across servers: which server holds each, its state, saved browser and screen tickets") });
  /**
   * A bot's computer belongs to its chat (D14): one per bot in each chat, used by whoever can open the chat, with
   * everything signed in on it. Its key, computerId, is that bot's chat_bots id.
   */
  const placeOf = (computerId, options = system()) => directory.computerOf(String(computerId), options);
  const records = createComputerRecords({
    resources,
    system,
    homeOf: async (computerId, options) => (await placeOf(computerId, options))?.workspaceId ?? null
  });
  /**
   * Tells `events` that a computer was put to sleep to make room, or couldn't start (D-88), on this server; nothing waits
   * for it, and its failure is only logged.
   * @param {{ kind: "made_room" | "refused", computerId: string, code?: string }} event
   */
  function note({ kind, computerId, code = null }) {
    Promise.resolve()
      .then(() => events.record({ kind, computerId: String(computerId), serverId: me, code }))
      .catch((error) => console.warn(`Telling who listens that computer ${computerId} ${kind === "made_room" ? "made room" : "couldn't start"} failed.`, error));
  }
  /** A computer's screenshots and saved browser are files on the shared volume (D-50). */
  const folderOf = (computerId, how) => files.store.computerFolder(computerId, how);
  // What it writes there reaches where the files are kept before it's recorded (D-91), so another server finds it.
  const state = createBrowserState({ records, env, folderOf, settle: (computerId) => files.store.settleComputer(computerId) });
  // Each awake computer's apps run in gVisor (D-47, branch computer-gvisor): Chrome and the Craft
  // apps in one desktop sandbox per computer, on the internet only through its gateway.
  const boxes = new Map();
  if (!state.available) console.warn(NO_SAVED_BROWSERS);
  // Stagehand and Puppeteer reach each browser's Unix socket through this server's own port (D-68).
  const cdp = createCdpBridge();
  const desktop = desktopApps(placeOf, env, files, boxes);
  // Who hears that a coding run ended (the bots, to report it in its chat).
  const codingListeners = new Set();
  // Coding tools on the computers' screens, one run per computer.
  const coding = createCodingRuns({
    sandbox: desktop.coding,
    window: desktop.window,
    shared: desktop.shared,
    installed: () => codingInstalled(env),
    /**
     * A run ended: told with the computer's bot in its chat, so the bot can report there. Resolves once
     * every listener has, so a server shutting down hands the report on before it stops.
     */
    ended: async (computerId, run) => {
      const found = await placeOf(computerId).catch((error) => {
        console.warn(`Computer ${computerId}'s finished coding run couldn't be reported: ${error.message}`);
        return null;
      });
      if (!found) return;
      await Promise.all([...codingListeners].map((listener) => listener({ computerId: String(computerId), place: found, run })));
    }
  });
  // A computer is recorded a day at a time, up front, for its bot and home (D-73): it's its chat's, no one person's.
  const whose = async (computerId) => {
    const found = await placeOf(computerId);
    return { computerId, botId: found?.botId ?? null, userId: null, workspaceId: found?.workspaceId ?? null };
  };
  const days = createComputerDays({
    start: async (computerId) => meter.startComputerDay(await whose(computerId)),
    count: async (computerId) => meter.computerDay(await whose(computerId)),
    sleep: (computerId, why) => local.sleep(computerId, why)
  });
  const local = createManager({
    env,
    noted: note,
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
      const place = filePlace(files, await placeOf(computerId));
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
  let stopHearingRemoved = null;

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
    secret = placement.secret ?? await records.sharedSecret();
    await records.seen(me, url);
    await records.forgetOldServers();
    // Computers this server ran before a restart are gone now.
    await records.putToSleep(me);
    heartbeat = setInterval(() => {
      records.seen(me, url).catch(() => {});
    }, HEARTBEAT_MS);
    heartbeat.unref();
    // A deleted chat's computers are put to sleep by whichever server runs them (chatRemoved).
    stopHearingRemoved = notices.subscribe(REMOVED, EVERY_SERVER, (event) => {
      sleepRemoved(event).catch(() => {});
    });
    sweeper = setInterval(() => sweepFiles().catch(() => {}), SWEEP_MS);
    sweeper.unref();
    newDays = setInterval(() => days.countNewDays().catch(() => {}), NEW_DAY_MS);
    newDays.unref();
  }

  /**
   * A computer's files (its screenshots and saved browser) go with its bot's seat in its chat.
   * Seats go in many ways (a chat, a bot, a home or an account deleted, a bot taken out of a chat), so this looks
   * for folders whose seat is gone, at most hourly, on every server; doing it twice is harmless.
   */
  async function sweepFiles() {
    if (!await files.store.available()) return;
    // Wherever they're kept: the files folder, or the files bucket (D-91).
    const names = (await files.store.computerIds()).filter((name) => /^\d+$/u.test(name));
    for (let start = 0; start < names.length; start += 1000) {
      const batch = names.slice(start, start + 1000);
      const alive = await directory.liveChatBotIds(batch, system());
      for (const name of batch.filter((id) => !alive.has(id))) await files.store.removeComputerFolder(name);
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
   * without the volume there are none (D-50). A copy that checks pictures (D-90) checks only the ones a reply shows
   * people, queued once its turn is over (botTools.js), so a screenshot is kept here unqueued.
   */
  async function storeScreenshot(computerId, data) {
    if (!folderOf) throw new Error("Screenshots need the files volume.");
    const name = `${computerId}-${randomBytes(8).toString("hex")}.jpg`;
    const dir = path.join(await folderOf(computerId), "screenshots");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), data);
    await files.store.settleComputer(computerId);
    return name;
  }

  /** The bot's computer record, if the server holding it is alive. */
  const owner = (computerId) => records.owner(computerId);

  async function gone(serverId) {
    console.warn(`Server ${serverId} didn't answer; it counts as gone, and its computers start again where they're needed next.`);
    await records.forgetServer(serverId).catch(() => {});
  }

  /**
   * Where a computer no live server holds goes (D-85): to the server the placement chooses, this one unless a copy built
   * on Mercbot says otherwise. It's taken for that server unless a live server took it first. Answers the record of the
   * server that holds it now, or null when that's this one.
   */
  async function place(computerId) {
    const target = await placement.choose(computerId, { here: me, live: records.liveServers });
    if (!target) throw refused(computerId);
    if ((await records.claim(computerId, target)) && target === me) return null;
    const found = await owner(computerId);
    if (found?.serverId === me || (!found && target === me)) return null;
    if (!found) throw refused(computerId);
    return found;
  }

  /** The answer for a computer no server can take, told to `events` first. */
  function refused(computerId) {
    note({ kind: "refused", computerId, code: "computer_none_free" });
    return noneFree();
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

  /**
   * Run an operation where the computer lives: here, or on its owner. One that no live server holds is placed first;
   * an owner that doesn't answer counts as gone, and the computer is placed again, once.
   */
  async function run(operation, computerId, ...args) {
    const key = String(computerId);
    let found = await owner(key);
    if (!found && me) found = await place(key);
    if (found && found.serverId !== me) {
      try {
        return await forward(found.serverUrl, operation, key, args);
      } catch (error) {
        if (!error.unreachable) throw error;
        await gone(found.serverId);
        if (!me) throw error;
        found = await place(key);
        if (found) return forward(found.serverUrl, operation, key, args);
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

  /**
   * The computer's state wherever it runs, who has control of it (D16: `{ userId, name, since }` or null) and what's
   * signed in on it (`[{ label, kind, since }]`), as its panel shows them.
   */
  async function status(computerId) {
    const [found, signIns] = await Promise.all([owner(String(computerId)), records.signIns(String(computerId))]);
    const control = found?.control ? await takeOvers.named(found.control, system()).catch(() => ({ ...found.control, name: "Someone" })) : null;
    return { ...(found ? { state: found.state, url: found.url, error: found.error } : ASLEEP), control, signIns };
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

  /**
   * Where a ticket's screen is: here (the ticket is used up) or another server's address, with the header that signs
   * the relay to it.
   */
  async function findScreen(ticket) {
    const row = await records.ticketFor(ticket);
    if (!row) return null;
    const found = await owner(row.computerId);
    if (found && found.serverId !== me) {
      return { remote: found.serverUrl, headers: { "x-mercbot-internal": secret }, gone: () => gone(found.serverId) };
    }
    return (await records.useTicket(row.ticket)) ? local.screen(row.computerId) : null;
  }

  async function screenshotData(computerId, name) {
    if (!new RegExp(`^${Number(computerId)}-[0-9a-f]{16}\\.jpg$`, "u").test(String(name))) return null;
    const file = await files.store.computerFile(Number(computerId), `screenshots/${name}`).catch(() => null);
    return file ? fs.readFile(file).catch(() => null) : null;
  }

  async function shutdown() {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    clearInterval(newDays);
    stopHearingRemoved?.();
    await local.shutdown();
    if (me) await records.forgetServer(me).catch(() => {});
  }

  const wake = (computerId) => run("wake", computerId);

  const sleep = (computerId) => run("sleep", computerId);

  /**
   * Puts the home's awake computers to sleep, wherever they run: all of them when a move of its files starts (D-80),
   * as their folders were opened for writing and the files are read-only until the move is done; with `among`, only
   * those of its computers, such as an archived bot's (D-108), so none of them counts a computer day while it's put away.
   * One read of the home's awake computers, however many are asked for.
   * @param {string} homeId
   * @param {string[] | null} [among] computer ids (chat_bots ids)
   */
  async function sleepHome(homeId, among = null) {
    const only = among && new Set(among.map(String));
    for (const computerId of await records.awakeInHome(homeId)) {
      if (only && !only.has(computerId)) continue;
      await sleep(computerId).catch((error) => console.warn(`Putting computer ${computerId} to sleep failed.`, error?.message));
    }
  }

  /** A reset starts the computer afresh: its saved browser goes, and with it what was signed in there. */
  const reset = (computerId) => run("reset", computerId);

  // While a person has control of a computer, the bot's own calls that act on it are refused, naming them (D16).
  const takeOvers = createComputerControl({ records, directory, chats, messages, notices, wake, system });
  const bots = (operation) => async (computerId, ...args) => {
    await takeOvers.heldOff(computerId);
    return run(operation, computerId, ...args);
  };

  const browse = bots("browse");

  /** The first page of a sign-in the person asked for, where its chain starts (D-77). */
  const startSignIn = bots("startSignIn");

  /** The page in front on the computer, and whether it's in an open sign-in chain (D-77). */
  const signInPage = (computerId) => runIfAwake("signInPage", computerId, [], NO_PAGE);

  /** The sign-in is over: its chain ends (D-77). */
  const endSignIn = (computerId) => runIfAwake("endSignIn", computerId, [], null);

  const act = bots("act");

  /** Typing in a sign-in's fields; one that typed a password lists its site among the computer's sign-ins (D16). */
  async function fill(computerId, values) {
    const result = await bots("fill")(computerId, values);
    await takeOvers.filled(computerId, values, result);
    return result;
  }

  const screenshot = bots("screenshot");

  const hold = (computerId, held) => run("hold", computerId, held);

  const open = (computerId, virtualPath) => run("open", computerId, virtualPath);

  /**
   * A coding tool on the computer, where the computer runs: see computerManager's code. Signing in and starting a run
   * wait while a person has control; a tool signed in there is listed among the computer's sign-ins.
   */
  async function code(computerId, request) {
    if (CODING_ACTS.has(request?.action)) await takeOvers.heldOff(computerId);
    const result = await run("code", computerId, request);
    await takeOvers.coded(computerId, result);
    return result;
  }

  /**
   * A chat was deleted (chatMembers): its computers go to sleep wherever they run, and its folder, its computers' and
   * its command outputs go from where the home's files are kept. Each step's failure is said and the rest go on; the
   * hourly sweep removes computers' folders whose seats are gone.
   * @param {{ homeId: string, chatId: string, chatBotIds: string[] }} chat
   */
  async function chatRemoved({ homeId, chatId, chatBotIds = [] }) {
    const ids = chatBotIds.map(String);
    const warn = (what) => (error) => console.warn(`Removing deleted chat ${chatId}'s ${what} failed.`, error?.message);
    // Their rows went with the chat, so every server is asked (sleepRemoved): the one running each puts it to sleep.
    await sleepRemoved({ chatBotIds: ids });
    await notices.publish(REMOVED, EVERY_SERVER, { chatBotIds: ids }).catch(warn("computers on other servers"));
    for (const computerId of ids) {
      await files.store.removeComputerFolder(computerId).catch(warn(`computer ${computerId}'s folder`));
      await files.store.removeRunsFolder(computerId).catch(warn(`computer ${computerId}'s command outputs`));
    }
    await files.store.removeChatFolder(homeId, chatId).catch(warn("folder"));
  }

  /** Puts to sleep the computers among `chatBotIds` that run on this server: their chat was deleted. */
  async function sleepRemoved({ chatBotIds } = {}) {
    const ids = Array.isArray(chatBotIds) ? chatBotIds.filter((id) => /^\d+$/u.test(String(id))) : [];
    await Promise.all(ids.map((computerId) => local.sleep(String(computerId)).catch(() => {})));
  }

  /**
   * Hears each coding run that ends on this server, with its bot in its chat (computerOf's record):
   * `listener({ computerId, place, run })`. Returns a function that stops listening.
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
    servers: records.servers,
    attachBrowserBridge,
    answer,
    status,
    subscribe,
    issueTicket,
    findScreen,
    screenshotData,
    sweepFiles,
    chatRemoved,
    takeOver: takeOvers.takeOver,
    handBack: takeOvers.handBack,
    placeOf: takeOvers.placeOf,
    noteSignIn: takeOvers.noteSignIn,
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
