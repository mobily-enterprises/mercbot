import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";
import VueRouter from "vue-router/vite";
import { createJskitClientBootstrapPlugin } from "@jskit-ai/kernel/client/vite";
import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";

const configuredDevPort = Number.parseInt(String(process.env.VITE_DEV_PORT || "").trim(), 10);
const devPort = Number.isInteger(configuredDevPort) && configuredDevPort > 0 ? configuredDevPort : 3001;
const apiProxyTarget = String(process.env.VITE_API_PROXY_TARGET || "").trim() || "http://localhost:3001";
const clientEntry = (() => {
  const normalized = String(process.env.VITE_CLIENT_ENTRY || "").trim();
  if (!normalized) {
    return "/src/main.js";
  }
  if (normalized.startsWith("/")) {
    return normalized;
  }
  if (normalized.startsWith("src/")) {
    return `/${normalized}`;
  }
  return `/src/${normalized}`;
})();

// Version details for the About dialog.
const appVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// Mercbot's API takes anything that changes something, and every websocket, only from Mercbot's own page (its Origin,
// packages/single-user's gate). In development the page is Vite's, at Vite's address, so what Vite hands the API from
// its own page goes as from the API's own address. Every proxied path is covered, the packages' (Socket.IO) included.
function ownPageThroughVite(target) {
  const apiOrigin = new URL(target).origin;
  const fromApiOrigin = (proxyRequest, request) => {
    if (request.headers.origin === `http://${request.headers.host}`) proxyRequest.setHeader("origin", apiOrigin);
  };
  return {
    name: "mercbot-own-page-through-vite",
    apply: "serve",
    enforce: "post",
    config(config) {
      for (const entry of Object.values(config.server?.proxy || {})) {
        const configure = entry.configure;
        entry.configure = (proxy, options) => {
          configure?.(proxy, options);
          proxy.on("proxyReq", fromApiOrigin);
          proxy.on("proxyReqWs", fromApiOrigin);
        };
      }
    }
  };
}

export default defineConfig({
  // The development launcher (bin/develop.js: Preview and the test target) serves the app as a
  // bundle instead of ~700 separate modules (Vite 8.1+), so a page through the Preview proxy loads
  // in a few requests rather than hundreds of round trips. Plain `vite` keeps the usual mode.
  experimental: { bundledDev: process.env.VITE_BUNDLED_DEV === "1" },
  define: {
    __MERCBOT_VERSION__: JSON.stringify(appVersion),
    __MERCBOT_BUILT_AT__: JSON.stringify(new Date().toISOString())
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  plugins: [
    createJskitClientBootstrapPlugin({
      proxyTarget: apiProxyTarget
    }),
    VueRouter({
      routesFolder: "src/pages",
      dts: "src/typed-router.d.ts",
      nestedChildren: false
    }),
    vue(),
    vuetify({
      autoImport: true
    }),
    // Development pages carry no client build id (JSKIT compares it with the last production build
    // to offer a reload after an update); bundled dev mode would otherwise stamp one on and every
    // page would offer a pointless reload.
    {
      name: "mercbot-no-dev-build-id",
      apply: "serve",
      transformIndexHtml: {
        order: "post",
        handler: (html) => String(html || "").replace(/<meta name="jskit-client-build"[^>]*>\s*/gu, "")
      }
    },
    {
      name: "jskit-client-entry",
      transformIndexHtml(source) {
        return String(source || "")
          .replace(/\/src\/%VITE_CLIENT_ENTRY%/g, clientEntry)
          .replace(/\/src\/main\.js/g, clientEntry);
      }
    },
    ownPageThroughVite(apiProxyTarget)
  ],
  test: {
    include: ["tests/client/**/*.vitest.js"],
    // As many test files at once as the machine's test budget allows.
    maxWorkers: testConcurrency()
  },
  // Pre-bundled at startup, including what screens load lazily (charts, spreadsheets, the formula
  // functions' sandbox), so a first visit never stops to bundle a dependency and reload the page.
  optimizeDeps: {
    include: [
      "vuetify/components/**",
      "vuetify/directives/**",
      "chart.js",
      "vue-chartjs",
      "quickjs-emscripten-core",
      "@jitl/quickjs-singlefile-browser-release-sync",
      "read-excel-file/browser",
      "write-excel-file/browser",
      "csv-parse/browser/esm/sync",
      "csv-stringify/browser/esm/sync"
    ],
    entries: [
      "index.html",
      "src/**/*.{js,ts,vue}"
    ]
  },
  server: {
    port: devPort,
    // Runtime data (bots' computers and files) and test output change all the time and are never
    // source: watching them only sends the browser a stream of pointless change events.
    watch: {
      ignored: ["**/.data/**", "**/.data-test/**", "**/.artifacts/**", "**/test-results/**"]
    },
    warmup: {
      clientFiles: [clientEntry.slice(1)]
    },
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true
      },
      // `mercbot open`'s address, which opens Mercbot with its key.
      "^/open(?:\\?|$)": {
        target: apiProxyTarget,
        changeOrigin: true
      }
    }
  }
});
