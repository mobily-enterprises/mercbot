import net from "node:net";
import WebSocket, { WebSocketServer } from "ws";

// The page's noVNC talks WebSocket; x11vnc talks VNC on a Unix socket (D-68). This relays one to the
// other, but only for a valid one-time ticket issued to the bot's owner (D-13). When another
// server runs the computer, the socket is relayed to that server, signed as servers sign their calls
// to each other, and that server uses up the ticket (D-15).
const PATH = "/api/computer-vnc";

function relay(ws, other) {
  const close = () => {
    ws.close();
    other.close();
  };
  ws.on("message", (data) => {
    if (other.readyState === WebSocket.OPEN) other.send(data);
  });
  other.on("message", (data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
  other.once("close", close);
  other.once("error", close);
  ws.once("close", () => other.close());
}

function toScreen(ws, target) {
  const vnc = net.connect(target.socketPath);
  target.opened();
  const close = () => {
    ws.close();
    vnc.destroy();
  };
  vnc.on("data", (data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
  ws.on("message", (data) => vnc.write(data));
  vnc.once("close", close);
  vnc.once("error", close);
  ws.once("close", () => {
    vnc.destroy();
    target.closed();
  });
}

export function attachVncBridge(httpServer, computers) {
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => (protocols.has("binary") ? "binary" : false) });

  httpServer.on("upgrade", async (request, socket, head) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname !== PATH) return;
    const ticket = url.searchParams.get("ticket") || "";
    const target = await computers.findScreen(ticket).catch(() => null);
    if (!target) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    // Hold the page's frames until the other server's socket is open.
    const other = target.remote
      ? new WebSocket(`${target.remote.replace(/^http/u, "ws")}${PATH}?ticket=${encodeURIComponent(ticket)}`, ["binary"], { headers: target.headers })
      : null;
    if (other) {
      const opened = await new Promise((resolve) => {
        other.once("open", () => resolve(true));
        other.once("error", () => resolve(false));
      });
      if (!opened) {
        // The server running the screen is gone; the computer will wake again elsewhere.
        await target.gone();
        socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        return;
      }
    }
    wss.handleUpgrade(request, socket, head, (ws) => (other ? relay(ws, other) : toScreen(ws, target)));
  });

  // Closing ends every open screen too, so its page reconnects (to another server, if this one is
  // going away).
  return () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
  };
}
