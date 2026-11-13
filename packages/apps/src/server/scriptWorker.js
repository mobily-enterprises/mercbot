import { parentPort } from "node:worker_threads";
import variant from "@jitl/quickjs-wasmfile-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import { ScriptError, hasLeaked, runScript } from "../shared/sandbox.js";

// A script worker (D-35): runs one script at a time in a fresh QuickJS runtime. Calls to the
// server's functions go to the parent as messages; the parent answers them through the data gate.
const quickjs = await newQuickJSWASMModuleFromVariant(variant);
const answers = new Map();
let nextCall = 0;

parentPort.on("message", async (message) => {
  if (message.answer !== undefined) {
    const waiting = answers.get(message.answer);
    answers.delete(message.answer);
    if (message.error) {
      waiting?.reject(new Error(message.error));
    } else {
      waiting?.resolve(message.value);
    }
    return;
  }
  const { code, input, cpuMs, memory, host } = message.run;
  const call = (group, name, args) => new Promise((resolve, reject) => {
    const id = (nextCall += 1);
    answers.set(id, { resolve, reject });
    parentPort.postMessage({ call: id, group, name, args });
  });
  try {
    const result = await runScript(quickjs, { code, input, cpuMs, memory, host, call });
    parentPort.postMessage({ done: true, ...result, retire: hasLeaked() });
  } catch (error) {
    const known = error instanceof ScriptError;
    parentPort.postMessage({
      done: true,
      error: known ? error.message : `the sandbox failed: ${error?.message || error}`,
      logs: error.logs || [],
      calls: error.calls || 0,
      cpuMs: error.cpuMs || 0,
      retire: !known || hasLeaked()
    });
  }
});
parentPort.postMessage({ ready: true });
