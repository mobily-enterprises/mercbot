import { CREDENTIALS_REFUSED } from "./credentials.js";
import { ConnectionError } from "./oauth.js";

// Sedna (sedna.com, the shipping teams' shared email) connected with API credentials (D-93): an admin of the Sedna
// organisation makes a client id and secret in Sedna (Settings → API credential management), and Mercbot gets an hourly
// key for them with OAuth 2.0 client credentials at https://<tenant>.sednanetwork.com/platform/oauth/token, or, when the
// token endpoint turns them down, uses them as Sedna's docs also allow: as a username and password (Basic auth, D-94),
// the way another program may already reach the organisation's API. The host is
// always <tenant>.sednanetwork.com, the tenant one DNS label: no value entered can point Mercbot anywhere else. A key
// may read the whole organisation, every team's inbox (Sedna's docs don't say a credential is limited to its maker's
// teams), so who a Mercbot person is in Sedna (their user, found by their
// email address or picked once and confirmed, appPeople.js) decides whose teams their bots read
// (packages/bots/src/server/sednaApi.js).
// API reference: https://developers.sedna.com/llms.txt (Authentication, Company, User).

const TENANT = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const DOMAIN = ".sednanetwork.com";
const API_VERSION = "2019-01-01";
// People matched while credentials are checked; the rest are matched when they first ask.
const PEOPLE_CHECKED = 50;
// The organisation's users are read this many a request (Sedna's own default) to match the home's people at once.
const USERS_PAGE = 100;
// Credentials Sedna takes only as Basic auth are checked with it again this often, as a key would be made again.
const BASIC_RECHECK_S = 3600;
// The permission (Sedna's name on its API Credential Management page) each read made at Connect needs.
const PERMISSION = { company: "COMPANY_READ", user: "USER_READ and TEAM_READ" };

/**
 * The Authorization header for a key: one from Sedna's token endpoint is a bearer token; credentials Sedna takes as a
 * username and password are kept as their whole "Basic …" header (mint).
 * @param {string} access
 */
const authorization = (access) => (String(access).startsWith("Basic ") ? String(access) : `Bearer ${access}`);

/**
 * The tenant, the X of X.sednanetwork.com: what the person typed, or their Sedna address pasted whole.
 * @param {unknown} typed
 */
