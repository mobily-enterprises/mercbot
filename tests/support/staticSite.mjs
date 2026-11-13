import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

// A web server for tests: it serves a folder on 127.0.0.1 under `at` (such as /site/), as a person's web server serves
// the folder their website's pages are uploaded to, with index.html for an address ending in a slash.

const TYPES = Object.freeze({ ".html": "text/html; charset=utf-8", ".png": "image/png", ".css": "text/css", ".json": "application/json" });

/**
 * @param {string} folder
 * @param {{ at?: string }} [options]
 * @returns {Promise<{ url: string, close: () => Promise<void> }>} its address, ending in a slash, and how to stop it
 */
export async function serveFolder(folder, { at = "/" } = {}) {
  const server = http.createServer(async (request, response) => {
    const { pathname } = new URL(request.url, "http://site.test");
    const wanted = decodeURIComponent(pathname);
    const real = wanted.startsWith(at) ? path.join(folder, wanted.slice(at.length), wanted.endsWith("/") ? "index.html" : "") : null;
    const body = real && real.startsWith(folder) ? await fs.readFile(real).catch(() => null) : null;
    if (!body) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": TYPES[path.extname(real)] || "application/octet-stream" });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}${at}`,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    })
  };
}
