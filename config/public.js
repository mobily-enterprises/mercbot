import extensions from "./extensions.js";
import { roleCatalog } from "./roles.js";
import { surfaceAccessPolicies } from "./surfaceAccessPolicies.js";

export const config = {};

config.surfaceModeAll = "all";
config.surfaceDefaultId = "start";
config.webRootAllowed = "yes";
config.surfaceAccessPolicies = surfaceAccessPolicies;

// Homes (D-36): every person gets a first home, lives in one or more homes (JSKIT workspaces) and may create more.
// Nobody is invited into a home here, so JSKIT serves no invitation routes; a copy serving many people turns
// invitations on in config/extensions.js. JSKIT asks how long an invitation would last even with them off. Homes start
// with Mercbot's own colours, which JSKIT themes the page from.
config.tenancyMode = "workspaces";
config.tenancyPolicy = { workspace: { allowSelfCreate: true, autoProvision: true } };
config.roleCatalog = roleCatalog;
config.workspaceInvitations = { enabled: false };
config.workspaceMembers = { defaults: { inviteExpiresInMs: 7 * 24 * 60 * 60 * 1000 } };
config.workspaceSettings = {
  defaults: {
    invitesEnabled: false,
    lightPrimaryColor: "#1C1C1C",
    lightSecondaryColor: "#565F71",
    lightSurfaceColor: "#FFFFFF",
    lightSurfaceVariantColor: "#F0F0F0",
    darkPrimaryColor: "#F5F5F5",
    darkSecondaryColor: "#A6A6A6",
    darkSurfaceColor: "#1F1F1F",
    darkSurfaceVariantColor: "#1F1F1F"
  }
};
config.surfaceDefinitions = {
  // Opening Mercbot (D-36): finds the home the person used last, or their first, and goes there.
  // Someone not signed in sees the front page there instead, so it's public.
  start: {
    id: "start",
    label: "Mercbot",
    pagesRoot: "",
    enabled: true,
    requiresAuth: false,
    requiresWorkspace: false,
    accessPolicyId: "public",
    origin: ""
  },
  home: {
    id: "home",
    label: "Home",
    pagesRoot: "w/[workspaceSlug]",
    enabled: true,
    requiresAuth: true,
    requiresWorkspace: true,
    accessPolicyId: "authenticated",
    origin: ""
  },
  auth: {
    id: "auth",
    label: "Sign in",
    pagesRoot: "auth",
    enabled: true,
    requiresAuth: false,
    requiresWorkspace: false,
    accessPolicyId: "public",
    origin: ""
  },
  // Bot templates: the public gallery and template pages at /templates, for anyone.
  templates: {
    id: "templates",
    label: "Bot templates",
    pagesRoot: "templates",
    enabled: true,
    requiresAuth: false,
    requiresWorkspace: false,
    accessPolicyId: "public",
    origin: ""
  },
  // The help centre: public pages at /help.
  help: {
    id: "help",
    label: "Help",
    pagesRoot: "help",
    enabled: true,
    requiresAuth: false,
    requiresWorkspace: false,
    accessPolicyId: "public",
    origin: ""
  },
  // A template's share page, at its short link /t/<code>.
  share: {
    id: "share",
    label: "Shared bot",
    pagesRoot: "t",
    enabled: true,
    requiresAuth: false,
    requiresWorkspace: false,
    accessPolicyId: "public",
    origin: ""
  },
  account: {
    id: "account",
    label: "Account",
    pagesRoot: "account",
    enabled: true,
    requiresAuth: true,
    requiresWorkspace: false,
    accessPolicyId: "authenticated",
    origin: ""
  }
};

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** `extension` merged into `target`: an object into the object under the same key, key by key; anything else replaces. */
function merged(target, extension) {
  const result = { ...target };
  for (const [key, value] of Object.entries(extension)) {
    result[key] = isPlainObject(value) && isPlainObject(target[key]) ? merged(target[key], value) : value;
  }
  return result;
}

// What a copy built on Mercbot adds or changes (config/extensions.js), applied last.
Object.assign(config, merged(config, extensions));
