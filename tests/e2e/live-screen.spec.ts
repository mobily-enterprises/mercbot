import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test, type Page } from "@playwright/test";
import puppeteer from "puppeteer-core";
import { createComputerManager } from "../../packages/computer/src/server/computerManager.js";
import { attachVncBridge } from "../../packages/computer/src/server/vncBridge.js";

// A bot's live view (D-13) on a real screen. The computer manager wakes a computer as on a server, through its own
// display, desktop and screen code: a real Xvfb, a real x11vnc on its Unix socket and a real Chromium drawing the bot's
// pages on that display, in place of the browser's gVisor sandbox (`browser` and `cdp` lead to a plain Chromium, and
// Stagehand, which needs AI, is a stand-in). The person's page shows the screen with noVNC, as MercbotVncScreen.vue
// does, through the server's VNC relay (vncBridge.js), and the test reads the pixels noVNC drew. x11vnc is
// MERCBOT_X11VNC's, else the one on PATH: run it with the x11vnc your hosts get, such as a store host's nixpkgs 0.9.17
// (D-86), which refused every client of its Unix socket while Mercbot gave it -localhost (D-68). No Test Preview is
// needed, so this uses Playwright's test directly rather than harness.ts.

const onPath = (name: string) => (process.env.PATH || "").split(":").map((dir) => path.join(dir, name)).find((file) => existsSync(file)) || "";
const XVFB = process.env.MERCBOT_XVFB || onPath("Xvfb");
const X11VNC = process.env.MERCBOT_X11VNC || onPath("x11vnc");
const COMPUTER = "31";
const NOVNC = path.resolve("node_modules/@novnc/novnc");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A bot's page in two colours: orange on the left half and blue on the right, or the other way round. */
const twoColours = (left: string, right: string) =>
  `<!doctype html><html><body style="margin:0;background:${right}">` +
  `<div style="position:fixed;left:0;top:0;width:50vw;height:100vh;background:${left}"></div></body></html>`;

/** The person's page: noVNC on the bot's screen, view only and unscaled, as the live view opens it. */
const viewer = `<!doctype html><html><body style="margin:0"><div id="screen" style="width:1280px;height:800px"></div>
<script type="module">
import RFB from "/novnc/core/rfb.js";
const ticket = new URLSearchParams(location.search).get("ticket");
const rfb = new RFB(document.getElementById("screen"), "ws://" + location.host + "/api/computer-vnc?ticket=" + ticket, { wsProtocols: ["binary"] });
rfb.viewOnly = true;
rfb.scaleViewport = false;
window.screenState = "connecting";
rfb.addEventListener("connect", () => { window.screenState = "connected"; });
rfb.addEventListener("disconnect", () => { window.screenState = "disconnected"; });
</script></body></html>`;

/** The colour noVNC drew at each point of the bot's screen: "orange", "blue" or its own hex. */
function coloursAt(page: Page, points: [number, number][]) {
  return page.evaluate((at) => {
    const canvas = document.querySelector<HTMLCanvasElement>("#screen canvas");
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !canvas.width) return at.map(() => "no screen");
    const near = (rgb: number[], hex: number) => rgb.every((value, i) => Math.abs(value - ((hex >> (16 - 8 * i)) & 0xff)) <= 12);
    return at.map(([x, y]) => {
      const rgb = Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
      if (near(rgb, 0xff8800)) return "orange";
      if (near(rgb, 0x3366cc)) return "blue";
      return rgb.map((value) => value.toString(16).padStart(2, "0")).join("");
    });
  }, points);
}
// Clear of Chromium's own tab strip and address bar at the top, and of the pointer x11vnc draws at the middle.
const LEFT_AND_RIGHT: [number, number][] = [[320, 600], [960, 600]];

/** The process of the x11vnc serving `socketPath`, read from /proc. */
function x11vncOf(socketPath: string) {
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/u.test(name))) {
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
      if (args[args.indexOf("-unixsock") + 1] === socketPath && args.includes("-rfbport")) return Number(pid);
    } catch {
      // It ended while being read.
    }
  }
  return 0;
}

