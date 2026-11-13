import { spawn } from "node:child_process";

/**
 * A Model Context Protocol client over a child's stdin and stdout (newline-delimited JSON-RPC),
 * enough to list and call one app's tools. A call that takes too long stops the app.
 */
export function startMcp(command, args, { callTimeoutMs = 120000 } = {}) {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
  const waiting = new Map();
  let buffer = "";
  let nextId = 0;
  let stopped = false;

  function stop(reason) {
    stopped = true;
    for (const entry of waiting.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    waiting.clear();
  }

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const entry = waiting.get(message.id);
      if (!entry) continue;
      waiting.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || "The app refused that."));
      else entry.resolve(message.result);
    }
  });
  child.on("exit", () => stop("The app stopped."));
  child.on("error", () => stop("The app couldn't start."));
  child.stdin.on("error", () => {});

  function send(message) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  function request(method, params) {
    if (stopped) return Promise.reject(new Error("The app stopped."));
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error("The app took too long, so it was stopped."));
        child.kill("SIGKILL");
      }, callTimeoutMs);
      waiting.set(id, { resolve, reject, timer });
      send({ id, method, params });
    });
  }

  const ready = request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mercbot", version: "1" }
  }).then(() => send({ method: "notifications/initialized" }));

  return {
    get stopped() {
      return stopped;
    },
    async tools() {
      await ready;
      return (await request("tools/list", {})).tools || [];
    },
    async call(name, args) {
      await ready;
      return request("tools/call", { name, arguments: args });
    },
    close() {
      stopped = true;
      child.stdin.end();
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }
  };
}
