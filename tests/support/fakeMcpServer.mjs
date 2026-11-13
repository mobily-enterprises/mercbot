import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";

// A stand-in for an app that hosts its own connection point (D-34), for the general connector's tests: a remote MCP
// server over Streamable HTTP with its own sign-in, the way Notion, Calendly and Todoist describe theirs.
// - POST /mcp without a key answers 401 and where its sign-in is described (RFC 9728), naming the sign-in server
//   /auth, whose own description is at /.well-known/oauth-authorization-server/auth (RFC 8414, path insertion);
// - /auth/register registers a public client (RFC 7591), /auth/authorize sends the browser back with a code,
//   /auth/token checks PKCE, the client, the return address and the resource (RFC 8707) and rotates refresh keys,
//   /auth/revoke withdraws a sign-in;
// - /mcp starts a session (initialize, then notifications/initialized), lists its tools in two pages and runs them,
//   answering a tool call as server-sent events; DELETE ends the session.
// `settings` changes what it says about itself (`tokenDelay` answers key requests that many milliseconds late); the
// returned controls make keys run out or the grant withdrawn.

const TOOLS = [
  { name: "whoami", title: "Who am I", description: "Who is signed in. Gives their name and email.", annotations: { readOnlyHint: true } },
  {
    name: "list-tasks",
    title: "List tasks",
    description: "Lists the tasks. Optionally only those matching a word.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    annotations: { readOnlyHint: true }
  },
  {
    name: "add-task",
    title: "Add a task",
    description: "Adds a task to the list.",
    inputSchema: { type: "object", properties: { content: { type: "string" }, due: { type: "string" } }, required: ["content"] },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: "delete-task",
    title: "Delete a task",
    description: "Deletes a task for good.",
    inputSchema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
    annotations: { destructiveHint: true }
  },
  {
    name: "add-comment",
    title: "Comment on a task",
    description: "Adds a comment that everyone sharing the task is told about.",
    inputSchema: { type: "object", properties: { content: { type: "string" }, text: { type: "string" } }, required: ["content", "text"] },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  { name: "broken", description: "Always fails, as the app reports it.", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
  { name: "refused", description: "Always refused as a protocol error.", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }
];

const challenge = (verifier) => createHash("sha256").update(verifier).digest("base64url");

/**
 * Starts the stand-in on a port the system picks (or `port`); it stops when the test ends. With `tls` (a key and
 * certificate) it answers over https, as a running copy's sign-in requires outside tests.
 * @param {{ after: (work: () => unknown) => void }} context the test's context
 * @param {{ port?: number, tls?: { key: string, cert: string } }} [options]
 */
export async function startFakeMcp(context, { port = 0, tls = null } = {}) {
  const settings = { registration: true, pkce: true, resource: null, refuseRegistration: false, tokenDelay: 0 };
  const clients = new Map();
  const codes = new Map();
  // Every key handed out: access keys by value, refresh keys by value, each with its grant.
  const access = new Map();
  const refresh = new Map();
  const sessions = new Set();
  const state = { tasks: ["Buy milk", "Call the vet"], registrations: 0, refreshes: 0, revoked: [], ended: 0, calls: [], issued: 0 };
  let base = "";

  const json = (response, status, value, headers = {}) =>
    response.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(value));

  function issue(grant) {
    state.issued += 1;
    const tokens = { access_token: `access-${state.issued}`, refresh_token: `refresh-${state.issued}`, token_type: "Bearer", expires_in: 3600 };
    access.set(tokens.access_token, grant);
    refresh.set(tokens.refresh_token, grant);
    return tokens;
  }

  function token(response, form) {
    const client = clients.get(form.get("client_id"));
    if (!client) return json(response, 401, { error: "invalid_client", error_description: "Unknown client" });
    if (form.get("resource") !== `${base}/mcp`) return json(response, 400, { error: "invalid_target", error_description: "Wrong resource" });
    if (form.get("grant_type") === "authorization_code") {
      const code = codes.get(form.get("code"));
      codes.delete(form.get("code"));
      if (!code || code.clientId !== client.id || code.redirectUri !== form.get("redirect_uri") || code.challenge !== challenge(form.get("code_verifier") || "")) {
        return json(response, 400, { error: "invalid_grant", error_description: "Bad code" });
      }
      return json(response, 200, issue({ clientId: client.id, live: true }));
    }
    if (form.get("grant_type") === "refresh_token") {
      const grant = refresh.get(form.get("refresh_token"));
      // A refresh key works once: the answer rotates it, as Notion's and Todoist's do.
      refresh.delete(form.get("refresh_token"));
      if (!grant?.live || grant.clientId !== client.id) return json(response, 400, { error: "invalid_grant", error_description: "Grant withdrawn" });
      state.refreshes += 1;
      return json(response, 200, issue(grant));
    }
    return json(response, 400, { error: "unsupported_grant_type" });
  }

  function rpc(response, message, session) {
    const answer = (result) => ({ jsonrpc: "2.0", id: message.id, result });
    if (message.method === "tools/list") {
      const page = message.params?.cursor === "2" ? TOOLS.slice(3) : TOOLS.slice(0, 3);
      return json(response, 200, answer({ tools: page, ...(message.params?.cursor ? {} : { nextCursor: "2" }) }), { "mcp-session-id": session });
    }
    if (message.method !== "tools/call") return json(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "No such method" } });
    const { name, arguments: input = {} } = message.params || {};
    state.calls.push({ name, input });
    let result;
    if (name === "whoami") result = { content: [{ type: "text", text: "Signed in as Pat Example (pat@example.com)." }] };
    else if (name === "list-tasks") result = { content: [{ type: "text", text: state.tasks.filter((task) => !input.query || task.includes(input.query)).join("\n") || "No tasks." }] };
    else if (name === "add-task") {
      state.tasks.push(input.content);
      result = { content: [{ type: "text", text: `Added "${input.content}".` }] };
    } else if (name === "delete-task") {
      state.tasks = state.tasks.filter((task) => task !== input.content);
      result = { content: [{ type: "text", text: `Deleted "${input.content}".` }] };
    } else if (name === "add-comment") result = { content: [{ type: "text", text: "Commented." }] };
    else if (name === "broken") result = { content: [{ type: "text", text: "No such project." }], isError: true };
    else return json(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Unknown project id" } });
    // A tool's answer comes as server-sent events, after a progress note, as the transport allows.
    response.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": session });
    response.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } })}\n\n`);
    response.end(`event: message\r\ndata: ${JSON.stringify(answer(result))}\r\n\r\n`);
  }

  function mcp(request, response, body) {
    const key = /^Bearer (.+)$/u.exec(request.headers.authorization || "")?.[1];
    if (!key || !access.get(key)?.live) {
      const challengeHeader = `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="tasks"`;
      return json(response, 401, { error: "invalid_token" }, { "www-authenticate": challengeHeader });
    }
    const session = request.headers["mcp-session-id"];
    if (request.method === "DELETE") {
      if (sessions.delete(session)) state.ended += 1;
      return response.writeHead(200).end();
    }
    const message = JSON.parse(body || "{}");
    if (message.method === "initialize") {
      const id = `session-${sessions.size + state.ended + 1}`;
      sessions.add(id);
      return json(response, 200, {
        jsonrpc: "2.0",
        id: message.id,
        result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Tasks", version: "1" } }
      }, { "mcp-session-id": id });
    }
    if (!sessions.has(session) || request.headers["mcp-protocol-version"] !== "2025-06-18") {
      return json(response, 400, { jsonrpc: "2.0", id: message.id ?? null, error: { code: -32000, message: "No session" } });
    }
    if (message.method === "notifications/initialized") return response.writeHead(202).end();
    return rpc(response, message, session);
  }

  const handler = (request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const url = new URL(request.url, base);
      const form = new URLSearchParams(body);
      if (url.pathname === "/mcp") return mcp(request, response, body);
      if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        return json(response, 200, { resource: settings.resource || `${base}/mcp`, authorization_servers: [`${base}/auth`], scopes_supported: ["tasks"] });
      }
      if (url.pathname === "/.well-known/oauth-authorization-server/auth") {
        return json(response, 200, {
          issuer: `${base}/auth`,
          authorization_endpoint: `${base}/auth/authorize`,
          token_endpoint: `${base}/auth/token`,
          revocation_endpoint: `${base}/auth/revoke`,
          ...(settings.registration ? { registration_endpoint: `${base}/auth/register` } : {}),
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
          code_challenge_methods_supported: settings.pkce ? ["S256"] : ["plain"]
        });
      }
      if (url.pathname === "/auth/register" && request.method === "POST") {
        // Shaped as Calendly refuses a return address that isn't https (its MCP server's documentation).
        if (settings.refuseRegistration) {
          return json(response, 400, { error: "invalid_client_metadata", errors: { redirect_uri: ["must start with https in Production."] } });
        }
        const asked = JSON.parse(body || "{}");
        state.registrations += 1;
        const client = { id: `client-${state.registrations}`, redirectUris: asked.redirect_uris || [] };
        clients.set(client.id, client);
        return json(response, 201, { client_id: client.id, redirect_uris: client.redirectUris, token_endpoint_auth_method: "none" });
      }
      if (url.pathname === "/auth/authorize") {
        const asked = url.searchParams;
        const client = clients.get(asked.get("client_id"));
        if (!client || !client.redirectUris.includes(asked.get("redirect_uri")) || asked.get("code_challenge_method") !== "S256" || asked.get("resource") !== `${base}/mcp`) {
          return json(response, 400, { error: "invalid_request" });
        }
        const code = `code-${codes.size + state.issued + 1}`;
        codes.set(code, { clientId: client.id, redirectUri: asked.get("redirect_uri"), challenge: asked.get("code_challenge") });
        const back = new URL(asked.get("redirect_uri"));
        back.searchParams.set("code", code);
        back.searchParams.set("state", asked.get("state"));
        return response.writeHead(302, { location: back.href }).end();
      }
      if (url.pathname === "/auth/token" && request.method === "POST") return setTimeout(() => token(response, form), settings.tokenDelay);
      if (url.pathname === "/auth/revoke" && request.method === "POST") {
        const grant = refresh.get(form.get("token")) || access.get(form.get("token"));
        if (grant) grant.live = false;
        state.revoked.push(form.get("token"));
        return response.writeHead(200).end();
      }
      return json(response, 404, { error: "not_found" });
    });
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  base = `${tls ? "https" : "http"}://127.0.0.1:${server.address().port}`;

  return {
    base,
    url: `${base}/mcp`,
    settings,
    state,
    /** The browser's visit to the sign-in address: the person agrees, and the app answers with where it sends them back. */
    async consent(signInUrl) {
      const response = await fetch(signInUrl, { redirect: "manual" });
      if (response.status !== 302) throw new Error(`The stand-in refused the sign-in address (${response.status}): ${await response.text()}`);
      return new URL(response.headers.get("location"));
    },
    /** Every access key handed out so far stops working before its time (the app answers 401). */
    expireAccessKeys() {
      for (const [key, grant] of access) access.set(key, { ...grant, live: false });
    },
    /** The person withdrew Mercbot's access on the app's own site: every key of every grant stops working. */
    withdrawAll() {
      for (const grant of [...access.values(), ...refresh.values()]) grant.live = false;
    },
    /** The app forgot every registered client, as when it drops old registrations. */
    forgetClients() {
      clients.clear();
    }
  };
}
