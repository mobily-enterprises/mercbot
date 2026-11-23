import dns from "node:dns/promises";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

// The only way from bots' sandboxes to the internet (D-49, D-126): a computer's browser and apps, every bot command
// (its own sandbox, or the computer's session) and coding runs. Each sandbox runs in gVisor with no network of its own;
// its traffic reaches this HTTP proxy through a Unix socket. It resolves names itself and connects only to public
// addresses it checked, never to this server or its network: no loopback, private or link-local ranges (cloud
// metadata), no carrier-grade NAT, multicast or reserved ranges, and none of this machine's own addresses. Mail ports
// are refused, so a bot can't send spam. Plain TCP to any other port of a public address goes through CONNECT too
// (D-126). It keeps a short list of where it connected. A command's gateway also has the command's limits (D-127): what
// one command may receive and send, the bot's new connections a minute and the home's internet a day (`meter`,
// internetUsage.js), and keeps what it refused or ended as notes, which the command's output ends with.
const BLOCKED = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4]
]) BLOCKED.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]
]) BLOCKED.addSubnet(address, prefix, "ipv6");
for (const entry of Object.values(os.networkInterfaces()).flat()) {
  if (entry?.address) BLOCKED.addAddress(entry.address, entry.family === "IPv6" ? "ipv6" : "ipv4");
}
const BLOCKED_PORTS = new Set([25, 465, 587, 2525]);
const HEAD_LIMIT = 64 * 1024;
// A command's notes: its first few refusals, and how many more there were.
const NOTES_KEPT = 10;
const MB = 1024 ** 2;
const GB = 1024 ** 3;

/** An amount of data as people read it: "2 GB", "1.5 GB", "200 MB", "12 KB". */
export function sizeText(bytes) {
  if (bytes >= GB) return `${Number((bytes / GB).toFixed(1))} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`;
}

/**
 * An IPv4 address written as IPv6 (::ffff:10.0.0.1) is checked as the IPv4 address it is. (Node's
 * list would match every IPv4 address against the ::ffff:0:0/96 range, so it isn't listed.)
 */
function blocked(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(address)?.[1];
  if (mapped) return BLOCKED.check(mapped, "ipv4");
  if (/^::ffff:/iu.test(address)) return true;
  return BLOCKED.check(address, net.isIPv6(address) ? "ipv6" : "ipv4");
}

/**
 * The public address to connect to for `host`, or an error. Every address a name resolves to must
 * be public, so a name can't point at an internal one some of the time.
 */
async function publicAddress(host) {
  const name = host.replace(/^\[|\]$/gu, "");
  const found = net.isIP(name)
    ? [{ address: name, family: net.isIPv6(name) ? 6 : 4 }]
    : await dns.lookup(name, { all: true }).catch(() => []);
  if (!found.length) throw new Error(`${host} couldn't be found.`);
  if (found.some((entry) => blocked(entry.address))) {
    throw new Error(`Mercbot's gateway doesn't connect to ${host}: it's not a public address.`);
  }
  return found[0];
}

function answer(client, status, message) {
  client.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n` +
    `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
}

/**
 * A gateway's meter (internetUsage.js `forGateway`, D-127).
 * @typedef {{
 *   connection: () => Promise<{ status: string, key: string, message: string } | null>,
 *   add: (received: number, sent: number) => string | null,
 *   close: () => Promise<void>
 * }} GatewayMeter
 */

/** What a command's gateway says when the command passes what one command may receive or send (D-127). */
const PASSED = Object.freeze({
  in: (most) => `Mercbot's gateway ended this command's internet connections: it received ${sizeText(most)}, the most one command may receive.`,
  out: (most) => `Mercbot's gateway ended this command's internet connections: it sent ${sizeText(most)}, the most one command may send.`
});

