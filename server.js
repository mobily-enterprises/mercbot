import Fastify from "fastify";
import SerializerSelector from "@fastify/fast-json-stringify-compiler";
import { createCachedResponseSerializerFactory } from "@jskit-ai/kernel/server/http";
import fastifyStatic from "@fastify/static";
import { buildLoggerOptions } from "./server/lib/loggerOptions.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  createInstalledRuntime,
  registerSurfaceRequestConstraint,
  resolveRuntimeProfileFromSurface
} from "@jskit-ai/kernel/server/platform";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";
import { API_BASE_PATH, matchesPathPrefix, normalizePathname, toRequestPathname } from "@jskit-ai/kernel/shared/surface/paths";
import { missingKeyLines } from "@local/account/keys";
import { checkAiSettings } from "@local/account/model";
import { checkSingleUserHost, singleUserServer } from "@local/single-user/gate";
import { loadKey } from "@local/single-user/key";
import { checkPublicUrl, resolveRuntimeEnv } from "./server/lib/runtimeEnv.js";
import { surfaceRuntime } from "./server/lib/surfaceRuntime.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const SPA_INDEX_FILE = "index.html";
const BUILT_FILE = Object.freeze({ maxAge: 365 * 24 * 60 * 60 * 1000, immutable: true });
const STATIC_GLOBAL_UI_PATHS = Object.freeze([
  "/assets",
  "/favicon.svg",
  "/favicon.ico",
  "/robots.txt",
  "/manifest.webmanifest"
]);

function isApiPath(pathname) {
  return matchesPathPrefix(pathname, API_BASE_PATH);
}

function hasFileExtension(pathname) {
  return path.extname(normalizePathname(pathname)) !== "";
}

function buildGlobalUiPaths(runtimeGlobalUiPaths) {
  const paths = new Set(runtimeGlobalUiPaths);
  for (const staticPath of STATIC_GLOBAL_UI_PATHS) {
    paths.add(staticPath);
  }
  return [...paths];
}

function toStaticFilePath(pathname) {
  const normalizedPathname = normalizePathname(pathname);
  const relativePath = normalizedPathname.replace(/^\/+/, "");
  if (!relativePath || relativePath.endsWith("/")) {
    return "";
  }

  const normalizedRelativePath = path.posix.normalize(relativePath);
  if (
    !normalizedRelativePath ||
    normalizedRelativePath === "." ||
    normalizedRelativePath === ".." ||
    normalizedRelativePath.startsWith("../") ||
    normalizedRelativePath.includes("/../")
  ) {
    return "";
  }

  return normalizedRelativePath;
}

