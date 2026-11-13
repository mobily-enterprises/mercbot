import { randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { fromThisMachine, ownOrigin } from "@local/files/own-machine";

// A bot's browser runs in gVisor (D-47) and offers its remote control (CDP) as a Unix socket, and
// a published server may listen on no TCP port but its own (D-68). Stagehand and Puppeteer reach
// the browser through that port instead: /api/computer-cdp/<key>/devtools/..., where <key> is a
// fresh random 256-bit key for each computer's browser, known only to this process. Only this
// machine's own connections that came through no proxy are let through; the rest are refused.
const PREFIX = "/api/computer-cdp/";
const KEY = /^[0-9a-f]{64}$/u;

/** Chrome's GET /json/version, asked over its Unix socket. */
function browserVersion(socketPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ socketPath, path: "/json/version", headers: { host: "127.0.0.1" }, timeout: 3000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(response.statusCode === 200 ? JSON.parse(body) : null);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once("timeout", () => request.destroy(new Error("The browser didn't answer.")));
    request.once("error", reject);
  });
}

/** Passes an upgrade request on to the Unix socket as `target`, then both ways byte for byte. */
function pipeUpgrade(request, socket, head, socketPath, target) {
  const upstream = net.connect(socketPath);
  const close = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.once("error", close);
  socket.once("error", close);
  upstream.once("close", close);
  socket.once("close", close);
  upstream.once("connect", () => {
    const lines = [`${request.method} ${target} HTTP/${request.httpVersion}`];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      lines.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
}

/**
 * The bridge between Stagehand and Puppeteer, which take only a ws:// address, and the browsers'
 * Unix sockets.
 */
export function createCdpBridge() {
  const routes = new Map();
  let origin = "";

  /** This server listens at `address`; its own connections reach it there. */
  function listening(address) {
    origin = ownOrigin(address, "ws");
  }

  /**
   * One browser's route: `browserUrl()` is its ws:// address through this server once the browser
   * answers (empty until then), and `close()` ends the route.
   */
  function route(socketPath) {
    const key = randomBytes(32).toString("hex");
    routes.set(key, socketPath);
    return {
      async browserUrl() {
        if (!origin) throw new Error("This server isn't listening yet.");
        const version = await browserVersion(socketPath);
        const pathname = version?.webSocketDebuggerUrl ? new URL(version.webSocketDebuggerUrl).pathname : "";
        return pathname.startsWith("/devtools/") ? `${origin}${PREFIX}${key}${pathname}` : "";
      },
      close() {
        routes.delete(key);
      }
    };
  }

  /** Takes this server's WebSocket upgrades for the routes; returns a function that stops. */
  function attach(httpServer) {
    const onUpgrade = (request, socket, head) => {
      const url = String(request.url || "");
      if (!url.startsWith(PREFIX)) return;
      const rest = url.slice(PREFIX.length);
      const key = rest.slice(0, 64);
      const target = rest.slice(64);
      const socketPath = KEY.test(key) ? routes.get(key) : undefined;
      if (!socketPath || !target.startsWith("/devtools/") || !fromThisMachine(socket, request.headers)) {
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      pipeUpgrade(request, socket, head, socketPath, target);
    };
    httpServer.on("upgrade", onUpgrade);
    return () => {
      httpServer.off("upgrade", onUpgrade);
      routes.clear();
    };
  }

  return Object.freeze({
    listening,
    route,
    attach
  });
}
