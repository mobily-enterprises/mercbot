import { createApp } from "vue";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createRouter, createWebHistory } from "vue-router/auto";
import { routes } from "vue-router/auto-routes";
import "vuetify/styles";
import "@jskit-ai/material-web/client/material.css";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { theme } from "./theme/index.js";
import "./styles/mercbot.css";
import App from "./App.vue";
import NotFoundView from "./views/NotFound.vue";
import { bootInstalledClientModules } from "virtual:jskit-client-bootstrap";
import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import {
  shouldRetryTransientQueryFailure,
  transientQueryRetryDelay
} from "@jskit-ai/kernel/shared/support";
import {
  bootstrapClientShellApp,
  createShellRouter
} from "@jskit-ai/kernel/client";
import { config } from "../config/public.js";

const surfaceRuntime = createSurfaceRuntime({
  allMode: config.surfaceModeAll,
  surfaces: config.surfaceDefinitions,
  defaultSurfaceId: config.surfaceDefaultId
});

const surfaceMode = surfaceRuntime.normalizeSurfaceMode(import.meta.env.VITE_SURFACE);
const { router, fallbackRoute } = createShellRouter({
  createRouter,
  history: createWebHistory(),
  routes,
  surfaceRuntime,
  surfaceMode,
  notFoundComponent: NotFoundView,
  guard: {
    surfaceDefinitions: config.surfaceDefinitions,
    defaultSurfaceId: config.surfaceDefaultId,
    webRootAllowed: config.webRootAllowed
  }
});

const vuetify = createVuetify(createMaterialVuetifyOptions(theme));
// Follow System / Light / Dark. JSKIT's account settings save the choice under
// "jskit.themePreference" but only apply it on the account page, so apply it at startup and
// follow live system changes here.
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
function applyThemePreference() {
  let preference = "system";
  try {
    preference = window.localStorage.getItem("jskit.themePreference") || "system";
  } catch {
    // Storage unavailable: follow the system.
  }
  const dark = preference === "dark" || (preference !== "light" && systemDark.matches);
  vuetify.theme.change(dark ? "dark" : "light");
}
applyThemePreference();
// readable-check: allow released-listeners - shared resource: the page follows the system theme for its whole life
systemDark.addEventListener("change", applyThemePreference);

// No form offers the browser's memory of what was typed elsewhere (the owner, 22 Nov: "Disable browser autocomplete ...
// for EVERY FORM"): a text field or text area with no autocomplete of its own gets "off" as it's focused, before the
// browser offers anything. A field that names its own (an email, a password, a one-time code) keeps it, so password
// managers still fill sign-in.
// readable-check: allow released-listeners - shared resource: every form on the page, for its whole life
document.addEventListener("focusin", (event) => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
  if (!field.hasAttribute("autocomplete")) field.setAttribute("autocomplete", "off");
}, true);

const pinia = createPinia();
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: shouldRetryTransientQueryFailure,
      retryDelay: transientQueryRetryDelay
    }
  }
});

void bootstrapClientShellApp({
  createApp,
  rootComponent: App,
  appConfig: config,
  appPlugins: [
    pinia,
    [VueQueryPlugin, { queryClient }],
    vuetify
  ],
  pinia,
  queryClient,
  router,
  bootClientModules: bootInstalledClientModules,
  surfaceRuntime,
  surfaceMode,
  env: import.meta.env,
  fallbackRoute
}).catch((error) => {
  console.error("Failed to bootstrap client app.", error);
  // The splash says so in its own words (index.html), and offers the reload at once.
  const shell = document.getElementById("startup-shell");
  const status = document.getElementById("startup-status");
  if (shell && status) {
    status.textContent = status.dataset.failure;
    shell.dataset.startup = "failed";
  }
});