/**
 * `socketPath`: where the sandbox's forwarder connects. `standIns` (tests only) maps a public "host:port" to the local
 * `{ address, port }` that stands in for it, so a test reaches "the internet" without leaving its machine; the mail
 * ports are refused before it is read.
 *
 * A command's gateway (D-127) has `limits`, the bytes one command may receive (`commandIn`) and send (`commandOut`),
 * and a `meter` (internetUsage.js `forGateway`): `connection()` before each connection, which answers a refusal or
 * null, `add(received, sent)` for each chunk, which answers why the connections must end now or null, and `close()`.
 * Past a command's limit every open connection ends, and later ones are refused, until the next command begins.
 * Every refusal, and the reason connections ended, is kept as a note. A gateway is one command's (a command's own
 * sandbox) or serves one after another (a computer's session): `begin()` starts the next command's count and notes,
 * `notes()` are the present command's. Returns { close(), begin(), notes(), stats }.
 * @param {{
 *   socketPath: string,
 *   standIns?: Map<string, { address: string, port: number }>,
 *   limits?: { commandIn: number, commandOut: number } | null,
 *   meter?: GatewayMeter | null
 * }} options
 */
export async function startGateway({ socketPath, standIns = new Map(), limits = null, meter = null }) {
  const stats = { connections: 0, refused: 0, bytes: 0, recent: [] };
  const note = (host, port, ok) => {
    stats.recent.unshift({ host, port, ok, at: new Date().toISOString() });
    stats.recent.length = Math.min(stats.recent.length, 50);
    if (ok) stats.connections += 1;
    else stats.refused += 1;
  };
  // The present command's bytes each way, its notes by what they're about, and why its connections ended ({ key,
  // message }), if they did.
  const fresh = () => ({ received: 0, sent: 0, notes: new Map(), more: 0, ended: null });
  let command = fresh();
  const remember = (key, message) => {
    if (command.notes.has(key)) return;
    if (command.notes.size < NOTES_KEPT) command.notes.set(key, message);
    else command.more += 1;
  };
  const refuse = (client, status, message, key = message) => {
    remember(key, message);
    answer(client, status, message);
  };
  // Every client connection, and those that reached their host, to end them.
  const clients = new Set();
  const open = new Set();
  const endAll = (key, message) => {
    command.ended = { key, message };
    remember(key, message);
    for (const pair of open) {
      pair.client.destroy();
      pair.upstream.destroy();
    }
  };
  /** Counts a chunk each way, for the command and its home's day, and ends every connection past a limit. */
  const counted = (way) => (chunk) => {
    stats.bytes += chunk.length;
    const now = command;
    now[way] += chunk.length;
    const stop = meter?.add(way === "received" ? chunk.length : 0, way === "sent" ? chunk.length : 0);
    if (now.ended) return;
    if (limits && way === "received" && now.received > limits.commandIn) endAll("in", PASSED.in(limits.commandIn));
    else if (limits && way === "sent" && now.sent > limits.commandOut) endAll("out", PASSED.out(limits.commandOut));
    else if (stop) endAll("day", stop);
  };

  const server = net.createServer((client) => {
    let head = Buffer.alloc(0);
    clients.add(client);
    client.on("close", () => clients.delete(client));
    client.on("error", () => {});
    const onData = async (chunk) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) {
        if (head.length > HEAD_LIMIT) refuse(client, "431 Request Header Fields Too Large", "Too large.");
        return;
      }
      client.off("data", onData);
      client.pause();
      const lines = head.subarray(0, end).toString("latin1").split("\r\n");
      const rest = head.subarray(end + 4);
      const [method, target = "", version = "HTTP/1.1"] = lines[0].split(" ");
      let host = "";
      let port = 0;
      let firstBytes = null;
      if (method === "CONNECT") {
        const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/u.exec(target);
        if (!match) return refuse(client, "400 Bad Request", "Bad CONNECT target.");
        host = match[1];
        port = Number(match[2]);
      } else {
        let url = null;
        try {
          url = new URL(target);
        } catch {
          return refuse(client, "400 Bad Request", "Only proxy requests are accepted.");
        }
        if (url.protocol !== "http:") {
          return refuse(client, "400 Bad Request", "Only http:// is proxied directly; https:// goes through CONNECT.");
        }
        host = url.hostname;
        port = Number(url.port) || 80;
        // Only this request goes to this host: the connection closes after its answer, so a client that keeps its
        // connection to the proxy open asks again on a new one, which is checked again, instead of sending its next
        // request, perhaps for another host, unrewritten to this one.
        const headers = lines.slice(1).filter((line) => !/^(?:proxy-|connection:|keep-alive:)/iu.test(line));
        const requestHead = [`${method} ${url.pathname}${url.search} ${version}`, ...headers, "Connection: close", "", ""].join("\r\n");
        firstBytes = Buffer.concat([Buffer.from(requestHead, "latin1"), rest]);
      }
      if (BLOCKED_PORTS.has(port)) {
        note(host, port, false);
        return refuse(client, "403 Forbidden", `Mercbot's gateway doesn't connect to port ${port}.`);
      }
      const standIn = standIns.get(`${host}:${port}`);
      let address = null;
      try {
        address = standIn ? { address: standIn.address, family: net.isIPv6(standIn.address) ? 6 : 4 } : await publicAddress(host);
      } catch (error) {
        note(host, port, false);
        return refuse(client, "403 Forbidden", error.message);
      }
      // A command past its limits connects nowhere more; then the bot's minute and the home's day (D-127).
      if (command.ended) {
        note(host, port, false);
        return refuse(client, "403 Forbidden", command.ended.message, command.ended.key);
      }
      const refusal = meter ? await meter.connection() : null;
      if (refusal) {
        note(host, port, false);
        return refuse(client, refusal.status, refusal.message, refusal.key);
      }
      if (client.destroyed) return;
      const upstream = net.connect({ host: address.address, port: standIn?.port ?? port, family: address.family });
      const pair = { client, upstream };
      upstream.on("error", () => {
        client.destroy();
      });
      upstream.on("connect", () => {
        note(host, port, true);
        open.add(pair);
        if (method === "CONNECT") client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const first = method === "CONNECT" ? rest : firstBytes;
        if (first.length) {
          upstream.write(first);
          counted("sent")(first);
        }
        upstream.on("data", counted("received"));
        client.on("data", counted("sent"));
        upstream.pipe(client);
        client.pipe(upstream);
        client.resume();
      });
      client.on("close", () => {
        open.delete(pair);
        upstream.destroy();
      });
    };
    client.on("data", onData);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return {
    stats,
    begin() {
      command = fresh();
    },
    notes() {
      const notes = [...command.notes.values()];
      return command.more ? [...notes, `Mercbot's gateway refused ${command.more} more connections.`] : notes;
    },
    // Whatever is still connected ends with the gateway, so its last counts reach the home's day.
    async close() {
      const closed = new Promise((resolve) => server.close(() => resolve()));
      for (const client of clients) client.destroy();
      await closed;
      await meter?.close();
    }
  };
}

