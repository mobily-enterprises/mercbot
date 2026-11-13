// Development only (D-47, D-49): how fast is the bots' Chrome in gVisor on this machine? Loads the
// same pages, drives typing and scrolling, five rounds, and prints medians; run it once plain and once
// with MERCBOT_GVISOR_PLATFORM=kvm to compare the two (docs/deployment.md). Needs a free X display:
// DISPLAY_NUMBER (default 93) is started here with Xvfb, as a bot's computer starts its own.
// Usage: node scripts/measure-browser-speed.mjs
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { xvfbArgs } from "../packages/computer/src/server/computerManager.js";
import { startDesktopSandbox } from "../packages/computer/src/server/desktopSandbox.js";

const display = process.env.DISPLAY_NUMBER || "93";
const ROUNDS = Number(process.env.ROUNDS) || 5;
const PAGES = ["https://example.com/", "https://en.wikipedia.org/wiki/Main_Page", "https://news.ycombinator.com/", "https://www.bbc.com/news", "https://github.com/explore"];
const freePort = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function measure(start) {
  const port = await freePort();
  const profile = await mkdtemp(path.join(os.tmpdir(), "mb-speed-"));
  const { program, stop, debugPort } = await start(port, profile);
  const started = Date.now();
  const child = spawn(program, [`--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, `--display=:${display}`, "--no-first-run", "--test-type", "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
  let browser = null;
  while (!browser && Date.now() - started < 60000) {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null }).catch(() => null);
    if (!browser) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const startup = Date.now() - started;
  const page = (await browser.pages())[0] || await browser.newPage();
  const loads = Object.fromEntries(PAGES.map((url) => [url, []]));
  const typing = [];
  const scrolling = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    for (const url of PAGES) {
      const t = Date.now();
      await page.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => {});
      loads[url].push(Date.now() - t);
    }
    await page.goto("data:text/html,<input id=q style='width:600px'><div style='height:20000px;background:linear-gradient(red,blue)'></div>");
    let t = Date.now();
    await page.type("#q", "The quick brown fox jumps over the lazy dog, twice.", { delay: 0 });
    typing.push(Date.now() - t);
    t = Date.now();
    for (let step = 0; step < 40; step += 1) await page.mouse.wheel({ deltaY: 400 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    scrolling.push(Date.now() - t);
  }
  await browser.close().catch(() => {});
  child.kill();
  await stop();
  await rm(profile, { recursive: true, force: true });
  return { startup, loads: Object.fromEntries(Object.entries(loads).map(([url, times]) => [url, median(times)])), typing: median(typing), scrolling: median(scrolling) };
}

const xvfb = spawn(process.env.MERCBOT_XVFB || "Xvfb", xvfbArgs(display), { stdio: "ignore" });
await new Promise((resolve) => setTimeout(resolve, 1500));
try {
  const gvisor = await measure(async (port, profile) => {
    const box = await startDesktopSandbox({ runtimeEnv: process.env, computerId: "speed", display, profile, folders: null });
    // The browser's remote control is the sandbox's Unix socket (D-68); here, on a development
    // machine, a local port leads to it.
    const bridge = net.createServer((client) => {
      const upstream = net.connect(box.cdpSocket);
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
      client.pipe(upstream).pipe(client);
    });
    await new Promise((resolve) => bridge.listen(port, "127.0.0.1", resolve));
    return { program: box.chrome, debugPort: box.debugPort, stop: () => { bridge.close(); return box.stop(); } };
  });
  const rows = [["", `gVisor, ${process.env.MERCBOT_GVISOR_PLATFORM || "systrap"} platform`]];
  const add = (name, value) => rows.push([name, `${value} ms`]);
  add("start to connected", gvisor.startup);
  for (const url of PAGES) add(`load ${new URL(url).hostname}`, gvisor.loads[url]);
  add("typing 51 characters", gvisor.typing);
  add("scrolling 40 steps", gvisor.scrolling);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
} finally {
  xvfb.kill();
}
