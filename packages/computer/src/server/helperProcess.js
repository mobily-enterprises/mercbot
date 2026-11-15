import { spawn } from "node:child_process";
import net from "node:net";

// Starting the helper programs of a bot's computer (computerManager.js): Xvfb and x11vnc, each waited on until it's ready.

/** Waits `ms` milliseconds. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Start a helper program; reject with its own words if it exits before `ready()` is true. */
export function startProcess(name, command, args, { env, ready, timeoutMs = 8000 }) {
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

export function canConnect(socketPath) {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    socket.once("connect", () => {
      socket.destroy(); resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