/**
 * A sandboxed program's way out: the forwarder below, at 127.0.0.1:3128, in both spellings tools read (curl and git
 * read only the lower-case http_proxy). Loopback stays its own: inside a sandbox it is the sandbox's.
 */
export const PROXY_ENV = Object.freeze([
  "HTTP_PROXY=http://127.0.0.1:3128", "HTTPS_PROXY=http://127.0.0.1:3128", "ALL_PROXY=http://127.0.0.1:3128",
  "http_proxy=http://127.0.0.1:3128", "https_proxy=http://127.0.0.1:3128", "all_proxy=http://127.0.0.1:3128",
  "NO_PROXY=localhost,127.0.0.1,::1", "no_proxy=localhost,127.0.0.1,::1"
]);

/**
 * Inside a sandbox with no network of its own: `python3 forward.py GATEWAY_SOCKET [CDP_PORT]` makes
 * 127.0.0.1:3128 lead to the gateway's socket, the only way out, and marks /tmp/.gateway-ready once
 * it listens. A computer also passes its browser's remote-control port, offered as /io/cdp.sock for
 * Mercbot to drive it; a coding run's sandbox (codingSandbox.js) has no browser.
 */
export const FORWARDER = `import os, socket, sys, threading
GATEWAY = sys.argv[1]
CDP = int(sys.argv[2]) if len(sys.argv) > 2 else 0
def pipe(a, b):
    try:
        while True:
            data = a.recv(65536)
            if not data:
                break
            b.sendall(data)
    except OSError:
        pass
    finally:
        for s in (a, b):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
def bridge(client, connect):
    try:
        upstream = connect()
    except OSError:
        client.close()
        return
    threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
    threading.Thread(target=pipe, args=(upstream, client), daemon=True).start()
def serve(listener, connect):
    while True:
        client, _ = listener.accept()
        bridge(client, connect)
def unix(path):
    s = socket.socket(socket.AF_UNIX)
    s.connect(path)
    return s
proxy = socket.socket()
proxy.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
proxy.bind(("127.0.0.1", 3128))
proxy.listen(64)
if CDP:
    if os.path.exists("/io/cdp.sock"):
        os.unlink("/io/cdp.sock")
    cdp = socket.socket(socket.AF_UNIX)
    cdp.bind("/io/cdp.sock")
    cdp.listen(16)
    threading.Thread(target=serve, args=(cdp, lambda: socket.create_connection(("127.0.0.1", CDP))), daemon=True).start()
open("/tmp/.gateway-ready", "w").close()
serve(proxy, lambda: unix(GATEWAY))
`;

