import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import fs from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { githubEnv } from "../../packages/bots/src/server/githubCommands.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { startGateway } from "../../packages/files/src/server/gateway.js";
import { shellAvailable } from "../../packages/files/src/server/gvisor.js";
import { __testables, createShell } from "../../packages/files/src/server/shell.js";

// Each with its input closed: a git that reads its input (a host's wrapper, say) would otherwise wait for it.
const run = (...args) => {
  const running = promisify(execFile)(...args);
  running.child.stdin.end();
  return running;
};
const { LIMITS } = __testables;

// A bot's command signed in to GitHub (D-128), in real gVisor: git clones a private repository and pushes a branch with
// the command's key through git's credential helper, commits as the bot through the copy's GitHub App, the key never shows in
// what the command printed (nor git's base64 form of it) in its answer or its run's record, and it's withdrawn when the
// command ends. github.com here is a stand-in on this machine, git's smart HTTP (git upload-pack and receive-pack) behind a
// test authority's certificate, which the gateway is told to use for that name (its `standIns`, for tests only), so
// nothing reaches GitHub. Runs where gVisor and the toolbox are installed, with git and openssl for the stand-in.
const has = (command) => spawnSync("sh", ["-c", `command -v ${command}`]).status === 0;
const skip = !shellAvailable(process.env)
  ? "gVisor and the toolbox aren't installed (npm run tools:install)"
  : !has("git") || !has("openssl") ? "the stand-in GitHub needs git and openssl" : false;

// A sandbox's gateway socket lives under TMPDIR, as long here as production's (commandInternet.test.js).
const PRODUCTION_TMPDIR = "/var/lib/mercbot-server-work/tmp";
const longTmp = await fs.mkdtemp(path.join(os.tmpdir(), "g".repeat(Math.max(1, PRODUCTION_TMPDIR.length - os.tmpdir().length - 7))));
process.env.TMPDIR = longTmp;

const KEY = `ghs_${randomBytes(18).toString("hex")}`;
// The server's own GitHub App key, as production has one: no command may see it.
process.env.GITHUB_APP_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nstand-in\n-----END PRIVATE KEY-----";
const BASIC = Buffer.from(`x-access-token:${KEY}`).toString("base64");

