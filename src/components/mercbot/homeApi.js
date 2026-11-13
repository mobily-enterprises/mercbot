// The home the page is in (D-36). The home's root page sets it from the address (/w/<home>/…);
// API calls for things a home owns are made at homePath("/bots/…") = /api/w/<home>/bots/….
// readable-check: allow module-state - shared resource: the page is in one home, which every API client on it addresses
let slug = "";

export function setCurrentHome(value) {
  slug = String(value || "");
}

export function currentHome() {
  return slug;
}

export const homePath = (path) => `/api/w/${encodeURIComponent(slug)}${path}`;

/** Makes a request with a client to a route the current home owns. */
export const requestInHome = (client, path, options) => client.request(homePath(path), options);