/** Where a sandbox with a gateway of its own sees that gateway's folder (`sandboxGateway`). */
export const GATEWAY_INSIDE = "/gateway";

/**
 * Inside such a sandbox, the lines that start its forwarder and wait, at most 5 s, until it listens; what runs next
 * reaches the gateway at 127.0.0.1:3128.
 */
export const START_FORWARDER = `python3 ${GATEWAY_INSIDE}/forward.py ${GATEWAY_INSIDE}/gateway.sock > /dev/null 2>&1 &
for _ in $(seq 100); do [ -e /tmp/.gateway-ready ] && break; sleep 0.05; done`;

/**
 * A gateway of one sandbox's own (a command's, a computer's session, a coding run's): its socket and the forwarder in
 * `dir` (made here), the folder the sandbox is given at GATEWAY_INSIDE. The sandbox starts with `--host-uds=open`, so
 * it may connect to sockets in the folders it's given: this is the only one of the server's there. `start` is how the
 * gateway starts (tests: one with stand-ins), given `options` (a command's `limits` and `meter`, D-127). Resolves to the
 * gateway, { close(), begin(), notes(), stats }.
 * @param {string} dir
 * @param {typeof startGateway} [start]
 * @param {{ limits?: { commandIn: number, commandOut: number } | null, meter?: object | null }} [options]
 */
export async function sandboxGateway(dir, start = startGateway, options = {}) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "forward.py"), FORWARDER);
  // A socket's path has at most 107 bytes, and a sandbox's folder under a long TMPDIR passes that (Production's
  // /var/lib/mercbot-online-work/tmp gives about 120), so the socket is made through the folder's open handle. The
  // handle stays open until the gateway has closed, which removes the socket by that same path.
  const folder = await fs.open(dir, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    const gateway = await start({ ...options, socketPath: `/proc/self/fd/${folder.fd}/gateway.sock` });
    return { ...gateway, close: () => gateway.close().finally(() => folder.close().catch(() => {})) };
  } catch (error) {
    await folder.close().catch(() => {});
    await options.meter?.close().catch(() => {});
    throw error;
  }
}

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ blocked });
