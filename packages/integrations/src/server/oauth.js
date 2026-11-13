import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import * as oauth from "oauth4webapi";

// The providers people sign in to (D-31). A plugin names its provider and the access it needs in
// plugin.json ("oauth": { "provider", "scopes" }); this copy's own registered app for each
// provider comes from Env: <ENV>_CLIENT_ID and <ENV>_CLIENT_SECRET, or <ENV>_TEST_CLIENT_ID and
// <ENV>_TEST_CLIENT_SECRET while this copy's public address is a local one.
export const PROVIDERS = Object.freeze({
  google: Object.freeze({
    name: "Google",
    env: "GOOGLE",
    server: {
      issuer: "https://accounts.google.com",
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token"
    },
    scopes: ["https://www.googleapis.com/auth/userinfo.email"],
    // A long-lived permission, and the consent screen every time so Google always sends one.
    params: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    whoami: { url: "https://www.googleapis.com/oauth2/v3/userinfo", label: (body) => body.email }
  }),
  microsoft: Object.freeze({
    name: "Microsoft",
    env: "MICROSOFT",
    server: {
      issuer: "https://login.microsoftonline.com/common/v2.0",
      authorization_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    },
    scopes: ["offline_access", "User.Read"],
    params: {},
    whoami: { url: "https://graph.microsoft.com/v1.0/me", label: (body) => body.mail || body.userPrincipalName }
  }),
  github: Object.freeze({
    name: "GitHub",
    env: "GITHUB",
    server: {
      issuer: "https://github.com/login/oauth",
      authorization_endpoint: "https://github.com/login/oauth/authorize",
      token_endpoint: "https://github.com/login/oauth/access_token"
    },
    scopes: ["read:user"],
    params: {},
    whoami: { url: "https://api.github.com/user", label: (body) => body.login }
  })
});

// `approval` is a link for an organisation's IT team when its admin must approve Mercbot first.
export class ConnectionError extends AppError {
  /**
   * @param {number} status The HTTP status the route answers with.
   * @param {string} message The sentence the person sees.
   * @param {{ code: string, params?: object, approval?: string }} options The refusal's code, its values, and the approval link.
   */
  constructor(status, message, { code, approval = "", ...options }) {
    super(status, message, { ...options, code });
    this.approval = approval;
  }
}

/**
 * This copy's public address, without a trailing slash.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function publicUrl(env) {
  return String(env.APP_PUBLIC_URL || `http://localhost:${env.PORT}`).replace(/\/+$/u, "");
}

/**
 * A copy reached only on its own machine, such as Preview or a home server: providers can't send
 * a person's browser back to it from elsewhere, so they paste the address they ended on instead.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function isLocal(env) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/u.test(publicUrl(env));
}

/**
 * Where providers send people back; registered with every provider (docs/deployment.md).
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function callbackUrl(env) {
  return `${publicUrl(env)}/api/connections/callback`;
}

/**
 * This copy's own registered app for a provider, or null when it has none.
 * @param {{ env: string }} provider
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function credentials(provider, env) {
  const pick = (prefix) => (env[`${prefix}_CLIENT_ID`] && env[`${prefix}_CLIENT_SECRET`]
    ? { id: env[`${prefix}_CLIENT_ID`], secret: env[`${prefix}_CLIENT_SECRET`] }
    : null);
  return (isLocal(env) && pick(`${provider.env}_TEST`)) || pick(provider.env);
}

/**
 * The provider protocol, through oauth4webapi. `insecure` allows a plain-http stand-in in tests.
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.env
 * @param {boolean} [options.insecure]
 */
