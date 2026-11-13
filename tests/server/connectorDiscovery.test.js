import assert from "node:assert/strict";
import test from "node:test";
import { publicFetch } from "../../packages/account/src/server/publicAddress.js";
import { createConnector } from "../../packages/integrations/src/server/connector.js";
import { createOAuth } from "../../packages/integrations/src/server/oauth.js";

// What the general connector (D-34) trusts while it finds an https app's sign-in, with a stand-in for the network: the
// app's own addresses only, all on https, and no redirect away from them. Codes, keys and the person's sign-in must never
// go to a server the app's own address doesn't vouch for, nor anything travel over plain http where it could be swapped.
const APP = "https://tasks.example/mcp";
const PLUGIN = Object.freeze({ id: "tasks", name: "Tasks", mcp: { url: APP } });
const ENV = Object.freeze({ APP_PUBLIC_URL: "https://mercbot.example" });

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const redirect = (location) => new Response(null, { status: 307, headers: { location } });

/**
 * The app as it describes itself, with `changes` to its answers by "METHOD address"; every request is recorded. An address
 * it doesn't answer gets `elsewhere`'s answer: a 404, or the real network's through the guard (publicFetch).
 */
function standIn(changes = {}, elsewhere = () => json({ error: "not_found" }, 404)) {
  const asked = [];
  const answers = {
    [`POST ${APP}`]: () => json({ error: "invalid_token" }, 401, { "www-authenticate": 'Bearer resource_metadata="https://tasks.example/.well-known/oauth-protected-resource/mcp"' }),
    "GET https://tasks.example/.well-known/oauth-protected-resource/mcp": () => json({ resource: APP, authorization_servers: ["https://auth.tasks.example"] }),
    "GET https://auth.tasks.example/.well-known/oauth-authorization-server": () => json({
      issuer: "https://auth.tasks.example",
      authorization_endpoint: "https://auth.tasks.example/authorize",
      token_endpoint: "https://auth.tasks.example/token",
      registration_endpoint: "https://auth.tasks.example/register",
      revocation_endpoint: "https://auth.tasks.example/revoke",
      code_challenge_methods_supported: ["S256"]
    }),
    "POST https://auth.tasks.example/register": () => json({ client_id: "client-1", token_endpoint_auth_method: "none" }, 201),
    ...changes
  };
  const fetch = async (url, init = {}) => {
    const key = `${init.method || "GET"} ${url}`;
    asked.push(key);
    assert.notEqual(init.redirect, "follow", `${key} must not follow redirects by itself`);
    return answers[key] ? answers[key]() : elsewhere(url, init);
  };
  const rows = [];
  const connectorApps = {
    queryAll: async () => rows,
    createMany: async (list) => rows.push(...list.map((row, index) => ({ id: index + 1, tools: [], ...row }))),
    patch: async () => {}
  };
  const connector = createConnector({ connectorApps, env: ENV, sealed: (value) => value, opened: (value) => value, fetch });
  return { asked, connector, rows };
}

const refused = (reason) => (error) => {
  assert.equal(error.code, "integrations_connector_discovery_failed");
  assert.equal(error.params.reason, reason);
  return true;
};

test("an https app's own description is followed to its sign-in, which this copy registers with", async () => {
  const { asked, connector, rows } = standIn();
  const provider = await connector.provider(PLUGIN, {});
  assert.deepEqual([provider.server.token_endpoint, provider.resource, provider.client.id], ["https://auth.tasks.example/token", APP, "client-1"]);
  assert.equal(rows.length, 1);
  assert.equal(asked.filter((key) => key.endsWith("/register")).length, 1);
  await connector.provider(PLUGIN, {});
  assert.equal(asked.filter((key) => key.endsWith("/register")).length, 1, "a stored registration is reused");
});

test("nothing in an https app's sign-in may be plain http", async () => {
  const server = (changes) => () => json({
    issuer: "https://auth.tasks.example",
    authorization_endpoint: "https://auth.tasks.example/authorize",
    token_endpoint: "https://auth.tasks.example/token",
    code_challenge_methods_supported: ["S256"],
    ...changes
  });
  for (const field of ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"]) {
    const { connector, asked } = standIn({ "GET https://auth.tasks.example/.well-known/oauth-authorization-server": server({ [field]: `http://auth.tasks.example/${field}` }) });
    await assert.rejects(connector.provider(PLUGIN, {}), refused("its sign-in isn't on https"), field);
    assert.equal(asked.some((key) => key.includes("http://")), false, `${field}: nothing was sent there`);
  }

  const elsewhere = standIn({
    "GET https://tasks.example/.well-known/oauth-protected-resource/mcp": () => json({ resource: APP, authorization_servers: ["http://auth.tasks.example"] })
  });
  await assert.rejects(elsewhere.connector.provider(PLUGIN, {}), refused("its sign-in server isn't on https"));
  assert.equal(elsewhere.asked.some((key) => key.includes("http://")), false);
});

