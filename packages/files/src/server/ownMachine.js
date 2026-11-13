// A published server listens on no TCP port but its own (D-68), so what reaches it from this machine itself, a bot
// browser's remote control (computer/cdpBridge.js) and a Google Drive mount's key requests (driveTokenRoute.js),
// comes in on that port beside the public proxy's traffic. Only this machine's own connections that came through no
// proxy are let through.
const PROXY_HEADERS = Object.freeze(["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "via"]);

const loopback = (address = "") => /^(127\.|::1$|::ffff:127\.)/u.test(address);

/**
 * Whether a request came from this machine itself (a loopback address, or the server's own) and through no proxy.
 * @param {{ remoteAddress?: string, localAddress?: string }} socket
 * @param {Record<string, unknown>} headers
 */
export function fromThisMachine(socket, headers) {
  const own = loopback(socket.remoteAddress) || (Boolean(socket.remoteAddress) && socket.remoteAddress === socket.localAddress);
  return own && !PROXY_HEADERS.some((name) => headers[name] !== undefined);
}

/**
 * Where this server's own connections reach it, `scheme://host:port`, from the address it listens at: 127.0.0.1 when
 * it listens on every interface.
 * @param {{ address?: string, port: number }} address
 * @param {"http" | "ws"} scheme
 */
export function ownOrigin(address, scheme) {
  const anyInterface = !address.address || address.address === "0.0.0.0" || address.address === "::";
  const host = anyInterface ? "127.0.0.1" : address.address;
  return `${scheme}://${host.includes(":") ? `[${host}]` : host}:${address.port}`;
}