/** The built page, or "" when there is none. */
function readSpaDocument(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function canServeStaticFile(distRoot, relativePath) {
  if (!distRoot || !relativePath) {
    return false;
  }

  const normalizedDistRoot = path.resolve(distRoot);
  const resolvedPath = path.resolve(normalizedDistRoot, relativePath);
  if (!(resolvedPath === normalizedDistRoot || resolvedPath.startsWith(`${normalizedDistRoot}${path.sep}`))) {
    return false;
  }

  return existsSync(resolvedPath);
}

/**
 * The Fastify server with Mercbot's JSKIT runtime installed, for the environment given, and the `providers` of
 * `settings.providers` beside the installed packages' (a test's probe of the runtime it built). It is one person's own
 * copy, behind the single-user gate, unless `settings.gate` is false (seam S1: a copy built on Mercbot that serves many
 * people).
 * @param {{ runtimeEnv: RuntimeEnv, providers: object[], gate?: boolean }} settings
 */
async function createServerWith({ runtimeEnv, providers, gate = true }) {
  // A person's own copy (D-81) listens on loopback only, and checks every request and websocket for its key before
  // anything else sees it.
  if (gate) checkSingleUserHost(runtimeEnv);
  const app = Fastify({
    ...(gate ? { serverFactory: singleUserServer(loadKey(runtimeEnv)) } : {}),
    logger: buildLoggerOptions(),
    schemaController: {
      compilersFactory: {
        buildSerializer: createCachedResponseSerializerFactory(SerializerSelector())
      }
    },
    ajv: {
      customOptions: {
        allowUnionTypes: true
      }
    }
  });

  app.get("/api/health", async () => ({
    ok: true,
    app: "account-app"
  }));

  const appRoot = path.resolve(process.cwd());
  const distRoot = path.resolve(appRoot, "dist");
  // Read once: a build running beside this start (the browser suite seeds its fixtures meanwhile)
  // can empty dist between a check and a read. No page there means no web build.
  const spaDocument = readSpaDocument(path.resolve(distRoot, SPA_INDEX_FILE));
  const hasWebBuild = Boolean(spaDocument);
  const runtime = await createInstalledRuntime({
    appRoot,
    profile: resolveRuntimeProfileFromSurface({
      surfaceRuntime,
      serverSurface: runtimeEnv.SERVER_SURFACE
    }),
    config: await loadAppConfigFromAppRoot({ appRoot }),
    env: runtimeEnv,
    logger: app.log,
    fastify: app,
    providers
  });

  registerSurfaceRequestConstraint({
    fastify: app,
    surfaceRuntime,
    serverSurface: runtimeEnv.SERVER_SURFACE,
    globalUiPaths: buildGlobalUiPaths(runtime.globalUiPaths)
  });

  if (hasWebBuild) {
    await app.register(fastifyStatic, {
      root: distRoot,
      index: false,
      serve: false
    });
  } else {
    app.log.warn("Frontend build not found (dist/index.html). Page routes will return 404 until `npm run build`.");
  }

  app.setNotFoundHandler(async (request, reply) => {
    const pathname = toRequestPathname(request?.url);
    const method = String(request?.method || "GET").trim().toUpperCase();
    if (isApiPath(pathname) || (method !== "GET" && method !== "HEAD")) {
      return reply.code(404).send({
        message: `Route ${method}:${pathname} not found`,
        error: "Not Found",
        statusCode: 404
      });
    }
    if (hasFileExtension(pathname)) {
      const staticFilePath = toStaticFilePath(pathname);
      if (hasWebBuild && staticFilePath && canServeStaticFile(distRoot, staticFilePath)) {
        // Vite names every built file in assets/ by its content's hash, so a browser may keep it for
        // good: a page load then asks for none of them again (each was a request answered "304 Not
        // Modified" before, about 140 a load). Everything else, the page included, is asked for anew.
        return staticFilePath.startsWith("assets/") ? reply.sendFile(staticFilePath, BUILT_FILE) : reply.sendFile(staticFilePath);
      }
      return reply.code(404).send({
        message: `Route ${method}:${pathname} not found`,
        error: "Not Found",
        statusCode: 404
      });
    }
    if (!hasWebBuild) {
      return reply.code(404).send({
        error: "Frontend build is not available. Run `npm run build`."
      });
    }
    return reply.type("text/html; charset=utf-8").send(spaDocument);
  });

  app.log.info(
    {
      surface: surfaceRuntime.normalizeSurfaceMode(runtimeEnv.SERVER_SURFACE),
      providerPackages: runtime.providerPackageOrder,
      packageOrder: runtime.packageOrder,
      capabilities: runtime.diagnostics.capabilityIds
    },
    "Started JSKIT installed runtime."
  );

  return app;
}

/**
 * The Fastify server with Mercbot's JSKIT runtime installed, for the environment given, behind the single-user gate
 * unless `settings.gate` is false (createServerWith).
 * @param {{ runtimeEnv: RuntimeEnv, gate?: boolean }} settings
 */
function createServer({ runtimeEnv, gate }) {
  return createServerWith({ runtimeEnv, providers: [], gate });
}

/**
 * Starts the server on the host and port given, else on the environment's HOST and PORT. It refuses to start, saying
 * which setting to fix, with a public address in production that isn't https (D-65; http on loopback only while it
 * listens on loopback), with a kind of AI naming a provider it doesn't accept (D-72), or, behind the single-user gate,
 * listening anywhere but loopback (D-81). A key it isn't given leaves that feature off: the log says so, one line a key
 * (keys.js). The gate is on unless `options.gate` is false (seam S1): a copy built on Mercbot that serves many people
 * passes `gate: false`.
 * @param {{ host?: string, port?: number, gate?: boolean }} [options]
 */
async function startServer({ host, port, gate } = {}) {
  const runtimeEnv = resolveRuntimeEnv();
  const listenHost = host || runtimeEnv.HOST;
  checkPublicUrl({ ...runtimeEnv, HOST: listenHost });
  checkAiSettings(runtimeEnv);
  const listenPort = port ?? Number(runtimeEnv.PORT);
  const app = await createServer({
    runtimeEnv: {
      ...runtimeEnv,
      HOST: listenHost,
      PORT: String(listenPort)
    },
    gate
  });
  for (const line of missingKeyLines(runtimeEnv)) app.log.warn(line);
  await app.listen({ port: listenPort, host: listenHost });
  return app;
}

// A machine can be taken away at any time (D-19). On SIGTERM or SIGINT the server drains: it stops taking new
// connections, lets requests in progress finish, hands back routine runs, saves every bot's browser and closes live
// connections so pages reconnect elsewhere. It gives up after 25 seconds, inside the usual 30 seconds a platform allows.
const DRAIN_MS = 25000;

/**
 * Mercbot's server as `npm start` runs it (bin/server.js): started as startServer starts it, with `options.gate`, and
 * drained on SIGTERM or SIGINT. A failed start is reported and sets the exit code.
 * @param {{ gate?: boolean }} [options]
 */
async function serve({ gate } = {}) {
  try {
    const app = await startServer({ gate });
    let closing = false;
    const drain = async (signal) => {
      if (closing) return;
      closing = true;
      app.log.info({ signal }, "Draining before shutdown.");
      setTimeout(() => {
        console.error("Shutdown took too long; exiting.");
        process.exit(1);
      }, DRAIN_MS).unref();
      try {
        await app.close();
        process.exit(0);
      } catch (error) {
        console.error("Shutdown failed:", error);
        process.exit(1);
      }
    };
    process.once("SIGTERM", () => drain("SIGTERM"));
    process.once("SIGINT", () => drain("SIGINT"));
  } catch (error) {
    console.error("Failed to start account-app server:", error);
    process.exitCode = 1;
  }
}

export { createServer, createServerWith, serve, startServer };
