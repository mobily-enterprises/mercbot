import { computed, ref } from "vue";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { roleCatalog } from "../../../config/roles.js";
import { currentHome } from "./homeApi.js";

// The person's homes (D-36), from JSKIT's workspace routes (JSON:API). Shared by the home's
// root page, which needs them to find the right home, and the sidebar's home switcher.
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });
const JSON_API = { "content-type": "application/vnd.api+json", accept: "application/vnd.api+json" };
const read = (url) => client.request(url, { headers: { accept: JSON_API.accept } });

// "Owner", "Admin" or "Member", as config/roles.js names them.
export const roleLabel = (roleSid) => roleCatalog.roles[roleSid]?.label || roleCatalog.roles.member.label;

const toHome = (entry) => ({
  id: String(entry.id),
  slug: entry.attributes?.slug || "",
  name: entry.attributes?.name || "",
  role: entry.attributes?.roleSid || "member"
});

// readable-check: allow module-state - shared resource: the home's root page and the sidebar's switcher show one list of the person's homes
const homes = ref(null);
// readable-check: allow module-state - shared resource: every component that asks for the homes shares the one request in flight
let loading = null;
// Counts changes to a home's people or invitations heard from the server, so open lists refresh.
// readable-check: allow module-state - shared resource: the server's news arrives in the shell and refreshes lists in other components
export const homeChanges = ref(0);

export function useHomes() {
  async function load({ fresh = false } = {}) {
    if (homes.value && !fresh) return homes.value;
    loading ||= read("/api/workspaces")
      .then((result) => { homes.value = (result?.data || []).map(toHome); return homes.value; })
      .finally(() => { loading = null; });
    return loading;
  }

  async function create(name) {
    const result = await client.request("/api/workspaces", {
      method: "POST",
      headers: JSON_API,
      body: { data: { type: "workspaces", attributes: { name } } }
    });
    const home = toHome(result.data);
    await load({ fresh: true });
    return home;
  }

  // The home the page is in, and whether this person may manage its people and settings.
  const current = computed(() => (homes.value || []).find((home) => home.slug === currentHome()) || null);
  const manages = computed(() => ["owner", "admin"].includes(current.value?.role));

  return { homes, current, manages, load, create };
}

// The people in a home (D-36), through JSKIT's workspace routes: everyone in a home can see who's in it. Inviting
// people and changing who's in a home are for a copy that turns invitations on (config/extensions.js); its screens
// build on these parts.
export const homeRoute = (slug, path) => `/api/w/${encodeURIComponent(slug)}${path}`;
export const attributesOf = (result) => result?.data?.attributes || {};
/** A JSON:API request of `method` to `url`, with the attributes of a `type` document when it has a body. */
export const sendJsonApi = (url, method, type, attributes) => client.request(url, {
  method,
  headers: JSON_API,
  ...(type ? { body: { data: { type, attributes } } } : {})
});
export { read as readJsonApi };

// JSKIT answers a home's lists a page at a time (20 unless asked for more, at most 100), each page with the cursor of
// the next; these lists are read whole, 100 at a time.
const PAGE_SIZE = 100;
/**
 * Every entry of one of a home's lists: "members", or "invites" where a copy has invitations.
 * @param {string} slug
 * @param {string} list
 */
export async function homeList(slug, list) {
  const entries = [];
  let cursor = "";
  do {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), ...(cursor ? { cursor } : {}) });
    const page = attributesOf(await read(homeRoute(slug, `/${list}?${query}`)));
    entries.push(...(page[list] || []));
    cursor = page.nextCursor || "";
  } while (cursor);
  return entries;
}

export const peopleApi = {
  members: (slug) => homeList(slug, "members")
};
