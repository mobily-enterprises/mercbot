import { CREDENTIALS_REFUSED } from "./credentials.js";
import { ConnectionError } from "./oauth.js";

// Sedna (sedna.com, the shipping teams' shared email) connected with API credentials (D-93): an admin of the Sedna
// organisation makes a client id and secret in Sedna (Settings → API credential management), and Mercbot gets an hourly
// key for them with OAuth 2.0 client credentials at https://<tenant>.sednanetwork.com/platform/oauth/token. The host is
// always <tenant>.sednanetwork.com, the tenant one DNS label: no value entered can point Mercbot anywhere else. A key
// reads the whole organisation, every team's inbox, so who a Mercbot person is in Sedna (their user, found by their
// email address or picked once and confirmed, appPeople.js) decides whose teams their bots read
// (packages/bots/src/server/sednaApi.js).
// API reference: https://developers.sedna.com/llms.txt (Authentication, Company, User).

const TENANT = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const DOMAIN = ".sednanetwork.com";
const API_VERSION = "2019-01-01";
// How many people are looked up at once while credentials are checked: Sedna takes 100 requests a second.
const LOOKUPS_AT_ONCE = 5;
// People matched while credentials are checked; the rest are matched when they first ask.
const PEOPLE_CHECKED = 50;

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

  async function send(url, options, values) {
    try {
      return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new ConnectionError(502, `Couldn't reach ${host(values)}. Check the Sedna address and this server's internet connection.`, {
        code: "integrations_sedna_unreachable",
        params: { host: host(values) }
      });
    }
  }

  /** One read of Sedna's API with a key: its JSON:API body, or a ConnectionError saying what Sedna answered. */
  async function read(values, access, path, params = {}) {
    const url = new URL(`${platform(values)}/${API_VERSION}${path}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    const response = await send(url, { headers: { authorization: `Bearer ${access}`, accept: "application/vnd.api+json, application/json", "user-agent": "Mercbot" } }, values);
    if (response.ok) return response.json().catch(() => ({}));
    if (response.status === 403) {
      throw new ConnectionError(400, `These API credentials may not read ${path.split("/")[1]} in Sedna. Give them the read permissions Connect apps lists.`, {
        code: "integrations_sedna_permission_missing",
        params: { what: path.split("/")[1] }
      });
    }
    if (response.status === 429) {
      throw new ConnectionError(503, "Sedna is busy (too many requests just now). Try again in a minute.", { code: "integrations_sedna_busy" });
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
   * An hourly key for the credentials, by OAuth 2.0 client credentials: `{ access, expiresAt }`. Sedna turning the
   * client id and secret down throws a CredentialsRefused (CREDENTIALS_REFUSED).
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
   * them, a few at a time: Sedna takes 100 requests a second.
   * @param {{ values: object, access: string, people: Array<{ email: string }> }} input
   */
  async function matches({ values, access, people }) {
    const found = [];
    const checked = people.slice(0, PEOPLE_CHECKED);
    for (let at = 0; at < checked.length; at += LOOKUPS_AT_ONCE) {
      found.push(...await Promise.all(checked.slice(at, at + LOOKUPS_AT_ONCE).map((entry) => user(values, access, entry.email))));
    }
    return found;
  }

  /**
   * Credentials about to be saved: the company they belong to (its name labels the account), and each of the home's
   * people matched to their Sedna user by email address. People with no Sedna user are listed: they pick themselves,
   * and their bots read nothing there until an owner or admin confirms it.
   * @param {{ values: object, access: string, people: Array<{ id: string, name: string, email: string }> }} input
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
