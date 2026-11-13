import dns from "node:dns/promises";
import net from "node:net";
import os from "node:os";

// The only way from a computer's apps to the internet (D-47, branch computer-gvisor). The apps run
// in gVisor with no network of their own; their traffic reaches this HTTP proxy through a Unix
// socket. It resolves names itself and connects only to public addresses it checked, never to
// this server or its network: no loopback, private or link-local ranges (cloud metadata), no
// carrier-grade NAT, multicast or reserved ranges, and none of this machine's own addresses. Mail
// ports are refused, so a computer can't send spam. It keeps a short list of where it connected.
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

function refuse(client, status, message) {
  client.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n` +
    `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
}

/** `socketPath`: where the apps' forwarder connects. Returns { close(), stats }. */
export async function startGateway({ socketPath }) {
  const stats = { connections: 0, refused: 0, bytes: 0, recent: [] };
  const note = (host, port, ok) => {
    stats.recent.unshift({ host, port, ok, at: new Date().toISOString() });
    stats.recent.length = Math.min(stats.recent.length, 50);
    if (ok) stats.connections += 1;
    else stats.refused += 1;
  };

  const server = net.createServer((client) => {
    let head = Buffer.alloc(0);
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
        const headers = lines.slice(1).filter((line) => !/^proxy-/iu.test(line));
        const requestHead = [`${method} ${url.pathname}${url.search} ${version}`, ...headers, "", ""].join("\r\n");
        firstBytes = Buffer.concat([Buffer.from(requestHead, "latin1"), rest]);
      }
      if (BLOCKED_PORTS.has(port)) {
        note(host, port, false);
        return refuse(client, "403 Forbidden", `Mercbot's gateway doesn't connect to port ${port}.`);
      }
      let address = null;
      try {
        address = await publicAddress(host);
      } catch (error) {
        note(host, port, false);
        return refuse(client, "403 Forbidden", error.message);
      }
      const upstream = net.connect({ host: address.address, port, family: address.family });
      upstream.on("error", () => {
        client.destroy();
      });
      upstream.on("connect", () => {
        note(host, port, true);
        if (method === "CONNECT") {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (rest.length) upstream.write(rest);
        } else {
          upstream.write(firstBytes);
        }
        const count = (chunk) => {
          stats.bytes += chunk.length;
        };
        upstream.on("data", count);
        client.on("data", count);
        upstream.pipe(client);
        client.pipe(upstream);
        client.resume();
      });
      client.on("close", () => upstream.destroy());
    };
    client.on("data", onData);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return {
    stats,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

/** A sandboxed program's way out: the forwarder below, at 127.0.0.1:3128; loopback stays its own. */
export const PROXY_ENV = Object.freeze([
  "HTTP_PROXY=http://127.0.0.1:3128", "HTTPS_PROXY=http://127.0.0.1:3128",
  "http_proxy=http://127.0.0.1:3128", "https_proxy=http://127.0.0.1:3128", "NO_PROXY=localhost,127.0.0.1"
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

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ blocked });
