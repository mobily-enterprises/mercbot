import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { promisify } from "node:util";

// A stand-in for Google Drive's own API (v3) and Google's token endpoint, for the tests of a home's files kept in
// Google Drive (D-26, D-80) and the Test Preview. It keeps its files in memory and answers what Mercbot and rclone's
// Drive backend ask:
// - GET /drive/v3/files?q=… (the clauses rclone and Mercbot write: trashed, 'id' in parents, name, mimeType),
//   GET …/files/:id (with ?alt=media the bytes, with Range), POST /drive/v3/files (a folder or an empty file),
//   PATCH …/files/:id (rename, move with addParents/removeParents, to the bin, modified time), DELETE …/files/:id,
//   GET /drive/v3/about (the quota); what's in a folder in the bin is in the bin too, as in Google Drive;
// - uploads at /upload/drive/v3/files[/:id]: multipart in one request, and resumable in chunks (rclone's way for
//   files from 8 MB, each chunk sent with POST or PUT to the session's address);
// - Google's sign-in, enough for a person to sign in again: GET /authorize sends the browser straight back with a
//   code, POST /token turns it into keys (and gives Mercbot its access back) or renews a key from a refresh key,
//   refusing with invalid_grant once `refuse()` was called, and GET /oauth2/v3/userinfo says who signed in;
// Every Drive call needs a key it handed out and that hasn't run out; others are refused with 401.
// Mercbot calls it on its plain http address (`url`). rclone's Drive backend always calls https://www.googleapis.com,
// so in tests it goes through `proxy`, a CONNECT proxy that answers for that name with a certificate from a test
// authority (`caFile`, which rclone is told to trust): the same stand-in behind it. Making those needs openssl.

const FOLDER = "application/vnd.google-apps.folder";
const run = promisify(execFile);

/** A test authority and a certificate for www.googleapis.com signed by it, in a folder of their own. */
async function certificates() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-drive-ca-"));
  const file = (name) => path.join(dir, name);
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];
  await run("openssl", ["req", "-x509", ...ec, "-keyout", file("ca.key"), "-out", file("ca.pem"), "-days", "2", "-subj", "/CN=Mercbot test authority",
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
  await run("openssl", ["req", ...ec, "-keyout", file("leaf.key"), "-out", file("leaf.csr"), "-subj", "/CN=www.googleapis.com"]);
  await writeFile(file("leaf.ext"), "subjectAltName=DNS:www.googleapis.com\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n");
  await run("openssl", ["x509", "-req", "-in", file("leaf.csr"), "-CA", file("ca.pem"), "-CAkey", file("ca.key"), "-CAcreateserial",
    "-out", file("leaf.pem"), "-days", "2", "-extfile", file("leaf.ext")]);
  return { dir, caFile: file("ca.pem"), key: await readFile(file("leaf.key")), cert: await readFile(file("leaf.pem")) };
}

/** The clauses of a Drive search (`q`), as a function of a file: and, or, not, brackets and the comparisons used. */
function compileQuery(text) {
  const tokens = [];
  const pattern = /\s*(?:(\()|(\))|'((?:\\.|[^'\\])*)'|(!=|=|<=|>=|<|>)|([A-Za-z_][\w.]*))/gyu;
  let match;
  while (pattern.lastIndex < text.length && (match = pattern.exec(text))) {
    if (match[1]) tokens.push({ kind: "(" });
    else if (match[2]) tokens.push({ kind: ")" });
    else if (match[3] !== undefined) tokens.push({ kind: "string", value: match[3].replace(/\\(.)/gu, "$1") });
    else if (match[4]) tokens.push({ kind: "op", value: match[4] });
    else tokens.push({ kind: "word", value: match[5] });
    if (/^\s*$/u.test(text.slice(pattern.lastIndex))) break;
  }
  let at = 0;
  const peek = () => tokens[at];
  const word = (value) => peek()?.kind === "word" && peek().value.toLowerCase() === value;
  const fieldOf = (file, name) => (name === "name" ? file.name : name === "mimeType" ? file.mimeType : name === "trashed" ? file.trashed : undefined);
  const valueOf = (token) => (token.kind === "string" ? token.value : token.value === "true" ? true : token.value === "false" ? false : token.value);
  function clause() {
    if (peek()?.kind === "(") {
      at += 1;
      const inner = expression();
      at += 1;
      return inner;
    }
    if (word("not")) {
      at += 1;
      const inner = clause();
      return (file) => !inner(file);
    }
    const left = tokens[at++];
    if (left.kind === "string" && word("in")) {
      at += 1;
      const field = tokens[at++].value;
      return (file) => (field === "parents" ? file.parents.includes(left.value) : false);
    }
    const op = tokens[at++].value;
    const right = valueOf(tokens[at++]);
    const compare = (value) => (op === "=" ? value === right : op === "!=" ? value !== right : false);
    return (file) => compare(fieldOf(file, left.value));
  }
  function expression() {
    let result = clause();
    while (word("and") || word("or")) {
      const joiner = tokens[at++].value.toLowerCase();
      const left = result;
      const right = clause();
      result = joiner === "and" ? (file) => left(file) && right(file) : (file) => left(file) || right(file);
    }
    return result;
  }
  return tokens.length ? expression() : () => true;
}