/** A test authority and a certificate for github.com signed by it, in `dir`. */
async function certificates(dir) {
  const file = (base) => path.join(dir, base);
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];
  await run("openssl", ["req", "-x509", ...ec, "-keyout", file("ca.key"), "-out", file("ca.pem"), "-days", "2", "-subj", "/CN=Mercbot test authority",
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
  await run("openssl", ["req", ...ec, "-keyout", file("leaf.key"), "-out", file("leaf.csr"), "-subj", "/CN=github.com"]);
  await fs.writeFile(file("leaf.ext"), "subjectAltName=DNS:github.com\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n");
  await run("openssl", ["x509", "-req", "-in", file("leaf.csr"), "-CA", file("ca.pem"), "-CAkey", file("ca.key"), "-CAcreateserial",
    "-out", file("leaf.pem"), "-days", "2", "-extfile", file("leaf.ext")]);
  return { caFile: file("ca.pem"), key: await fs.readFile(file("leaf.key")), cert: await fs.readFile(file("leaf.pem")) };
}

/** ann/site, a private repository with one commit on main, in `root`, where the stand-in serves it. */
async function privateRepository(root) {
  const work = path.join(root, "work");
  const bare = path.join(root, "ann", "site.git");
  const git = (...args) => run("git", ["-c", "user.name=Ann", "-c", "user.email=ann@example.test", "-c", "init.defaultBranch=main", ...args]);
  await git("init", "-q", work);
  await fs.writeFile(path.join(work, "README.md"), "# Ann's site\n");
  await git("-C", work, "add", "README.md");
  await git("-C", work, "commit", "-q", "-m", "The first page");
  await fs.mkdir(path.dirname(bare), { recursive: true });
  await git("clone", "-q", "--bare", work, bare);
  return bare;
}

/**
 * One request of git's smart HTTP (protocol version 0), answered by git upload-pack or receive-pack itself with
 * --stateless-rpc, run in the repository, which needs nothing but its path: its status, headers and body.
 */
async function backend(root, request, body) {
  const url = new URL(request.url, "https://github.com");
  const [, name, part] = /^\/(.+?\.git)\/(info\/refs|git-upload-pack|git-receive-pack)$/u.exec(decodeURIComponent(url.pathname)) || [];
  const advertise = part === "info/refs";
  const service = advertise ? url.searchParams.get("service") : part;
  const repository = name ? path.join(root, name) : "";
  if (!["git-upload-pack", "git-receive-pack"].includes(service) || !repository.startsWith(`${root}${path.sep}`)) {
    return { status: 404, headers: {}, body: Buffer.alloc(0) };
  }
  const input = request.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body;
  const child = spawn("git", [service.slice(4), "--stateless-rpc", ...(advertise ? ["--advertise-refs"] : []), "."], { cwd: repository });
  const out = [];
  child.stdout.on("data", (chunk) => out.push(chunk));
  child.stdin.end(advertise ? "" : input);
  await new Promise((resolve, reject) => child.on("error", reject).on("close", resolve));
  // An advertisement starts with the service's own line, then a flush, as git http-backend sends it.
  const line = `# service=${service}\n`;
  const head = advertise ? Buffer.from(`${(line.length + 4).toString(16).padStart(4, "0")}${line}0000`) : Buffer.alloc(0);
  return {
    status: 200,
    headers: { "content-type": `application/x-${service}-${advertise ? "advertisement" : "result"}`, "cache-control": "no-cache" },
    body: Buffer.concat([head, ...out])
  };
}

let world = null;

before(async () => {
  if (skip) return;
  const dir = await fs.mkdtemp(path.join(longTmp, "stand-in-github-"));
  const root = path.join(dir, "repos");
  const [{ caFile, key, cert }, bare] = await Promise.all([certificates(dir), privateRepository(root)]);
  const seen = { refused: 0, signedIn: 0, other: 0 };
  // github.com: nothing without the command's key, in git's Basic form.
  const github = https.createServer({ key, cert }, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const authorization = request.headers.authorization || "";
    if (authorization !== `Basic ${BASIC}`) {
      if (authorization) seen.other += 1;
      seen.refused += 1;
      response.writeHead(401, { "www-authenticate": 'Basic realm="GitHub"' }).end();
      return;
    }
    seen.signedIn += 1;
    const answer = await backend(root, request, Buffer.concat(chunks));
    const { status: _status, ...headers } = answer.headers;
    response.writeHead(answer.status, headers).end(answer.body);
  });
  const port = await new Promise((resolve) => github.listen(0, "127.0.0.1", () => resolve(github.address().port)));
  const standIns = new Map([["github.com:443", { address: "127.0.0.1", port }]]);
  const store = createFileStore({ root: "", fallback: path.join(dir, "files"), ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const recorded = [];
  const rows = new Map();
  const runs = {
    begin: async (workspaceId, fields) => {
      const row = { id: String(rows.size + 1), workspace_id: workspaceId, ...fields, status: "running" };
      rows.set(row.id, row);
      return row;
    },
    beat: async (_row, output) => recorded.push(output),
    finish: async (row, fields) => {
      recorded.push(fields.output);
      return Object.assign(row, fields);
    },
    inBackground: async (row) => Object.assign(row, { background: true }),
    find: async (id) => rows.get(String(id)) ?? null,
    stopStale: async () => []
  };
  const meter = { startComputation: async () => ({ blockSeconds: 600, renew: async () => true, settle: async () => true }) };
  // The bots' minutes and homes' days are the database's (D-127, internetLimits.integration.js); none here.
  const internet = { limits: LIMITS.internet, forGateway: () => null, removeOld: async () => 0 };
  const shell = createShell({ store, runs, env: process.env, meter, internet, limits: LIMITS, gateway: (options) => startGateway({ ...options, standIns }) });
  const place = store.placeFor({ homeId: "1", chatId: "2", chatKind: "public", botId: "3" });
  const chatFolder = (await store.prepare(place)).chat;
  await fs.copyFile(caFile, path.join(chatFolder, "ca.pem"));
  world = { shell, place, bare, seen, recorded, server: github };
});

after(async () => {
  if (world) {
    await world.shell.drain();
    await new Promise((resolve) => world.server.close(() => resolve()));
  }
  await fs.rm(longTmp, { recursive: true, force: true });
});

test("a command signed in to GitHub clones a private repository and pushes a branch as the bot, and its key never shows", { skip }, async () => {
  let withdrawn = 0;
  const secret = { env: githubEnv(KEY, { name: "Ada", login: "my-mercbot[bot]" }), hide: [KEY], ended: async () => { withdrawn += 1; } };
  const result = await world.shell.start({
    place: world.place, workspaceId: "1", botId: "3", chatBotId: "4", userId: "5", why: "Pushing the fix", maxSeconds: 60, secret,
    script: `cd /files/chat
export GIT_SSL_CAINFO=/files/chat/ca.pem
git clone -q https://github.com/ann/site.git && cd site
git checkout -q -b mercbot/fix
echo fixed > FIX.md && git add FIX.md && git commit -q -m "Fix the page"
git push -q origin mercbot/fix 2>&1 && echo pushed
git log -1 --format='by %an <%ae>'
git remote get-url origin
echo "key: $GH_TOKEN"
printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0; echo
env | grep -cE 'PRIVATE KEY|GITHUB_APP' || true
`
  });
  assert.equal(result.status, "done", result.output);
  assert.match(result.output, /^pushed$/mu);
  assert.match(result.output, /^by Ada <my-mercbot\[bot\]@users\.noreply\.github\.com>$/mu, "the commit is the bot's, through the copy's GitHub App");
  assert.match(result.output, /^https:\/\/github\.com\/ann\/site\.git$/mu, "the key is in no remote's address");
  assert.match(result.output, /^key: \*\*\*$/mu, "the key itself is hidden");
  assert.match(result.output, /^\*\*\*$/mu, "and git's form of it");
  assert.match(result.output, /^0$/mu, "the app's private key is nowhere in the command's variables");
  for (const shown of [result.output, ...world.recorded]) {
    assert.equal(shown.includes(KEY), false, "nowhere in what was recorded either");
    assert.equal(shown.includes(BASIC), false);
  }
  // The branch is at GitHub's stand-in, and git asked with the key only after it was refused without it.
  const pushed = await run("git", ["-C", world.bare, "log", "-1", "--format=%s|%an", "mercbot/fix"]);
  assert.equal(pushed.stdout.trim(), "Fix the page|Ada");
  assert.ok(world.seen.signedIn >= 2 && world.seen.other === 0, JSON.stringify(world.seen));
  assert.equal(withdrawn, 1, "the key was withdrawn once the command ended");

  // Without a key, the same repository is out of reach.
  const refused = await world.shell.start({
    place: world.place, workspaceId: "1", botId: "3", chatBotId: "4", userId: "5", why: "Cloning", maxSeconds: 60,
    script: "cd /tmp && GIT_TERMINAL_PROMPT=0 GIT_SSL_CAINFO=/files/chat/ca.pem git clone -q https://github.com/ann/site.git 2>&1 | tail -1"
  });
  assert.match(refused.output, /could not read Username|Authentication failed/u, refused.output);
});