test("a description is read only at https addresses, through no redirect to plain http", async () => {
  // The app's 401 names an http description: it is never read, and the well-known https one is.
  const plain = standIn({
    [`POST ${APP}`]: () => json({}, 401, { "www-authenticate": 'Bearer resource_metadata="http://tasks.example/.well-known/oauth-protected-resource/mcp"' })
  });
  await plain.connector.provider(PLUGIN, {});
  assert.equal(plain.asked.some((key) => key.startsWith("GET http://")), false);

  // A description that redirects to plain http isn't followed there, so the sign-in server is never found.
  const downgraded = standIn({
    "GET https://tasks.example/.well-known/oauth-protected-resource/mcp": () => redirect("http://tasks.example/described"),
    "GET https://tasks.example/.well-known/oauth-protected-resource": () => redirect("http://tasks.example/described")
  });
  await assert.rejects(downgraded.connector.provider(PLUGIN, {}), refused("its sign-in server didn't describe itself"));
  assert.equal(downgraded.asked.some((key) => key.includes("http://")), false);

  // A redirect to another https address of the app's is followed.
  const moved = standIn({
    "GET https://auth.tasks.example/.well-known/oauth-authorization-server": () => redirect("/.well-known/moved"),
    "GET https://auth.tasks.example/.well-known/moved": () => json({
      issuer: "https://auth.tasks.example",
      authorization_endpoint: "https://auth.tasks.example/authorize",
      token_endpoint: "https://auth.tasks.example/token",
      registration_endpoint: "https://auth.tasks.example/register",
      code_challenge_methods_supported: ["S256"]
    })
  });
  assert.equal((await moved.connector.provider(PLUGIN, {})).client.id, "client-1");
});

test("a key goes only to the app's connection point: an answer redirecting it elsewhere is an error", async () => {
  const { connector, asked } = standIn({ [`POST ${APP}`]: () => redirect("https://elsewhere.example/mcp") });
  await assert.rejects(connector.tools(PLUGIN, "the-key"), (error) => {
    assert.equal(error.code, "integrations_connector_failed");
    assert.equal(error.params.status, 307);
    return true;
  });
  assert.deepEqual(asked, [`POST ${APP}`]);
});

test("an app's description never leads a request into the private network: by address, IPv6, name or redirect", async () => {
  const DESCRIPTION = "GET https://tasks.example/.well-known/oauth-protected-resource/mcp";
  const SERVER = "GET https://auth.tasks.example/.well-known/oauth-authorization-server";
  const described = (servers) => () => json({ resource: APP, authorization_servers: servers });
  const server = (changes) => () => json({
    issuer: "https://auth.tasks.example",
    authorization_endpoint: "https://auth.tasks.example/authorize",
    token_endpoint: "https://auth.tasks.example/token",
    code_challenge_methods_supported: ["S256"],
    ...changes
  });
  const cases = [
    ["a sign-in server at a private address", "10.0.0.1", { [DESCRIPTION]: described(["https://10.0.0.1"]) }],
    ["one at this machine's IPv6 address", "::1", { [DESCRIPTION]: described(["https://[::1]"]) }],
    ["a redirect to the cloud's metadata address", "169.254.169.254", { [SERVER]: () => redirect("https://169.254.169.254/latest/meta-data/") }],
    ["a description at that address written as IPv6", "::ffff:a9fe:a9fe", {
      [`POST ${APP}`]: () => json({}, 401, { "www-authenticate": 'Bearer resource_metadata="https://[::ffff:169.254.169.254]/mcp"' })
    }],
    ["registration at a name that leads to 127.0.0.1", "localhost", { [SERVER]: server({ registration_endpoint: "https://localhost/register" }) }]
  ];
  for (const [what, host, changes] of cases) {
    // What the stand-in doesn't answer goes to the guard Mercbot itself uses, which refuses before connecting.
    const { connector, rows } = standIn(changes, publicFetch());
    await assert.rejects(connector.provider(PLUGIN, {}), (error) => {
      refused(`${host} is a private network address`)(error);
      assert.match(error.message, /^Couldn't reach Tasks's sign-in \(.+ is a private network address\)/u);
      return true;
    }, what);
    assert.equal(rows.length, 0, `${what}: nothing was registered`);
  }
});

test("the code exchange, renewals and withdrawals reach the app's sign-in server only at public addresses", async () => {
  const oauthClient = createOAuth({ env: ENV });
  for (const [address, host] of [["https://10.0.0.1/token", "10.0.0.1"], ["https://[::1]/token", "::1"], ["https://localhost/token", "localhost"]]) {
    const { connector } = standIn({
      "GET https://auth.tasks.example/.well-known/oauth-authorization-server": () => json({
        issuer: "https://auth.tasks.example",
        authorization_endpoint: "https://auth.tasks.example/authorize",
        token_endpoint: address,
        registration_endpoint: "https://auth.tasks.example/register",
        revocation_endpoint: address,
        code_challenge_methods_supported: ["S256"]
      })
    }, publicFetch());
    const provider = await connector.provider(PLUGIN, {});
    const refusal = { message: `${host} is a private network address` };
    await assert.rejects(oauthClient.exchange(provider, new URLSearchParams({ code: "code-1", state: "state-1" }), "state-1", "v".repeat(43)), refusal);
    await assert.rejects(oauthClient.refresh(provider, { refresh: "refresh-1" }), refusal);
    await assert.rejects(oauthClient.revoke(provider, "refresh-1"), refusal);
  }
});

test("an MCP call goes through the same guard: a connection point at a private address is never reached", async () => {
  const connector = createConnector({ connectorApps: {}, env: ENV, sealed: (value) => value, opened: (value) => value });
  const plugin = { ...PLUGIN, mcp: { url: "https://169.254.169.254/mcp" } };
  await assert.rejects(connector.tools(plugin, "the-key"), { code: "integrations_connector_unreachable" });
});
