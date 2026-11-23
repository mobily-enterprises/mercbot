import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { startGateway } from "../../packages/files/src/server/gateway.js";
import { shellAvailable } from "../../packages/files/src/server/gvisor.js";
import { __testables, createShell } from "../../packages/files/src/server/shell.js";

const run = promisify(execFile);
const { LIMITS } = __testables;

// Bots' commands reach public internet addresses through a gateway of their own, the computer's browser's (D-126), in
// real gVisor: in a command's own sandbox and in the computer's session, for the bot's commands and the person's shell.
// Every "public" address here is a stand-in on this machine that the gateway is told to use for that name (its
// `standIns`, for tests only), so nothing reaches the internet; every other address is the gateway's own business,
// refused before anything connects. Runs where gVisor and the toolbox are installed (MERCBOT_TOOLS_DIR; on the desktop
// test host, /opt/mercbot-tools), with git and openssl for the stand-in repository.
const has = (command) => spawnSync("sh", ["-c", `command -v ${command}`]).status === 0;
const skip = !shellAvailable(process.env)
  ? "gVisor and the toolbox aren't installed (npm run tools:install)"
  : !has("git") || !has("openssl") ? "the stand-in repository needs git and openssl" : false;

// Production's TMPDIR, /var/lib/mercbot-online-work/tmp, has 32 characters: under it, a sandbox's folder, and so its
// gateway's socket, passes the 107 bytes a socket's path may have. This file's sandboxes are made under a TMPDIR as long
// (longer, where this machine's own already is).
const PRODUCTION_TMPDIR = "/var/lib/mercbot-online-work/tmp";
const longTmp = await fs.mkdtemp(path.join(os.tmpdir(), "m".repeat(Math.max(1, PRODUCTION_TMPDIR.length - os.tmpdir().length - 7))));
process.env.TMPDIR = longTmp;

const HELLO = "Hello from the stand-in internet";

