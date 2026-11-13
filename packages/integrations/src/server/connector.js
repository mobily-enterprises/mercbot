import { passedOn } from "@jskit-ai/resource-runtime/server";
import { publicFetch } from "@local/account/public-address";
import { ConnectionError, callbackUrl, credentials } from "./oauth.js";

// The general connector (D-34): one way to connect every app that hosts its own connection point for
// AI assistants, a remote MCP server. A plugin says where it is (plugin.json "mcp": { "url" }) and
// everything else comes from the app itself, the way the MCP authorization flow describes:
// - the app answers an unsigned call with 401 and where its sign-in is described (protected resource
//   metadata, RFC 9728), which names its sign-in server (RFC 8414 metadata);
// - this copy registers itself there once (dynamic client registration, RFC 7591) and keeps that
//   registration in connector_apps, as the apps ask: registering again would orphan people's sign-ins.
//   An app without self-registration uses this copy's own registered app from Env (plugin.json "mcp": { "env" });
// - people sign in with PKCE through the same callback, consent screen and account rows as Google's
//   (connections.js), naming the app's address as the resource (RFC 8707);
// - its actions are its MCP tools, listed and called over the Streamable HTTP transport.

const PROTOCOL_VERSION = "2025-06-18";
const DISCOVERY_MS = 15000;
const CALL_MS = 60000;
const TOOL_PAGES = 10;
// How many redirects a description's address may take, each checked like the address itself.
const REDIRECTS = 3;
// Who this copy is, as each conversation with an app starts.
const INITIALIZE = Object.freeze({ protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "Mercbot", version: "1" } });

/** The app refused the key it was sent (401 or 403): connections.js renews it once, or signs the account out. */
export class ConnectorAuthError extends Error {}

const plain = (url) => String(url || "").replace(/\/+$/u, "");

/**
 * Whether an address the app's sign-in names is as safe as the app's own: https for an https app, so nothing between
 * Mercbot and the app can swap its sign-in or read a code or key on the way (a plain http app is a stand-in on this
 * machine, in tests).
 * @param {string} url
 * @param {URL} resource the app's connection point
 */
function safe(url, resource) {
  if (!URL.canParse(String(url || ""))) return false;
  const { protocol } = new URL(url);
  return protocol === "https:" || (protocol === "http:" && resource.protocol === "http:");
}

/** The well-known addresses a sign-in server's description may be at, for an issuer with or without a path. */
function metadataUrls(issuer) {
  const url = new URL(issuer);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/u, "");
  if (!path) return [`${url.origin}/.well-known/oauth-authorization-server`, `${url.origin}/.well-known/openid-configuration`];
  return [
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}/.well-known/openid-configuration${path}`,
    `${url.origin}${path}/.well-known/openid-configuration`
  ];
}

/** One parameter of a WWW-Authenticate challenge, e.g. resource_metadata="https://…". */
function challengeParam(header, name) {
  return new RegExp(`${name}="([^"]*)"`, "u").exec(String(header || ""))?.[1] || "";
}

