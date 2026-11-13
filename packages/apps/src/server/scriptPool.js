import { AsyncLocalStorage } from "node:async_hooks";
import { Worker } from "node:worker_threads";
import { ScriptError } from "../shared/sandbox.js";

const inScript = new AsyncLocalStorage();

/**
 * The worker threads scripts run in.
 *
 * Worker threads for scripts (D-35). A few stay warm (starting one costs ~80 ms); at most `size`
 * top-level runs at a time per server, the rest wait their turn. A run started while another
 * script's call is being answered (a rule checking that script's write) is nested: it skips the
 * queue, so runs can't wait on each other forever. A watchdog ends a run that outlives its wall
 * time by terminating its worker; the next run gets a fresh one.
 * @param {{ warm?: number, size?: number }} [options]
 */
export function createScriptPool({ warm = 2, size = 4 } = {}) {
  const idle = [];
  const waiting = [];
  let active = 0;
  let closed = false;

  const spawn = () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./scriptWorker.js", import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 64 } });
    worker.once("message", () => resolve(worker));
    worker.once("error", reject);
  });

  async function take(nested) {
    if (closed) throw new ScriptError("scripts are stopping on this server");
    if (!nested) {
      if (active >= size) await new Promise((resolve) => waiting.push(resolve));
      active += 1;
    }
    try {
      return idle.pop() || (await spawn());
    } catch (error) {
      if (!nested) give(null, false, false);
      throw error;
    }
  }

  function give(worker, nested, healthy) {
    if (!nested) {
      active -= 1;
      waiting.shift()?.();
    }
    if (!worker) return;
    if (healthy && !closed && idle.length < warm) {
      idle.push(worker);
    } else {
      worker.terminate();
    }
  }

  /** Runs `code` with `input`; the script's host calls are answered by `call(group, name, args)`. */
  async function run({ code, input, cpuMs, memory, host, call, wallMs }) {
    const nested = Boolean(inScript.getStore());
    const worker = await take(nested);
    return new Promise((resolve, reject) => {
      let over = false;
      const end = (healthy) => {
        over = true;
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("error", onFailure);
        worker.off("exit", onFailure);
        give(worker, nested, healthy);
      };
      const timer = setTimeout(() => {
        end(false);
        reject(Object.assign(new ScriptError(`it ran longer than ${Math.round(wallMs / 1000)} seconds`), { logs: [], calls: 0 }));
      }, wallMs);
      const onFailure = (error) => {
        if (over) return;
        end(false);
        reject(new ScriptError(`the sandbox stopped: ${error?.message || error}`));
      };
      const onMessage = async (message) => {
        if (message.call !== undefined) {
          try {
            const value = await inScript.run(true, () => call(message.group, message.name, message.args));
            if (!over) worker.postMessage({ answer: message.call, value: value === undefined ? null : value });
          } catch (error) {
            if (!over) worker.postMessage({ answer: message.call, error: String(error?.message || error) });
          }
          return;
        }
        if (!message.done) return;
        end(!message.retire);
        if (message.error) {
          reject(Object.assign(new ScriptError(message.error), { logs: message.logs, calls: message.calls, cpuMs: message.cpuMs }));
        } else {
          resolve({ value: message.value, logs: message.logs, calls: message.calls, cpuMs: message.cpuMs });
        }
      };
      worker.on("message", onMessage);
      worker.once("error", onFailure);
      worker.once("exit", onFailure);
      worker.postMessage({ run: { code, input, cpuMs, memory, host } });
    });
  }

  async function close() {
    closed = true;
    await Promise.all(idle.splice(0).map((worker) => worker.terminate()));
  }

  return Object.freeze({
    run,
    close
  });
}