/** A test authority and a certificate for `name` signed by it, in `dir`: { caFile, key, cert }. */
async function certificates(dir, name) {
  const file = (base) => path.join(dir, base);
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];
  await run("openssl", ["req", "-x509", ...ec, "-keyout", file("ca.key"), "-out", file("ca.pem"), "-days", "2", "-subj", "/CN=Mercbot test authority",
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
  await run("openssl", ["req", ...ec, "-keyout", file("leaf.key"), "-out", file("leaf.csr"), "-subj", `/CN=${name}`]);
  await fs.writeFile(file("leaf.ext"), `subjectAltName=DNS:${name}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`);
  await run("openssl", ["x509", "-req", "-in", file("leaf.csr"), "-CA", file("ca.pem"), "-CAkey", file("ca.key"), "-CAcreateserial",
    "-out", file("leaf.pem"), "-days", "2", "-extfile", file("leaf.ext")]);
  return { caFile: file("ca.pem"), key: await fs.readFile(file("leaf.key")), cert: await fs.readFile(file("leaf.pem")) };
}

/** A public repository's stand-in: a bare repository with one commit, served by git's plain ("dumb") HTTP. */
async function standInRepository(dir) {
  const work = path.join(dir, "work");
  const bare = path.join(dir, "demo.git");
  const git = (...args) => run("git", ["-c", "user.name=Stand-in", "-c", "user.email=stand-in@example.test", "-c", "init.defaultBranch=main", ...args]);
  await git("init", "-q", work);
  await fs.writeFile(path.join(work, "README.md"), "# The stand-in website\n");
  await git("-C", work, "add", "README.md");
  await git("-C", work, "commit", "-q", "-m", "The first page");
  await git("clone", "-q", "--bare", work, bare);
  await git("-C", bare, "update-server-info");
  return bare;
}

/** A package registry's stand-in, with one package that has a program: { packument(origin), tarball }. */
async function standInPackage(dir) {
  const files = path.join(dir, "package-src");
  await fs.mkdir(path.join(files, "package"), { recursive: true });
  await fs.writeFile(path.join(files, "package", "package.json"),
    JSON.stringify({ name: "tiny-tool", version: "1.0.0", bin: { "tiny-tool": "cli.js" } }));
  await fs.writeFile(path.join(files, "package", "cli.js"), "#!/usr/bin/env node\nconsole.log(\"tiny-tool ran\");\n");
  const tarFile = path.join(dir, "tiny-tool-1.0.0.tgz");
  await run("tar", ["-czf", tarFile, "-C", files, "package"]);
  const tarball = await fs.readFile(tarFile);
  const packument = (origin) => JSON.stringify({
    name: "tiny-tool",
    "dist-tags": { latest: "1.0.0" },
    versions: {
      "1.0.0": {
        name: "tiny-tool",
        version: "1.0.0",
        bin: { "tiny-tool": "cli.js" },
        dist: {
          tarball: `${origin}/tiny-tool/-/tiny-tool-1.0.0.tgz`,
          shasum: createHash("sha1").update(tarball).digest("hex"),
          integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`
        }
      }
    }
  });
  return { packument, tarball };
}

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(() => resolve()));

let world = null;

before(async () => {
  if (skip) return;
  const dir = await fs.mkdtemp(path.join(longTmp, "stand-ins-"));
  const seen = { web: 0, mail: 0 };
  const [{ caFile, key, cert }, bare, tiny] = await Promise.all([
    certificates(dir, "git.example.test"), standInRepository(dir), standInPackage(dir)
  ]);
  // The web: a page, and the registry's package. Only the gateway reaches it, on the names below.
  const web = http.createServer((request, response) => {
    seen.web += 1;
    if (request.url === "/hello.txt") return response.end(`${HELLO}\n`);
    if (request.url === "/big.bin") return response.end(Buffer.alloc(3 * 1024 ** 2, 7));
    if (request.url === "/tiny-tool") return response.setHeader("content-type", "application/json").end(tiny.packument("http://registry.example.test"));
    if (request.url === "/tiny-tool/-/tiny-tool-1.0.0.tgz") return response.end(tiny.tarball);
    response.statusCode = 404;
    response.end();
  });
  // The repository over https, with the test authority's certificate for its name.
  const git = https.createServer({ key, cert }, async (request, response) => {
    const file = path.join(bare, decodeURIComponent(new URL(request.url, "https://git.example.test").pathname).replace(/^\/demo\.git\//u, ""));
    const body = file.startsWith(bare) ? await fs.readFile(file).catch(() => null) : null;
    response.statusCode = body ? 200 : 404;
    response.setHeader("content-type", "text/plain");
    response.end(body ?? "");
  });
  // Plain TCP (a database's port, say), and a mail server no command must reach.
  const tcp = net.createServer((socket) => socket.end("plain tcp reached\n"));
  const mail = net.createServer((socket) => {
    seen.mail += 1;
    socket.end("220 mail\r\n");
  });
  const [webPort, gitPort, tcpPort, mailPort] = await Promise.all([listen(web), listen(git), listen(tcp), listen(mail)]);
  const standIns = new Map([
    ["files.example.test:80", { address: "127.0.0.1", port: webPort }],
    ["registry.example.test:80", { address: "127.0.0.1", port: webPort }],
    ["git.example.test:443", { address: "127.0.0.1", port: gitPort }],
    ["db.example.test:5432", { address: "127.0.0.1", port: tcpPort }],
    ["mail.example.test:587", { address: "127.0.0.1", port: mailPort }]
  ]);
  const store = createFileStore({ root: "", fallback: path.join(dir, "files"), ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const rows = new Map();
  const runs = {
    begin: async (workspaceId, fields) => {
      const row = { id: String(rows.size + 1), workspace_id: workspaceId, ...fields, status: "running" };
      rows.set(row.id, row);
      return row;
    },
    beat: async () => {},
    finish: async (row, fields) => Object.assign(row, fields),
    inBackground: async (row) => Object.assign(row, { background: true }),
    find: async (id) => rows.get(String(id)) ?? null,
    stopStale: async () => []
  };
  const meter = { startComputation: async () => ({ blockSeconds: 600, renew: async () => true, settle: async () => true }) };
  // The bots' minutes and homes' days are the database's (internetLimits.integration.js): here each gateway has only its
  // command's own limits.
  const internet = { limits: LIMITS.internet, forGateway: () => null, removeOld: async () => 0 };
  const shell = createShell({
    store, runs, env: process.env, meter, internet, limits: LIMITS, gateway: (options) => startGateway({ ...options, standIns })
  });
  const place = store.placeFor({ homeId: "1", chatId: "2", chatKind: "public", botId: "3" });
  const chatFolder = (await store.prepare(place)).chat;
  await fs.copyFile(caFile, path.join(chatFolder, "ca.pem"));
  const go = (script) => shell.start({ place, workspaceId: "1", botId: "3", chatBotId: "4", userId: "5", why: "test", script, maxSeconds: 60 });
  world = { shell, place, go, seen, webPort, chatFolder, servers: [web, git, tcp, mail], store, runs, meter, internet, standIns };
});

after(async () => {
  if (world) {
    await world.shell.drain();
    await Promise.all(world.servers.map(close));
  }
  await fs.rm(longTmp, { recursive: true, force: true });
});

/** A CONNECT through the command's forwarder, as Python sends it: the gateway's status line, and what came after it. */
const CONNECT = `connect() {
  python3 - "$1" <<'PY'
import socket, sys
s = socket.create_connection(("127.0.0.1", 3128), 5)
s.sendall(("CONNECT %s HTTP/1.1\\r\\nHost: %s\\r\\n\\r\\n" % (sys.argv[1], sys.argv[1])).encode())
s.settimeout(5)
answer = b""
try:
    while chunk := s.recv(4096):
        answer += chunk
except OSError:
    pass
lines = answer.decode("utf-8", "replace").split("\\r\\n")
print("%s => %s | %s" % (sys.argv[1], lines[0], lines[-1].strip()))
PY
}`;

test("a command reaches a public address through its gateway: Python's and Node's own requests, https, and plain TCP", { skip }, async () => {
  const result = await world.go(`
python3 -c 'import urllib.request; print("python:", urllib.request.urlopen("http://files.example.test/hello.txt", timeout=10).read().decode().strip())'
node -e 'fetch("http://files.example.test/hello.txt").then((r) => r.text()).then((t) => console.log("node:", t.trim()))'
NODE_EXTRA_CA_CERTS=/files/chat/ca.pem node -e 'fetch("https://git.example.test/demo.git/HEAD").then((r) => r.text()).then((t) => console.log("node https:", t.trim()))'
${CONNECT}
connect db.example.test:5432
python3 -c 'import socket; socket.create_connection(("1.1.1.1", 80), 3)' 2>&1 | tail -1
`);
  assert.equal(result.status, "done", result.output);
  assert.match(result.output, new RegExp(`^python: ${HELLO}$`, "mu"));
  assert.match(result.output, new RegExp(`^node: ${HELLO}$`, "mu"), "Node's own fetch follows the proxy");
  assert.match(result.output, /^node https: ref: refs\/heads\/main$/mu, "https goes through CONNECT, its certificate checked end to end");
  assert.match(result.output, /^db\.example\.test:5432 => HTTP\/1\.1 200 Connection Established \| plain tcp reached$/mu, "plain TCP to another port of a public address");
  assert.match(result.output, /Network is unreachable/u, "a direct connection, around the gateway, finds no network");
});

test("a private, loopback or cloud metadata address is refused, even with a server listening there", { skip }, async () => {
  const reached = world.seen.web;
  const result = await world.go(`${CONNECT}
connect 127.0.0.1:${world.webPort}
connect 10.0.0.1:80
connect 169.254.169.254:80
connect 100.64.0.1:80
connect [::1]:${world.webPort}
python3 -c 'import urllib.request
try:
    urllib.request.urlopen("http://169.254.169.254/latest/meta-data/", timeout=10)
except Exception as error:
    print("metadata by url:", error.code, error.read().decode())'
`);
  assert.equal(result.status, "done", result.output);
  for (const target of [`127.0.0.1:${world.webPort}`, "10.0.0.1:80", "169.254.169.254:80", "100.64.0.1:80", `[::1]:${world.webPort}`]) {
    const line = result.output.split("\n").find((entry) => entry.startsWith(`${target} =>`));
    assert.match(line ?? "", /=> HTTP\/1\.1 403 Forbidden \| Mercbot's gateway doesn't connect to .*: it's not a public address\.$/u, target);
  }
  assert.match(result.output, /^metadata by url: 403 Mercbot's gateway doesn't connect to 169\.254\.169\.254: it's not a public address\.$/mu);
  assert.equal(world.seen.web, reached, "nothing reached the server listening on this machine");
  // However the program shows a refusal (a CONNECT's 403 is often only "Tunnel connection failed"), the output ends
  // with the gateway's own words for each, once (D-127).
  const refusals = ["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "[::1]"].map((host) => `Mercbot's gateway doesn't connect to ${host}: it's not a public address.`);
  assert.ok(result.output.endsWith(`\n\n${refusals.join("\n")}`), result.output);
});

test("a mail port is refused, even at a public address", { skip }, async () => {
  const result = await world.go(`${CONNECT}
connect mail.example.test:587
connect smtp.example.test:25
connect smtp.example.test:465
python3 -c 'import smtplib
try:
    smtplib.SMTP("smtp.example.test", 25, timeout=5)
except Exception as error:
    print("smtplib:", type(error).__name__)'
`);
  assert.equal(result.status, "done", result.output);
  assert.match(result.output, /^mail\.example\.test:587 => HTTP\/1\.1 403 Forbidden \| Mercbot's gateway doesn't connect to port 587\.$/mu);
  assert.match(result.output, /^smtp\.example\.test:25 => HTTP\/1\.1 403 Forbidden \| Mercbot's gateway doesn't connect to port 25\.$/mu);
  assert.match(result.output, /^smtp\.example\.test:465 => HTTP\/1\.1 403 Forbidden \| Mercbot's gateway doesn't connect to port 465\.$/mu);
  assert.match(result.output, /^smtplib: \w+$/mu, "and mail sent directly finds no network");
  assert.equal(world.seen.mail, 0, "the mail server was never reached");
});

test("git clones a public repository over https through the gateway, and a git@ address gets a plain answer", { skip }, async () => {
  const result = await world.go(`cd /files/chat
GIT_SSL_CAINFO=/files/chat/ca.pem git clone -q https://git.example.test/demo.git && cat demo/README.md && echo "commits=$(git -C demo rev-list --count HEAD)"
git clone -q git@github.com:example/website.git 2>&1 | head -1
`);
  assert.equal(result.status, "done", result.output);
  assert.match(result.output, /^# The stand-in website\ncommits=1$/mu);
  assert.equal(await fs.readFile(path.join(world.chatFolder, "demo", "README.md"), "utf8"), "# The stand-in website\n", "the clone is in the chat's folder");
  assert.match(result.output, /^There's no ssh on this command line: use the repository's https:\/\/ address \(git clone https:\/\/github\.com\/OWNER\/REPO\.git\)\.$/mu);
});

test("an install lasts for its command: the next starts from the same clean toolbox", { skip }, async () => {
  const installed = await world.go("npm install -g --registry http://registry.example.test/ --fetch-retries=0 --no-audit --no-fund --loglevel=error tiny-tool >/dev/null && tiny-tool");
  assert.equal(installed.status, "done", installed.output);
  assert.match(installed.output, /^tiny-tool ran$/mu);
  const next = await world.go("command -v tiny-tool || echo gone");
  assert.equal(next.output.trim(), "gone");
});

// A wheel the command makes itself, so pip installs with nothing fetched: what's tested is what pip says to a bot.
const WHEEL = `python3 - <<'PY'
import zipfile
files = {"tiny_wheel/__init__.py": 'SAID = "tiny-wheel ran"\\n', "tiny_wheel-1.0.dist-info/METADATA": "Metadata-Version: 2.1\\nName: tiny-wheel\\nVersion: 1.0\\n",
         "tiny_wheel-1.0.dist-info/WHEEL": "Wheel-Version: 1.0\\nGenerator: test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n"}
with zipfile.ZipFile("/tmp/tiny_wheel-1.0-py3-none-any.whl", "w") as wheel:
    for name, text in files.items(): wheel.writestr(name, text)
    wheel.writestr("tiny_wheel-1.0.dist-info/RECORD", "".join(f"{name},,\\n" for name in files) + "tiny_wheel-1.0.dist-info/RECORD,,\\n")
PY`;

test("pip installs for its command and doesn't warn the bot about running as root, which a sandbox's command always is", { skip }, async () => {
  const installed = await world.go(`${WHEEL}
pip install --no-index --disable-pip-version-check /tmp/tiny_wheel-1.0-py3-none-any.whl 2>&1 && python3 -c 'import tiny_wheel; print(tiny_wheel.SAID)'`);
  assert.equal(installed.status, "done", installed.output);
  assert.match(installed.output, /^Successfully installed tiny-wheel-1\.0$/mu, installed.output);
  assert.match(installed.output, /^tiny-wheel ran$/mu);
  assert.doesNotMatch(installed.output, /root/iu, "pip's advice for a system's administrator isn't the bot's to follow");
});

test("in the computer's session too: the bot's commands and the person's own shell reach the internet", { skip }, async () => {
  const session = await world.shell.attach({ key: "4", place: world.place, label: "Test's commands" });
  assert.ok(session);
  try {
    const fetch = "python3 -c 'import urllib.request; print(\"session:\", urllib.request.urlopen(\"http://files.example.test/hello.txt\", timeout=10).read().decode().strip())'";
    const result = await world.go(`${fetch}; tmux ls | cut -d: -f1`);
    assert.equal(result.status, "done", result.output);
    assert.match(result.output, new RegExp(`^session: ${HELLO}\nmain$`, "mu"), "a command in the session, where tmux runs");
    // The person's shell is the session's lower pane: what's typed there reaches it too.
    const typed = await world.go(`tmux send-keys -t main.1 ${JSON.stringify(`${fetch.replace("session:", "person:")} > /tmp/person.txt`)} Enter
for _ in $(seq 100); do [ -s /tmp/person.txt ] && break; sleep 0.1; done; cat /tmp/person.txt`);
    assert.match(typed.output, new RegExp(`^person: ${HELLO}$`, "mu"));
  } finally {
    await world.shell.detach("4");
  }
});

test("a command past what one command may receive has its connections ended and its output says why, in its own sandbox and in the session", { skip }, async () => {
  // A shell whose commands may receive 1 MB, the stand-in's file being 3 MB (D-127).
  const tight = createShell({
    store: world.store, runs: world.runs, env: process.env, meter: world.meter, internet: world.internet,
    limits: { ...LIMITS, internet: { ...LIMITS.internet, commandIn: 1024 ** 2 } },
    gateway: (options) => startGateway({ ...options, standIns: world.standIns })
  });
  const go = (script) => tight.start({ place: world.place, workspaceId: "1", botId: "3", chatBotId: "6", userId: "5", why: "test", script, maxSeconds: 60 });
  const fetch = (url) => `python3 -c 'import urllib.request
try:
    print("got", len(urllib.request.urlopen("http://files.example.test/${url}", timeout=10).read()), "bytes")
except Exception as error:
    print("${url} failed:", type(error).__name__, getattr(error, "code", ""))'`;
  const said = "Mercbot's gateway ended this command's internet connections: it received 1 MB, the most one command may receive.";
  try {
    // The download is cut; the command's next request is refused; its output ends with why, once.
    const cut = await go(`${fetch("big.bin")}\n${fetch("hello.txt")}`);
    assert.equal(cut.status, "done", cut.output);
    assert.match(cut.output, /^big\.bin failed: \w+/mu);
    assert.match(cut.output, /^hello\.txt failed: HTTPError 403$/mu);
    assert.ok(cut.output.endsWith(`\n\n${said}`), cut.output);
    // The next command has its own count.
    const next = await go(fetch("hello.txt"));
    assert.equal(next.output.trim(), `got ${HELLO.length + 1} bytes`);
    // In the computer's session, which the bot's commands share with the person's shell, each command counts again:
    // the session's /tmp, which a command in a sandbox of its own doesn't see, shows both ran there.
    assert.ok(await tight.attach({ key: "6", place: world.place, label: "Tight's commands" }));
    const inSession = await go(`echo here > /tmp/in-session; ${fetch("big.bin")}`);
    assert.match(inSession.output, /^big\.bin failed: \w+/mu);
    assert.ok(inSession.output.endsWith(`\n\n${said}`), inSession.output);
    const afterIt = await go(`cat /tmp/in-session; ${fetch("hello.txt")}`);
    assert.equal(afterIt.output.trim(), `here\ngot ${HELLO.length + 1} bytes`, "in the session, and its own count");
  } finally {
    await tight.detach("6");
    await tight.drain();
  }
});