const now = () => new Date().toISOString();

/**
 * Starts the stand-in Drive on 127.0.0.1, and, unless `proxy: false`, the CONNECT proxy rclone goes through.
 * @param {{ proxy?: boolean, quota?: number }} [options] `quota`: the Drive's size in bytes
 */
export async function startFakeDrive({ proxy: withProxy = true, quota = 15 * 1024 ** 3 } = {}) {
  const files = new Map();
  const uploads = new Map();
  const keys = new Map();
  const refreshKeys = new Set();
  const requests = [];
  const codes = new Set();
  // `renewalDelay`: how long a renewal takes, in ms, so two at once overlap; `uploadDelay`: how long each upload takes,
  // so a copy is still going when a test looks; `unavailable`: Drive answers 503.
  const state = { refreshes: 0, refused: false, quota, renewalDelay: 0, uploadDelay: 0, unavailable: false };
  let url = "";

  /** A key Drive takes for `seconds`, and the refresh key that renews it. */
  function issue(seconds = 3600) {
    const access = `drive-access-${randomBytes(9).toString("hex")}`;
    keys.set(access, Date.now() + seconds * 1000);
    const refresh = `drive-refresh-${randomBytes(9).toString("hex")}`;
    refreshKeys.add(refresh);
    return { access, refresh, expiresAt: Date.now() + seconds * 1000 };
  }

  /** Whether the file is in the bin: put there itself, or in a folder that is (Google's `trashed`). */
  function binned(file) {
    for (let at = file, depth = 0; at && depth < 100; at = files.get(at.parents[0]), depth += 1) if (at.trashed) return true;
    return false;
  }

  const fileJson = (file) => ({
    kind: "drive#file",
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents,
    trashed: binned(file),
    explicitlyTrashed: file.trashed,
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
    webViewLink: `https://drive.google.com/file/d/${file.id}/view`,
    ...(file.mimeType === FOLDER ? {} : { size: String(file.data.length), md5Checksum: createHash("md5").update(file.data).digest("hex") })
  });
  const used = () => [...files.values()].reduce((sum, file) => sum + (file.data?.length || 0), 0);

  function add({ name, mimeType = "application/octet-stream", parents = [], data = Buffer.alloc(0), modifiedTime }) {
    const id = randomBytes(12).toString("base64url");
    const file = { id, name, mimeType, parents, trashed: false, data, createdTime: now(), modifiedTime: modifiedTime || now() };
    files.set(id, file);
    return file;
  }

  function apply(file, metadata = {}, query = new URLSearchParams()) {
    if (metadata.name !== undefined) file.name = String(metadata.name);
    if (metadata.trashed !== undefined) file.trashed = Boolean(metadata.trashed);
    if (metadata.modifiedTime) file.modifiedTime = metadata.modifiedTime;
    if (metadata.mimeType && metadata.mimeType !== FOLDER && file.mimeType !== FOLDER) file.mimeType = metadata.mimeType;
    const removing = (query.get("removeParents") || "").split(",").filter(Boolean);
    const adding = (query.get("addParents") || "").split(",").filter(Boolean);
    const kept = file.parents.filter((parent) => !removing.includes(parent));
    file.parents = [...kept, ...adding.filter((parent) => !kept.includes(parent))];
    if (!metadata.modifiedTime && (metadata.name !== undefined || adding.length)) file.modifiedTime = file.modifiedTime || now();
  }

  /** The two parts of a multipart/related upload: its metadata and its bytes. */
  function multipart(body, contentType) {
    const boundary = /boundary="?([^";]+)"?/u.exec(contentType)?.[1];
    if (!boundary) return null;
    const marker = Buffer.from(`--${boundary}`);
    const parts = [];
    let start = body.indexOf(marker);
    while (start !== -1) {
      const next = body.indexOf(marker, start + marker.length);
      if (next === -1) break;
      const part = body.subarray(start + marker.length, next);
      const split = part.indexOf("\r\n\r\n");
      if (split !== -1) {
        const headers = part.subarray(0, split).toString("utf8");
        let content = part.subarray(split + 4);
        if (content.subarray(-2).toString() === "\r\n") content = content.subarray(0, -2);
        parts.push({ type: /content-type:\s*([^\r\n;]+)/iu.exec(headers)?.[1]?.trim() || "", content });
      }
      start = next;
    }
    const [meta, media] = parts;
    return meta ? { metadata: JSON.parse(meta.content.toString("utf8") || "{}"), data: media?.content || Buffer.alloc(0), type: media?.type } : null;
  }

  const failure = (status, reason, message) => ({
    status,
    body: { error: { code: status, message, errors: [{ domain: status === 401 ? "global" : "global", reason, message }] } }
  });

  async function handle(request, body) {
    const address = new URL(request.url, url);
    const query = address.searchParams;
    const route = address.pathname;
    // A listing that looks one file up by its name is told apart from a folder's listing.
    const lookup = route === "/drive/v3/files" && /\bname\s*=/u.test(query.get("q") || "") ? "?name" : "";
    requests.push(`${request.method} ${route}${query.get("uploadType") ? `?uploadType=${query.get("uploadType")}` : lookup}`);

    if (route === "/authorize" && request.method === "GET") {
      const code = `drive-code-${randomBytes(9).toString("hex")}`;
      codes.add(code);
      const back = new URL(query.get("redirect_uri"));
      back.searchParams.set("code", code);
      back.searchParams.set("state", query.get("state") || "");
      return { status: 302, headers: { location: back.href } };
    }

    if (route === "/token" && request.method === "POST") {
      const form = new URLSearchParams(body.toString("utf8"));
      if (form.get("grant_type") === "authorization_code" && codes.delete(form.get("code"))) {
        // Signed in again: Mercbot's access is back.
        state.refused = false;
        const { access, refresh } = issue();
        return { status: 200, body: { access_token: access, refresh_token: refresh, expires_in: 3599, token_type: "Bearer", scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email" } };
      }
      if (form.get("grant_type") !== "refresh_token" || !refreshKeys.has(form.get("refresh_token")) || state.refused) {
        return { status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } };
      }
      if (state.renewalDelay) await new Promise((resolve) => setTimeout(resolve, state.renewalDelay));
      state.refreshes += 1;
      const access = `drive-access-${randomBytes(9).toString("hex")}`;
      keys.set(access, Date.now() + 3600 * 1000);
      return { status: 200, body: { access_token: access, expires_in: 3599, token_type: "Bearer", scope: "https://www.googleapis.com/auth/drive" } };
    }

    const key = /^Bearer (\S+)$/u.exec(String(request.headers.authorization || ""))?.[1];
    if (!key || !(keys.get(key) > Date.now()) || state.refused) {
      return failure(401, "authError", "Request had invalid authentication credentials.");
    }

    if (route === "/oauth2/v3/userinfo") return { status: 200, body: { email: "pat@example.com" } };
    if (state.unavailable) return failure(503, "backendError", "The service is currently unavailable.");

    if (route === "/drive/v3/about") {
      return { status: 200, body: { storageQuota: { limit: String(state.quota), usage: String(used()), usageInDrive: String(used()), usageInDriveTrash: "0" }, user: { emailAddress: "pat@example.com" } } };
    }

    if (route === "/drive/v3/files" && request.method === "GET") {
      const matches = compileQuery(query.get("q") || "");
      const found = [...files.values()].filter((file) => matches({ ...file, trashed: binned(file) })).sort((a, b) => a.name.localeCompare(b.name));
      const size = Math.min(Number(query.get("pageSize")) || 100, 1000);
      const from = Number(query.get("pageToken") || 0);
      const page = found.slice(from, from + size);
      return { status: 200, body: { kind: "drive#fileList", incompleteSearch: false, files: page.map(fileJson), ...(from + size < found.length ? { nextPageToken: String(from + size) } : {}) } };
    }

    if (route === "/drive/v3/files" && request.method === "POST") {
      const metadata = JSON.parse(body.toString("utf8") || "{}");
      const file = add({ name: metadata.name, mimeType: metadata.mimeType, parents: metadata.parents || ["root"], modifiedTime: metadata.modifiedTime });
      return { status: 200, body: fileJson(file) };
    }

    const one = /^\/drive\/v3\/files\/([^/]+)$/u.exec(route);
    if (one) {
      const file = files.get(decodeURIComponent(one[1]));
      if (!file) return failure(404, "notFound", `File not found: ${one[1]}.`);
      if (request.method === "GET" && query.get("alt") === "media") {
        const range = /^bytes=(\d+)-(\d*)$/u.exec(String(request.headers.range || ""));
        if (!range) return { status: 200, raw: file.data, type: file.mimeType };
        const from = Number(range[1]);
        const to = range[2] ? Math.min(Number(range[2]), file.data.length - 1) : file.data.length - 1;
        if (from >= file.data.length) return { status: 416, raw: Buffer.alloc(0), headers: { "content-range": `bytes */${file.data.length}` } };
        return { status: 206, raw: file.data.subarray(from, to + 1), type: file.mimeType, headers: { "content-range": `bytes ${from}-${to}/${file.data.length}` } };
      }
      if (request.method === "GET") return { status: 200, body: fileJson(file) };
      if (request.method === "PATCH") {
        apply(file, JSON.parse(body.toString("utf8") || "{}"), query);
        return { status: 200, body: fileJson(file) };
      }
      if (request.method === "DELETE") {
        files.delete(file.id);
        return { status: 204 };
      }
    }

    const upload = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/u.exec(route);
    if (upload) {
      if (state.uploadDelay) await new Promise((resolve) => setTimeout(resolve, state.uploadDelay));
      const existing = upload[1] ? files.get(decodeURIComponent(upload[1])) : null;
      if (upload[1] && !existing) return failure(404, "notFound", `File not found: ${upload[1]}.`);
      const type = query.get("uploadType");
      if (type === "multipart") {
        const parts = multipart(body, String(request.headers["content-type"] || ""));
        if (!parts) return failure(400, "badRequest", "Malformed multipart body.");
        const growth = parts.data.length - (existing?.data.length || 0);
        if (used() + growth > state.quota) return failure(403, "storageQuotaExceeded", "The user's Drive storage quota has been exceeded.");
        const file = existing || add({ name: parts.metadata.name, mimeType: parts.metadata.mimeType || parts.type, parents: parts.metadata.parents || ["root"] });
        apply(file, parts.metadata, query);
        file.data = parts.data;
        if (!parts.metadata.modifiedTime) file.modifiedTime = now();
        return { status: 200, body: fileJson(file) };
      }
      // rclone sends each chunk with POST to the session's address, Google's guide with PUT.
      if (type === "resumable" && !query.get("upload_id")) {
        const id = randomBytes(9).toString("hex");
        uploads.set(id, { metadata: JSON.parse(body.toString("utf8") || "{}"), existing, query, chunks: [], received: 0 });
        const origin = request.socket.encrypted ? "https://www.googleapis.com" : url;
        return { status: 200, headers: { location: `${origin}/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` } };
      }
      if (type === "resumable") {
        const pending = uploads.get(query.get("upload_id"));
        if (!pending) return failure(404, "notFound", "Upload not found.");
        const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/u.exec(String(request.headers["content-range"] || ""));
        if (body.length) {
          pending.chunks.push(body);
          pending.received += body.length;
        }
        const total = range && range[3] !== "*" ? Number(range[3]) : null;
        if (total === null || pending.received < total) {
          return { status: 308, headers: pending.received ? { range: `bytes=0-${pending.received - 1}` } : {} };
        }
        uploads.delete(query.get("upload_id"));
        const data = Buffer.concat(pending.chunks);
        if (used() + data.length - (pending.existing?.data.length || 0) > state.quota) {
          return failure(403, "storageQuotaExceeded", "The user's Drive storage quota has been exceeded.");
        }
        const file = pending.existing || add({ name: pending.metadata.name, mimeType: pending.metadata.mimeType, parents: pending.metadata.parents || ["root"] });
        apply(file, pending.metadata, pending.query);
        file.data = data;
        if (!pending.metadata.modifiedTime) file.modifiedTime = now();
        return { status: 200, body: fileJson(file) };
      }
    }
    return failure(404, "notFound", `No such call: ${request.method} ${route}.`);
  }

  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      try {
        const answer = await handle(request, Buffer.concat(chunks));
        const headers = { ...(answer.headers || {}) };
        if (answer.raw) {
          response.writeHead(answer.status, { "content-type": answer.type || "application/octet-stream", "content-length": String(answer.raw.length), ...headers });
          response.end(answer.raw);
        } else if (answer.body) {
          response.writeHead(answer.status, { "content-type": "application/json; charset=UTF-8", ...headers });
          response.end(JSON.stringify(answer.body));
        } else {
          response.writeHead(answer.status, { "content-length": "0", ...headers });
          response.end();
        }
      } catch (error) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: 500, message: String(error?.message || error) } }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;

  let proxyServer = null;
  let proxy = "";
  let caFile = "";
  let certDir = "";
  if (withProxy) {
    const made = await certificates();
    certDir = made.dir;
    caFile = made.caFile;
    proxyServer = http.createServer((_request, response) => response.writeHead(405).end());
    proxyServer.on("connect", (request, socket) => {
      if (!/^(www\.googleapis\.com|oauth2\.googleapis\.com):443$/u.test(String(request.url))) {
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n", () => {
        const secure = new tls.TLSSocket(socket, { isServer: true, key: made.key, cert: made.cert });
        secure.on("error", () => socket.destroy());
        server.emit("connection", secure);
      });
    });
    await new Promise((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
    proxy = `http://127.0.0.1:${proxyServer.address().port}`;
  }

  return {
    url,
    proxy,
    caFile,
    files,
    requests,
    state,
    issue,
    /** Puts a file or folder in the Drive, as a person or another app would: `{ name, mimeType?, parents, data? }`. */
    add: (file) => add({ ...file, data: Buffer.from(file.data || "") }),
    /** The newest file named so, not in the bin, or null. */
    named: (name) => [...files.values()].filter((file) => file.name === name && !file.trashed).at(-1) || null,
    /** The files and folders directly in a folder, by name, without the bin. */
    childrenOf: (id) => [...files.values()].filter((file) => file.parents.includes(id) && !binned(file)).map((file) => file.name).sort(),
    /**
     * Everything in a folder and its folders, by path ("a/b.txt" with its text, folders as "a/" with null): what's not
     * in the bin, or with `bin` what is.
     */
    tree(id, { bin = false } = {}) {
      const found = {};
      const walk = (folderId, prefix) => {
        for (const file of files.values()) {
          if (!file.parents.includes(folderId)) continue;
          const named = `${prefix}${file.name}${file.mimeType === FOLDER ? "/" : ""}`;
          if (binned(file) === bin) found[named] = file.mimeType === FOLDER ? null : file.data.toString("utf8");
          if (file.mimeType === FOLDER) walk(file.id, named);
        }
      };
      walk(id, "");
      return found;
    },
    /** From now on every key and every renewal is refused: the person withdrew Mercbot's access. */
    refuse: () => {
      state.refused = true;
    },
    /** Takes back one key, as Google does when it runs out. */
    expire: (access) => keys.set(access, 0),
    async close() {
      server.closeAllConnections?.();
      proxyServer?.closeAllConnections?.();
      await Promise.all([new Promise((resolve) => server.close(resolve)), proxyServer && new Promise((resolve) => proxyServer.close(resolve))]);
      if (certDir) await rm(certDir, { recursive: true, force: true });
    }
  };
}