export function createOAuth({ env, insecure = false }) {
  const options = insecure ? { [oauth.allowInsecureRequests]: true } : {};

  function client(provider) {
    // An app that hosts its own connection point: the client this copy registered with it (connector.js).
    if (provider.client) {
      const { id, secret, method } = provider.client;
      const auth = !secret || method === "none"
        ? oauth.None()
        : method === "client_secret_post" ? oauth.ClientSecretPost(secret) : oauth.ClientSecretBasic(secret);
      return { client: { client_id: id }, auth };
    }
    const app = credentials(provider, env);
    if (!app) {
      throw new ConnectionError(409, `${provider.name} sign-in isn't set up on this copy of Mercbot.`, {
        code: "integrations_sign_in_unset",
        params: { provider: provider.name }
      });
    }
    return { client: { client_id: app.id }, auth: oauth.ClientSecretPost(app.secret) };
  }

  // The app's address, for an app that hosts its own connection point: its keys are only for it (RFC 8707).
  const resourceOf = (provider) => (provider.resource ? { resource: provider.resource } : {});
  // How an app that hosts its own connection point is reached: its sign-in server only at public addresses (connector.js).
  const optionsFor = (provider) => (provider.fetch ? { ...options, [oauth.customFetch]: provider.fetch } : options);

  async function authorizeUrl(provider, scopes, state, verifier) {
    const { client: details } = client(provider);
    const url = new URL(provider.server.authorization_endpoint);
    const scope = [...new Set([...provider.scopes, ...scopes])].join(" ");
    const params = {
      client_id: details.client_id,
      redirect_uri: callbackUrl(env),
      response_type: "code",
      ...(scope ? { scope } : {}),
      state,
      code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      ...resourceOf(provider),
      ...provider.params
    };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.href;
  }

  const stored = (tokens, previous = {}) => ({
    access: tokens.access_token,
    refresh: tokens.refresh_token || previous.refresh || null,
    expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
    // What the person actually allowed: consent screens let them untick parts of it.
    scope: tokens.scope || previous.scope || null
  });

  async function exchange(provider, params, state, verifier) {
    const { client: details, auth } = client(provider);
    const checked = oauth.validateAuthResponse(provider.server, details, params, state);
    const response = await oauth.authorizationCodeGrantRequest(
      provider.server,
      details,
      auth,
      checked,
      callbackUrl(env),
      verifier,
      { ...optionsFor(provider), additionalParameters: resourceOf(provider) }
    );
    return stored(await oauth.processAuthorizationCodeResponse(provider.server, details, response));
  }

  async function refresh(provider, tokens) {
    const { client: details, auth } = client(provider);
    const response = await oauth.refreshTokenGrantRequest(provider.server, details, auth, tokens.refresh, {
      ...optionsFor(provider),
      additionalParameters: resourceOf(provider)
    });
    return stored(await oauth.processRefreshTokenResponse(provider.server, details, response), tokens);
  }

  /** Who signed in, to label the account (an email address or user name). */
  async function whoami(provider, access) {
    const response = await fetch(provider.whoami.url, { headers: { authorization: `Bearer ${access}`, "user-agent": "Mercbot" } });
    if (!response.ok) return null;
    return String(provider.whoami.label(await response.json()) || "").slice(0, 200) || null;
  }

  /** Withdraws a key at the provider, where it offers that: a courtesy on disconnecting, which may fail. */
  async function revoke(provider, token) {
    if (!provider.server.revocation_endpoint || !token) return;
    const { client: details, auth } = client(provider);
    const response = await oauth.revocationRequest(provider.server, details, auth, token, optionsFor(provider));
    await oauth.processRevocationResponse(response);
  }

  function random() {
    return oauth.generateRandomCodeVerifier();
  }

  return Object.freeze({
    authorizeUrl,
    exchange,
    refresh,
    revoke,
    whoami,
    random
  });
}

/**
 * Whether a token is still good for a minute, so it is used as it is.
 * @param {{ access?: string, expiresAt?: number | null } | null | undefined} tokens
 */
export function fresh(tokens) {
  return Boolean(tokens?.access) && (!tokens.expiresAt || tokens.expiresAt > Date.now() + 60000);
}