/** The first email address in a text, or null. */
const firstEmail = (text) => /[^\s"'<>(),;:]+@[^\s"'<>(),;:]+\.[A-Za-z]{2,}/u.exec(String(text || ""))?.[0] || null;

/**
 * What a tool answered, as text for a bot: its text parts, the text of any resources it returned,
 * links by address, and its structured answer when it gave nothing else.
 * @param {{ content?: object[], structuredContent?: unknown }} result
 */
export function resultText(result) {
  const parts = (result?.content || []).map((part) => {
    if (part?.type === "text") return part.text;
    if (part?.type === "resource") return part.resource?.text ?? `(a file: ${part.resource?.uri || "no address"})`;
    if (part?.type === "resource_link") return `${part.name || "A link"}: ${part.uri}`;
    if (part?.type === "image" || part?.type === "audio") return `(${part.type === "image" ? "a picture" : "a sound"} the app sent)`;
    return "";
  }).filter(Boolean);
  if (!parts.length && result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  return parts.join("\n\n");
}

/**
 * The general connector, on connector_apps.
 * @param {object} dependencies
 * @param {object} dependencies.connectorApps the connector_apps handle
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {(value: unknown) => object} dependencies.sealed seals with the vault key
 * @param {(value: object) => any} dependencies.opened
 * @param {typeof fetch} [dependencies.fetch] how apps are reached: publicFetch() (tests: a stand-in, or publicFetch(true))
 */
export function createConnector({ connectorApps, env, sealed, opened, fetch: fetchImpl = publicFetch() }) {
  const unavailable = (plugin, why) =>
    new ConnectionError(502, `Couldn't reach ${plugin.name}'s sign-in (${why}). Try again in a few minutes.`, {
      code: "integrations_connector_discovery_failed",
      params: { app: plugin.name, reason: why }
    });

  /** A request that failed, as no answer (null); a private address the app's sign-in leads to is the reason it can't. */
  const unanswered = (plugin) => (error) => {
    if (/ is a private network address$/u.test(String(error?.message))) throw unavailable(plugin, error.message);
    return null;
  };

  /** The JSON at an address the app's description names, or null; a redirect is followed only to a safe address. */
  async function getJson(plugin, url, resource) {
    let next = url;
    for (let hop = 0; hop <= REDIRECTS && safe(next, resource); hop += 1) {
      const response = await fetchImpl(next, {
        headers: { accept: "application/json", "user-agent": "Mercbot" },
        redirect: "manual",
        signal: AbortSignal.timeout(DISCOVERY_MS)
      }).catch(unanswered(plugin));
      const location = response && response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (!location) return response?.ok ? response.json().catch(() => null) : null;
      await response.body?.cancel().catch(() => {});
      next = URL.canParse(location, next) ? new URL(location, next).href : "";
    }
    return null;
  }

  /**
   * How the app is signed in to, from what it says about itself: its connection point asked without a
   * key answers 401 and where its description is; failing that, the well-known addresses; an app with
   * no description at all is its own sign-in server (the 2025-03-26 rules).
   */
  async function discover(plugin) {
    const resource = new URL(plugin.mcp.url);
    const probe = await fetchImpl(resource.href, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json", "user-agent": "Mercbot" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: INITIALIZE }),
      redirect: "manual",
      signal: AbortSignal.timeout(DISCOVERY_MS)
    }).catch(unanswered(plugin));
    if (!probe) throw unavailable(plugin, "no answer");
    const challenge = probe.headers.get("www-authenticate") || "";
    await probe.body?.cancel().catch(() => {});
    const path = resource.pathname === "/" ? "" : resource.pathname.replace(/\/+$/u, "");
    const candidates = [
      challengeParam(challenge, "resource_metadata"),
      `${resource.origin}/.well-known/oauth-protected-resource${path}`,
      `${resource.origin}/.well-known/oauth-protected-resource`
    ].filter(Boolean);
    let described = null;
    for (const url of new Set(candidates)) {
      described = await getJson(plugin, url, resource);
      if (described?.resource) break;
      described = null;
    }
    // The description must be of this very address, or another app could be passing itself off as it.
    if (described && plain(described.resource) !== plain(resource.href)) throw unavailable(plugin, "it described another address");
    const issuer = described?.authorization_servers?.[0] || resource.origin;
    if (!safe(issuer, resource)) throw unavailable(plugin, "its sign-in server isn't on https");
    let server = null;
    for (const url of metadataUrls(issuer)) {
      server = await getJson(plugin, url, resource);
      if (server?.issuer) break;
      server = null;
    }
    if (!server || plain(server.issuer) !== plain(issuer)) throw unavailable(plugin, "its sign-in server didn't describe itself");
    if (!server.authorization_endpoint || !server.token_endpoint) throw unavailable(plugin, "its sign-in server has no sign-in address");
    // Codes, keys and the person's sign-in go only to https addresses the sign-in server itself names.
    const endpoints = ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"].filter((name) => server[name]);
    if (endpoints.some((name) => !safe(server[name], resource))) throw unavailable(plugin, "its sign-in isn't on https");
    // People's sign-ins are protected with PKCE (S256), which the MCP rules require the server to offer.
    if (!server.code_challenge_methods_supported?.includes("S256")) throw unavailable(plugin, "its sign-in doesn't offer PKCE");
    const asked = challengeParam(challenge, "scope");
    const scopes = plugin.mcp.scopes || (asked ? asked.split(" ") : described?.scopes_supported || []);
    return {
      // The connection point this was found from: a new one in the catalogue (the app moved) is found again.
      url: plugin.mcp.url,
      issuer: server.issuer,
      authorization_endpoint: server.authorization_endpoint,
      token_endpoint: server.token_endpoint,
      ...(server.registration_endpoint ? { registration_endpoint: server.registration_endpoint } : {}),
      ...(server.revocation_endpoint ? { revocation_endpoint: server.revocation_endpoint } : {}),
      ...(server.authorization_response_iss_parameter_supported ? { authorization_response_iss_parameter_supported: true } : {}),
      code_challenge_methods_supported: server.code_challenge_methods_supported,
      resource: described?.resource || null,
      scopes
    };
  }

  /** This copy registers itself with the app (RFC 7591), as a public client using PKCE; or its own registered app from Env. */
  async function register(plugin, server) {
    if (!server.registration_endpoint) {
      const app = plugin.mcp.env ? credentials({ env: plugin.mcp.env }, env) : null;
      if (app) return { id: app.id, secret: app.secret, method: "client_secret_post" };
      throw new ConnectionError(409, `${plugin.name} doesn't let Mercbot register itself, and no ${plugin.name} app is set up on this copy.`, {
        code: "integrations_connector_unregistered",
        params: { app: plugin.name }
      });
    }
    const response = await fetchImpl(server.registration_endpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": "Mercbot" },
      body: JSON.stringify({
        client_name: "Mercbot",
        redirect_uris: [callbackUrl(env)],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none"
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(DISCOVERY_MS)
    }).catch(unanswered(plugin));
    const body = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok || !body.client_id) {
      // Why, in the app's words: its description, or each field it refused, as Calendly answers
      // (`errors: { redirect_uri: ["must start with https in Production."] }`).
      const refused = body.errors && typeof body.errors === "object" ? Object.entries(body.errors) : [];
      const fields = refused.map(([field, reasons]) => `${field} ${[].concat(reasons).join(", ")}`).join("; ");
      const said = [body.error, body.error_description || fields].filter(Boolean).join(": ").slice(0, 200).replace(/[.\s]+$/u, "")
        || `status ${response?.status ?? "none"}`;
      console.error(`Registering with ${plugin.name} failed: ${said}`);
      throw new ConnectionError(502, `${plugin.name} didn't let Mercbot register for sign-in (${said}).`, {
        code: "integrations_connector_registration_refused",
        params: { app: plugin.name, reason: said }
      });
    }
    const method = body.token_endpoint_auth_method || (body.client_secret ? "client_secret_basic" : "none");
    return { id: body.client_id, secret: body.client_secret || null, method };
  }

  async function storedRow(pluginId, options) {
    const [row] = await connectorApps.queryAll({ filters: { pluginId }, fields: ["redirectUri", "server", "client", "tools"] }, passedOn(options));
    return row || null;
  }

  /**
   * The app's sign-in, as a provider for createOAuth (its sign-in server, the client this copy registered and the
   * resource): from connector_apps, or found and registered now (any server may start a sign-in another
   * finishes, and one may register again while another still runs, so each reads the table: D-15). A registration for
   * another return address (this copy moved) or found at another connection point (the app moved) is replaced; of two
   * servers registering at once, the first one stored wins.
   * @param {{ id: string, name: string, mcp: { url: string, env?: string, scopes?: string[] } }} plugin
   * @param {object} options
   */
  async function provider(plugin, options) {
    const redirectUri = callbackUrl(env);
    let row = await storedRow(plugin.id, options);
    if (!row || row.redirectUri !== redirectUri || row.server?.url !== plugin.mcp.url) {
      const server = await discover(plugin);
      const fields = { redirectUri, server, client: sealed(await register(plugin, server)), updatedAt: new Date().toISOString() };
      if (row) {
        await connectorApps.patch(String(row.id), fields, { ...passedOn(options), returning: "none", missing: "skip" });
      } else {
        await connectorApps.createMany([{ pluginId: plugin.id, ...fields }], {
          ...passedOn(options),
          onConflict: { keys: ["pluginId"], action: "ignore" }
        });
      }
      row = await storedRow(plugin.id, options);
    }
    return {
      name: plugin.name,
      server: row.server,
      client: opened(row.client),
      resource: row.server.resource,
      scopes: plugin.mcp.scopes || row.server.scopes || [],
      params: {},
      // The code exchange, renewals and withdrawals reach its sign-in server as discovery did: public addresses only (oauth.js).
      fetch: fetchImpl
    };
  }

  /** Forgets the app's registration, which it no longer knows (invalid_client): the next sign-in registers again. */
  async function forget(pluginId, options) {
    await connectorApps.deleteWhere({ pluginId }, passedOn(options));
  }

  /** The JSON-RPC answer with this id, from a stream of server-sent events. */
  async function fromEvents(body, id) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/gu, "\n");
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /u, "")).join("\n");
          let message = null;
          try {
            message = data ? JSON.parse(data) : null;
          } catch {
            message = null;
          }
          if (message?.id === id && ("result" in message || "error" in message)) return message;
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  /**
   * One conversation with the app's connection point over Streamable HTTP: it starts (initialize),
   * runs `work` with its `request`, then ends. Every conversation is short and starts afresh, so any
   * server may hold the next one (D-15).
   */
  async function conversation(plugin, token, work, { timeout = CALL_MS } = {}) {
    const state = { session: "", version: "" };
    let nextId = 0;

    async function post(message) {
      const headers = {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "user-agent": "Mercbot",
        ...(state.session ? { "mcp-session-id": state.session } : {}),
        ...(state.version ? { "mcp-protocol-version": state.version } : {})
      };
      // The key goes only to the connection point itself: an answer sending it elsewhere is an error.
      const response = await fetchImpl(plugin.mcp.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", ...message }),
        redirect: "manual",
        signal: AbortSignal.timeout(timeout)
      }).catch((error) => {
        const late = error?.name === "TimeoutError";
        throw new ConnectionError(502, late ? `${plugin.name} took too long to answer.` : `Couldn't reach ${plugin.name}. Try again in a few minutes.`, {
          code: late ? "integrations_connector_slow" : "integrations_connector_unreachable",
          params: { app: plugin.name }
        });
      });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel().catch(() => {});
        throw new ConnectorAuthError(`${plugin.name} refused the key (${response.status}).`);
      }
      if (!response.ok) {
        const said = (await response.text().catch(() => "")).replace(/\s+/gu, " ").slice(0, 200);
        throw new ConnectionError(502, `${plugin.name} answered with an error (status ${response.status}${said ? `: ${said}` : ""}).`, {
          code: "integrations_connector_failed",
          params: { app: plugin.name, status: response.status }
        });
      }
      state.session = response.headers.get("mcp-session-id") || state.session;
      if (message.id === undefined) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      const type = response.headers.get("content-type") || "";
      const answer = type.includes("text/event-stream")
        ? await fromEvents(response.body, message.id)
        : [].concat(await response.json().catch(() => null)).find((entry) => entry?.id === message.id);
      if (!answer) {
        throw new ConnectionError(502, `${plugin.name} didn't answer.`, { code: "integrations_connector_silent", params: { app: plugin.name } });
      }
      if (answer.error) {
        const said = String(answer.error.message || "an error").slice(0, 300);
        throw new ConnectionError(502, `${plugin.name} refused that: ${said}`, {
          code: "integrations_connector_refused",
          params: { app: plugin.name, reason: said }
        });
      }
      return answer.result;
    }

    const request = (method, params) => post({ id: ++nextId, method, params });
    const started = await request("initialize", INITIALIZE);
    state.version = started?.protocolVersion || PROTOCOL_VERSION;
    await post({ method: "notifications/initialized" });
    try {
      return await work(request);
    } finally {
      if (state.session) {
        // Ending the session is a courtesy the app may not offer; nothing waits on it.
        fetchImpl(plugin.mcp.url, {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}`, "mcp-session-id": state.session, "mcp-protocol-version": state.version },
          redirect: "manual",
          signal: AbortSignal.timeout(5000)
        }).then((response) => response.body?.cancel(), () => {});
      }
    }
  }

  /** Every tool the app lists, as `{ name, title, description, inputSchema, annotations }`. */
  async function listTools(request) {
    const tools = [];
    let cursor;
    for (let page = 0; page < TOOL_PAGES; page += 1) {
      const result = await request("tools/list", cursor ? { cursor } : {});
      for (const tool of result?.tools || []) {
        if (!tool?.name) continue;
        tools.push({
          name: String(tool.name),
          title: tool.title || tool.annotations?.title || "",
          description: String(tool.description || ""),
          inputSchema: tool.inputSchema || { type: "object" },
          annotations: tool.annotations || {}
        });
      }
      cursor = result?.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  /** The app's actions, for an account's key. */
  function tools(plugin, token) {
    return conversation(plugin, token, listTools);
  }

  /** One action, with its input: what the app answered (`content`, `isError`). */
  function call(plugin, token, name, input) {
    return conversation(plugin, token, (request) => request("tools/call", { name, arguments: input || {} }));
  }

  /**
   * Right after a sign-in: the app's actions, and who signed in, to label the account. An app names a
   * tool that says who the person is (plugin.json "mcp": { "whoami" }), whose answer's first email
   * address, or else its name, is the label.
   */
  async function signedIn(plugin, token) {
    return conversation(plugin, token, async (request) => {
      const listed = await listTools(request);
      let label = null;
      if (plugin.mcp.whoami && listed.some((tool) => tool.name === plugin.mcp.whoami)) {
        const text = resultText(await request("tools/call", { name: plugin.mcp.whoami, arguments: {} }).catch(() => null));
        label = firstEmail(text);
      }
      return { tools: listed, label: label ? label.slice(0, 200) : null };
    }, { timeout: DISCOVERY_MS });
  }

  /** The app's actions as the switches on its page show them, stored when they change. */
  async function storeTools(pluginId, listed, options) {
    const shown = listed.map((tool) => ({
      id: tool.name,
      name: tool.title || tool.name,
      reads: tool.annotations?.readOnlyHint === true
    }));
    const row = await storedRow(pluginId, options);
    if (!row || JSON.stringify(row.tools || []) === JSON.stringify(shown)) return;
    await connectorApps.patch(String(row.id), { tools: shown, updatedAt: new Date().toISOString() }, { ...passedOn(options), returning: "none", missing: "skip" });
  }

  /** Every connector app's actions as last stored, by app: `{ id, name, reads }`. */
  async function storedTools(options) {
    const rows = await connectorApps.queryAll({ fields: ["pluginId", "tools"] }, passedOn(options));
    return new Map(rows.map((row) => [row.pluginId, row.tools || []]));
  }

  return Object.freeze({
    provider,
    forget,
    tools,
    call,
    signedIn,
    storeTools,
    storedTools
  });
}