/** The TCP ports a process listens on, IPv4 and IPv6: its sockets in /proc/<pid>/fd that /proc/net/tcp* lists as listening. */
function tcpListening(pid: number) {
  const sockets = new Set<string>();
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    const inode = /^socket:\[(\d+)\]$/u.exec(readlinkSync(`/proc/${pid}/fd/${fd}`))?.[1];
    if (inode) sockets.add(inode);
  }
  return ["/proc/net/tcp", "/proc/net/tcp6"].flatMap((table) =>
    readFileSync(table, "utf8").split("\n").slice(1).map((line) => line.trim().split(/\s+/u))
      .filter((fields) => fields[3] === "0A" && sockets.has(fields[9])).map((fields) => `${table} ${fields[1]}`));
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = net.createServer().once("error", reject).listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });

let dir = "";
let server: Server | undefined;
let closeBridge: (() => void) | undefined;
let manager: ReturnType<typeof createComputerManager> | undefined;
let site = "";
const tickets = new Set<string>();
const saves: string[] = [];
const sleeps: string[] = [];

test.skip(!XVFB || !X11VNC, "Xvfb or x11vnc isn't installed (README → Hosting requirements)");

test.beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "mercbot-live-screen-"));
  // The bot's browser: Playwright's Chromium, headful on the computer's display, as Mercbot starts it in gVisor.
  const launcher = path.join(dir, "chrome.sh");
  await writeFile(launcher, `#!/bin/sh\nexec '${chromium.executablePath()}' --no-sandbox "$@"\n`);
  await chmod(launcher, 0o755);
  server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url || "/", "http://localhost");
    const file = path.join(NOVNC, pathname.replace(/^\/novnc\//u, ""));
    if (pathname.startsWith("/novnc/") && file.startsWith(`${NOVNC}/`) && existsSync(file)) {
      response.writeHead(200, { "content-type": "text/javascript" }).end(await readFile(file));
    } else {
      const html = { "/bot/left": twoColours("#ff8800", "#3366cc"), "/bot/right": twoColours("#3366cc", "#ff8800"), "/viewer": viewer }[pathname];
      response.writeHead(html ? 200 : 404, { "content-type": "text/html" }).end(html || "");
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  site = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  manager = createComputerManager({
    env: { ...process.env, MERCBOT_XVFB: XVFB, MERCBOT_X11VNC: X11VNC, MERCBOT_TOOLS_DIR: path.join(dir, "tools") },
    dataDir: path.join(dir, "data"),
    changed: () => {},
    store: async () => "shot",
    state: {
      restore: async () => ({ cookies: [], url: "" }),
      save: async (computerId: string) => {
        saves.push(computerId);
      },
      snapshotCookies: async () => {},
      forget: async () => {}
    },
    // As computers.js's, closing takes a while (it ends the command line's session and stops the desktop sandbox), and
    // the screen server's exit lands in it.
    apps: {
      launchers: async () => [],
      closed: async (computerId: string) => {
        sleeps.push(computerId);
        await sleep(1000);
      },
      command: async () => []
    },
    browser: async () => {
      const debugPort = await freePort();
      return { program: launcher, debugPort, cdpSocket: String(debugPort) };
    },
    cdp: {
      route: (port: string) => ({
        browserUrl: async () => (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl,
        close: () => {}
      })
    },
    coding: { running: () => false, stop: async () => {} },
    withDay: (_computerId: string, start: () => Promise<unknown>) => start(),
    noted: () => {},
    libraries: async () => ({
      Stagehand: { create: async () => ({ close: async () => {} }) },
      localBrowser: { connect: async () => ({ close: async () => {} }) },
      puppeteer
    })
  });
  // The relay takes a one-time ticket, as computers.js's findScreen does, to the computer's screen.
  closeBridge = attachVncBridge(server, {
    findScreen: async (ticket: string) => (tickets.delete(ticket) ? manager!.screen(COMPUTER) : null)
  });
});

test.afterAll(async () => {
  await manager?.shutdown();
  closeBridge?.();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(null)));
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("the live view shows the bot's computer through x11vnc's Unix socket, follows its pages, and x11vnc opens no TCP port", async ({ page }) => {
  await manager!.wake(COMPUTER);
  await manager!.browse(COMPUTER, `${site}/bot/left`);
  const { socketPath } = manager!.screen(COMPUTER)!;
  const pid = x11vncOf(socketPath);
  expect(pid, `an x11vnc serves ${socketPath}`).toBeGreaterThan(0);
  expect(tcpListening(pid), "x11vnc listens on no TCP port, IPv4 or IPv6 (D-68)").toEqual([]);

  tickets.add("first");
  await page.goto(`${site}/viewer?ticket=first`);
  await expect.poll(() => page.evaluate(() => (window as unknown as { screenState: string }).screenState)).toBe("connected");
  await expect.poll(() => coloursAt(page, LEFT_AND_RIGHT), { timeout: 15_000 }).toEqual(["orange", "blue"]);

  // The bot opens another page, and the open view shows it.
  await manager!.browse(COMPUTER, `${site}/bot/right`);
  await expect.poll(() => coloursAt(page, LEFT_AND_RIGHT), { timeout: 15_000 }).toEqual(["blue", "orange"]);
  expect(await page.evaluate(() => (window as unknown as { screenState: string }).screenState)).toBe("connected");
});

/** console.error's lines while `work` runs, with those about the screen-sharing server. */
async function errorsDuring(work: (screenLines: () => string[]) => Promise<void>) {
  const logged: string[] = [];
  const consoleError = console.error;
  console.error = (...words: unknown[]) => {
    logged.push(words.map(String).join(" "));
  };
  try {
    await work(() => logged.filter((line) => line.includes("screen-sharing server")));
  } finally {
    console.error = consoleError;
  }
}

test("a screen server that stops by itself while the computer is awake is logged and starts again, and the view shows the screen", async ({ page }) => {
  await manager!.wake(COMPUTER);
  await manager!.browse(COMPUTER, `${site}/bot/right`);
  const { socketPath } = manager!.screen(COMPUTER)!;
  await errorsDuring(async (screenLines) => {
    const first = x11vncOf(socketPath);
    process.kill(first, "SIGKILL");
    await expect.poll(() => x11vncOf(socketPath)).not.toBe(first);
    await expect.poll(() => x11vncOf(socketPath)).toBeGreaterThan(0);
    expect(screenLines()).toEqual([expect.stringMatching(/^Computer 31: the screen-sharing server stopped \(SIGKILL\): /u)]);
    expect(manager!.status(COMPUTER).state).toBe("awake");
  });
  tickets.add("second");
  await page.goto(`${site}/viewer?ticket=second`);
  await expect.poll(() => coloursAt(page, LEFT_AND_RIGHT), { timeout: 15_000 }).toEqual(["blue", "orange"]);
});

test("a computer put to sleep stops its screen server without calling that a failure or starting it again, and is put away once", async () => {
  await manager!.wake(COMPUTER);
  const { socketPath } = manager!.screen(COMPUTER)!;
  const vnc = x11vncOf(socketPath);
  const [saved, slept] = [saves.length, sleeps.length];
  await errorsDuring(async (screenLines) => {
    await manager!.sleep(COMPUTER);
    await expect.poll(() => existsSync(`/proc/${vnc}`)).toBe(false);
    // Long enough for a start again, and for a second put-away's close (1 s), had either begun.
    await sleep(2500);
    expect(screenLines()).toEqual([]);
  });
  expect(x11vncOf(socketPath), "no x11vnc started again on the sleeping computer's socket").toBe(0);
  expect(manager!.status(COMPUTER)).toEqual({ state: "asleep", url: "", error: "" });
  expect([saves.length - saved, sleeps.length - slept], "the computer's browser saved once, and its apps closed once").toEqual([1, 1]);
});
