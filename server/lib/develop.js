import { spawn } from "node:child_process";
import { startServer } from "../../server.js";
import { aiKeysOf, startPreviewAi, withoutCredentials } from "../../tools/previewAi.mjs";
import { loadEnvFile } from "./envFile.js";
import { DEFAULT_PORT } from "./runtimeEnv.js";

const LOOPBACK_HOST = "127.0.0.1";

function requiredPort(value) {
  const normalized = String(value || "").trim();
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`Invalid development port: ${normalized || "(empty)"}.`);
  }
  return parsed;
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

/**
 * Mercbot in development (bin/develop.js): the API server, started as startServer starts it with `options.gate`, on a
 * loopback port of its own, behind Vite's development server at HOST and PORT, which hands it the API and /open
 * (vite.config.mjs). A Preview reaches no outside service with a key that could cost anything (genesis/stack.md,
 * Outputs): with .env loaded, every credential it was given is emptied (tools/previewAi.mjs), so a feature whose key
 * that was is off here, but for a payment provider's test-mode key (`sk_test_…`, `rk_test_…`), which can't move money
 * and is kept so payments can be tried here (D-116), and the AI keys, so its bots work as they do anywhere (D-118); a
 * kind of AI with no key is Mercbot's stand-in model, so bots answer without a provider (D-83). `npm start` is the copy
 * that uses all its keys. It runs with APP_ENV=development, whatever .env or the shell says, as JSKIT's development
 * launcher does (D-87).
 * It stops when Vite does, or on SIGTERM or SIGINT; a failed start is reported and sets the exit code.
 * @param {{ gate?: boolean }} [options]
 */
export async function develop({ gate } = {}) {
  process.env.APP_ENV = "development";
  const previewHost = String(process.env.HOST || "").trim() || "0.0.0.0";
  const previewPort = requiredPort(process.env.PORT || String(DEFAULT_PORT));
  let previewAi = null;
  let apiServer = null;
  let viteProcess = null;
  let requestedSignal = "";

  function requestShutdown(signal) {
    requestedSignal = signal;
    if (viteProcess && !viteProcess.killed) {
      viteProcess.kill(signal);
    }
  }

  process.once("SIGINT", () => requestShutdown("SIGINT"));
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));

  loadEnvFile();
  const aiKeys = aiKeysOf(process.env);
  withoutCredentials(process.env);

  try {
    previewAi = await startPreviewAi(aiKeys);
    // Only a Preview uses its own AI keys beside the stand-in (aiKind); a test copy with inherited keys never does.
    Object.assign(process.env, previewAi.env, { MERCBOT_PREVIEW_AI_KEYS: "1" });
    const real = Object.keys(aiKeys).filter((name) => name.endsWith("_API_KEY"));
    console.log(real.length
      ? `This Preview's AI uses its own keys (${real.join(", ")}); any kind without one is the stand-in model at ${previewAi.standIn.url}.`
      : `This Preview's AI is the stand-in model at ${previewAi.standIn.url} (tools/standInModel.mjs), never a provider.`);
    apiServer = await startServer({ host: LOOPBACK_HOST, port: 0, gate, role: "web" });
    const apiPort = /** @type {import("node:net").AddressInfo} */ (apiServer.server.address()).port;
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    viteProcess = spawn(
      npmCommand,
      ["run", "dev", "--", "--host", previewHost, "--port", String(previewPort), "--strictPort"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOST: previewHost,
          PORT: String(previewPort),
          VITE_API_PROXY_TARGET: `http://${LOOPBACK_HOST}:${apiPort}`,
          VITE_BUNDLED_DEV: process.env.VITE_BUNDLED_DEV ?? "1",
          VITE_DEV_PORT: String(previewPort)
        },
        stdio: "inherit"
      }
    );

    const result = await waitForChild(viteProcess);
    if (!requestedSignal && result.code !== 0) {
      throw new Error(
        `Vite development server stopped unexpectedly (${result.signal || `exit ${result.code ?? "unknown"}`}).`
      );
    }
  } catch (error) {
    console.error("Failed to start the development application:", error);
    process.exitCode = 1;
  } finally {
    if (apiServer) {
      await apiServer.close().catch(() => {});
    }
    if (previewAi) await previewAi.stop();
  }
}
