import { ConnectionError } from "./oauth.js";

// Apps connected with API credentials an admin makes in the app (D-93), beside the sign-ins of oauth.js and the general
// connector: plugin.json's `credentials` block names the app's `kind` (one of the kinds below) and the `fields` its form
// asks for. The values are checked with the app before anything is saved, sealed in plugin_accounts.tokens, and the app's
// hourly key is made from them, as a sign-in's is renewed. `home: true` makes the account the home's, added and changed by
// its owners and admins only (D-37), as an organisation's credentials are; who each person is at the app is then
// appPeople.js's.
//
// A kind (sednaCredentials.js): `{ name, normalize(values), org(values), api(values), mint(values), check({ values,
// access, people }), matches({ values, access, people }), person({ values, access, address }), personById({ values,
// access, id }), users({ values, access, words }) }`. `mint` throws a ConnectionError coded CREDENTIALS_REFUSED when the
// app no longer takes the values.

/** The app turned the credentials down: a ConnectionError whose code says so, which signs a renewal's account out. */
export const CREDENTIALS_REFUSED = "integrations_credentials_refused";

/**
 * The values of an app's credentials form, checked against the fields its plugin.json declares. Only declared fields are
 * read; a missing one, unless `optional`, is refused naming it.
 * @param {{ name: string, credentials: { fields: Array<{ id: string, label: string, optional?: boolean, maxLength?: number }> } }} plugin
 * @param {Record<string, unknown> | null | undefined} body
 * @returns {Record<string, string>}
 */
export function credentialValues(plugin, body) {
  const values = {};
  for (const field of plugin.credentials.fields) {
    const value = String(body?.[field.id] ?? "").trim();
    if (!value) {
      if (field.optional) continue;
      throw new ConnectionError(400, `Fill in ${field.label}.`, { code: "integrations_credentials_field_missing", params: { field: field.label } });
    }
    if (value.length > (field.maxLength || 500)) {
      throw new ConnectionError(400, `${field.label} is too long.`, { code: "integrations_credentials_field_long", params: { field: field.label } });
    }
    values[field.id] = value;
  }
  return values;
}

/**
 * The kind an app's credentials are for, or a 409 for an app connected another way.
 * @param {{ name?: string, credentials?: { kind: string } } | null} plugin
 * @param {Record<string, object>} kinds
 */
export function credentialKind(plugin, kinds) {
  const kind = plugin?.credentials && kinds[plugin.credentials.kind];
  if (!kind) {
    const app = plugin?.name || "this app";
    throw new ConnectionError(409, `${app} isn't connected with API credentials.`, { code: "integrations_credentials_unsupported", params: { app } });
  }
  return kind;
}

/**
 * The 409 for an app connected with API credentials, asked to sign in another way: through a provider's consent screen,
 * or through the hub, which never lends them (each copy keeps its own, D-93).
 * @param {{ name: string }} plugin
 */
export function credentialsOnly(plugin) {
  return new ConnectionError(409, `${plugin.name} connects with API credentials: an owner or admin enters them in Connect apps.`, {
    code: "integrations_credentials_only",
    params: { app: plugin.name }
  });
}

/**
 * An account whose credentials are no longer accepted, or were never entered: 409, enter them again in Connect apps.
 * @param {{ name: string }} kind
 */
export function credentialsMissing(kind) {
  return new ConnectionError(409, `${kind.name} isn't connected: an owner or admin of the home enters its API credentials in Connect apps.`, {
    code: "integrations_credentials_missing",
    params: { app: kind.name }
  });
}