export function sednaTenant(typed) {
  const text = String(typed ?? "").trim().toLowerCase().replace(/^https?:\/\//u, "").replace(/[/?#].*$/u, "");
  const tenant = text.endsWith(DOMAIN) ? text.slice(0, -DOMAIN.length) : text;
  if (!TENANT.test(tenant)) {
    throw new ConnectionError(400, "Give your Sedna address's first part: the X in X.sednanetwork.com, letters, digits and dashes only.", {
      code: "integrations_sedna_tenant_invalid"
    });
  }
  return tenant;
}

/**
 * Sedna's kind of credentials (credentials.js). `standIn` (tests only, IntegrationsFeature) replaces Sedna's own
 * address with a local stand-in's, `<standIn>/<tenant>/platform`; it is never set in staging or production.
 * @param {{ standIn?: string, fetch?: typeof fetch }} [options]
 */
export function createSednaCredentials({ standIn = "", fetch: fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  const platform = (values) => {
    const tenant = sednaTenant(values.tenant);
    return standIn ? `${standIn.replace(/\/+$/u, "")}/${tenant}/platform` : `https://${tenant}${DOMAIN}/platform`;
  };
  const host = (values) => `${sednaTenant(values.tenant)}${DOMAIN}`;

  /** A request to Sedna: through the account's own way to it (`via`, in its Request pace, D-96), or for a key, directly. */
  async function send(url, options, values, via = fetchImpl) {
    try {
      return await via(url, { ...options, signal: AbortSignal.timeout(15000) });
    } catch (error) {
      if (error?.code === "integrations_app_busy") throw error;
      throw new ConnectionError(502, `Couldn't reach ${host(values)}. Check the Sedna address and this server's internet connection.`, {
        code: "integrations_sedna_unreachable",
        params: { host: host(values) }
      });
    }
  }

  /**
   * One read of Sedna's API with the account's key, through its own way to Sedna (in its Request pace, D-96): its JSON:API
   * body, or a ConnectionError saying what Sedna answered. A busy Sedna is integrations' AppBusyError.
   * @param {object} values
   * @param {{ token: string, fetch: typeof fetch }} access
   * @param {string} path
   * @param {Record<string, string | number>} [params]
   */
  async function read(values, access, path, params = {}) {
    const url = new URL(`${platform(values)}/${API_VERSION}${path}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    const headers = { authorization: authorization(access.token), accept: "application/vnd.api+json, application/json", "user-agent": "Mercbot" };
    const response = await send(url, { headers }, values, access.fetch);
    if (response.ok) return response.json().catch(() => ({}));
    if (response.status === 403) {
      const what = path.split("/")[1];
      throw new ConnectionError(400, `These API credentials may not read ${what} in Sedna: give them ${PERMISSION[what]} (Connect apps lists every permission bots use).`, {
        code: "integrations_sedna_permission_missing",
        params: { what, permission: PERMISSION[what] }
      });
    }
    throw new ConnectionError(502, `Sedna answered ${response.status} to ${path}.`, { code: "integrations_sedna_failed", params: { status: response.status } });
  }

  function normalize(values) {
    return { ...values, tenant: sednaTenant(values.tenant) };
  }

  /** The organisation the credentials are for, its tenant: who people are in it holds only there. */
  function org(values) {
    return sednaTenant(values.tenant);
  }

  /** The address of the organisation's API for its bots: https://<tenant>.sednanetwork.com/platform/2019-01-01. */
  function api(values) {
    return `${platform(values)}/${API_VERSION}`;
  }

  /**
   * An hourly key for the credentials, by OAuth 2.0 client credentials: `{ access, expiresAt }`. When the token endpoint
   * turns the client id and secret down, they're tried once as Basic auth on the organisation's own API, which Sedna's
   * docs allow with the same credentials; taken that way, `access` is the whole "Basic …" header. A 403 there is Sedna
   * taking them without COMPANY_READ, which check() then names. Sedna turning them down both ways throws a
   * CredentialsRefused (CREDENTIALS_REFUSED).
   */
  async function mint(values) {
    const form = new URLSearchParams({ grant_type: "client_credentials", client_id: values.clientId, client_secret: values.clientSecret });
    const response = await send(`${platform(values)}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": "Mercbot" },
      body: form
    }, values);
    const body = await response.json().catch(() => null);
    const access = body?.access_token || body?.accessToken;
    if (response.ok && access) {
      const seconds = Number(body.expires_in ?? body.expiresIn) || 3600;
      return { access: String(access), expiresAt: Date.now() + seconds * 1000 };
    }
    if ([400, 401, 403].includes(response.status)) {
      const basic = `Basic ${Buffer.from(`${values.clientId}:${values.clientSecret}`).toString("base64")}`;
      const tried = await send(`${platform(values)}/${API_VERSION}/company/me`, {
        headers: { authorization: basic, accept: "application/vnd.api+json, application/json", "user-agent": "Mercbot" }
      }, values);
      if (tried.ok || tried.status === 403) return { access: basic, expiresAt: Date.now() + BASIC_RECHECK_S * 1000 };
      throw new ConnectionError(400, `Sedna didn't accept that client ID and secret for ${host(values)}. Check them in Sedna's API credential management.`, {
        code: CREDENTIALS_REFUSED,
        params: { host: host(values) }
      });
    }
    if (response.status === 404 || (response.ok && !access)) {
      throw new ConnectionError(400, `No Sedna organisation answers at ${host(values)}. Check the Sedna address.`, {
        code: "integrations_sedna_tenant_unknown",
        params: { host: host(values) }
      });
    }
    throw new ConnectionError(502, `Sedna didn't give a key (it answered ${response.status}). Try again in a few minutes.`, {
      code: "integrations_sedna_token_failed",
      params: { status: response.status }
    });
  }

  /** A Sedna user as Mercbot shows one: `{ id, name, email, emails }`, `emails` every address it has, lower case. */
  function asUser(entry) {
    const attributes = entry?.attributes || {};
    const emails = [...new Set([attributes.individualEmail, attributes.ssoEmail].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
    const name = [attributes.firstName, attributes.lastName].filter(Boolean).join(" ") || attributes.username || emails[0] || String(entry?.id);
    return { id: String(entry?.id), name: String(name).slice(0, 200), email: emails[0] || "", emails };
  }

  /**
   * The organisation's Sedna user with this email address (a person's sign-in one, never anyone else's, and not
   * archived), `{ id, name, email, emails }`, or null: exactly one must match.
   */
  async function user(values, access, address) {
    const email = String(address || "").trim().toLowerCase();
    if (!email.includes("@")) return null;
    const matching = (body) => (body?.data || [])
      .filter((entry) => !entry?.attributes?.archived)
      .map(asUser)
      .filter((found) => found.emails.includes(email));
    let found = matching(await read(values, access, "/user", { "filter[user.search]": email, "page[limit]": 20 }));
    if (!found.length) found = matching(await read(values, access, "/user", { "filter[user.individualEmail]": email, "page[limit]": 20 }));
    return found.length === 1 ? found[0] : null;
  }

  /** A user's teams, `[{ id, name }]`: the only inboxes their bots read. */
  async function teamsOf(values, access, id) {
    const body = await read(values, access, `/user/${encodeURIComponent(id)}/team`);
    return (body?.data || []).map((team) => ({ id: String(team.id), name: String(team.attributes?.name || team.id) }));
  }

  /**
   * Who `address` is in Sedna, with the teams they belong to, `{ id, name, email, emails, teams: [{ id, name }] }`, or null
   * when the organisation has no such user.
   */
  async function person({ values, access, address }) {
    const found = await user(values, access, address);
    return found ? { ...found, teams: await teamsOf(values, access, found.id) } : null;
  }

  /** The Sedna user picked and confirmed for a person (appPeople.js), with their teams; null once archived or gone. */
  async function personById({ values, access, id }) {
    if (!/^\d{1,20}$/u.test(String(id))) return null;
    const body = await read(values, access, `/user/${id}`).catch((error) => {
      if (error?.code === "integrations_sedna_failed" && error.params?.status === 404) return null;
      throw error;
    });
    if (!body?.data || body.data.attributes?.archived) return null;
    const found = asUser(body.data);
    return { ...found, teams: await teamsOf(values, access, found.id) };
  }

  /** The organisation's users whose name or address holds `words`, not archived, for a person picking their own. */
  async function users({ values, access, words }) {
    const text = String(words || "").trim().slice(0, 100);
    if (text.length < 2) return [];
    const body = await read(values, access, "/user", { "filter[user.search]": text, "page[limit]": 20 });
    return (body?.data || []).filter((entry) => !entry?.attributes?.archived).map(asUser);
  }

  /**
   * The Sedna user each of `people` is by their email address, in order (null for none), for the first PEOPLE_CHECKED of
   * them; exactly one user that isn't archived must have the address, as for `user`. Whichever costs Sedna fewer requests
   * is used: reading all the organisation's users, a hundred a request, when they fill no more pages than there are
   * people to match; else looking each person up, one or two requests each.
   * @param {{ values: object, access: { token: string, fetch: typeof fetch }, people: Array<{ email: string }> }} input
   */
  async function matches({ values, access, people }) {
    const checked = people.slice(0, PEOPLE_CHECKED);
    if (!checked.length) return [];
    const byEmail = new Map();
    for (let page = 0; ; page += 1) {
      const body = await read(values, access, "/user", { "page[limit]": USERS_PAGE, "page[offset]": page * USERS_PAGE });
      const listed = body?.data || [];
      for (const found of listed.filter((entry) => !entry?.attributes?.archived).map(asUser)) {
        for (const email of found.emails) byEmail.set(email, byEmail.has(email) ? null : found);
      }
      const total = Number(body?.meta?.total);
      const pages = Number.isFinite(total) ? Math.ceil(total / USERS_PAGE) : Infinity;
      if (listed.length < USERS_PAGE || page + 1 >= pages) return checked.map((entry) => byEmail.get(String(entry.email || "").trim().toLowerCase()) || null);
      if (pages > checked.length) break;
    }
    const found = [];
    for (const entry of checked) found.push(await user(values, access, entry.email));
    return found;
  }

  /**
   * Credentials about to be saved: the company they belong to (its name labels the account), and each of the home's
   * people matched to their Sedna user by email address. People with no Sedna user are listed: they pick themselves,
   * and their bots read nothing there until an owner or admin confirms it.
   * @param {{ values: object, access: { token: string, fetch: typeof fetch }, people: Array<{ id: string, name: string, email: string }> }} input
   */
  async function check({ values, access, people }) {
    const company = await read(values, access, "/company/me");
    const label = String(company?.data?.attributes?.name || host(values)).slice(0, 200);
    const found = await matches({ values, access, people });
    const matched = [];
    const unmatched = [];
    found.forEach((match, index) => {
      const entry = people[index];
      if (match) matched.push({ id: entry.id, name: entry.name, sednaName: match.name });
      else unmatched.push({ id: entry.id, name: entry.name });
    });
    return { label, matched, unmatched, more: people.length - found.length };
  }

  return Object.freeze({
    name: "Sedna",
    normalize,
    org,
    api,
    mint,
    check,
    matches,
    person,
    personById,
    users
  });
}
