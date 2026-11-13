// One script run inside QuickJS (D-35, scripts): a fresh runtime and context with memory and stack
// limits, and an interrupt that stops the script once its own running time passes `cpuMs` (time
// spent waiting for the server's answers isn't counted). Only JSON crosses in either direction.
// Used by the server's worker threads (async scripts with host calls) and, synchronously, for
// formula functions on the server and in the browser.
export class ScriptError extends Error {}

const LOG_LINES = 50;
const LOG_BYTES = 4096;

function limited(quickjs, { memory, stack = 256 * 1024 }) {
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(memory);
  runtime.setMaxStackSize(stack);
  return runtime;
}

function clock(cpuMs) {
  let spent = 0;
  let since = null;
  return {
    enter: () => (since = performance.now()),
    leave: () => {
      if (since !== null) spent += performance.now() - since;
      since = null;
    },
    over: () => spent + (since === null ? 0 : performance.now() - since) > cpuMs,
    spent: () => Math.round(spent)
  };
}

function errorText(context, handle) {
  const error = context.dump(handle);
  handle.dispose();
  if (error && typeof error === "object") {
    const message = String(error.message ?? "");
    if (error.name === "InternalError" && message === "interrupted") return "it ran too long";
    if (/out of memory/iu.test(message)) return "it used too much memory";
    if (/stack overflow/iu.test(message)) return "it went too deep (stack overflow)";
    return [error.name, message].filter(Boolean).join(": ") || "it failed";
  }
  return String(error);
}

/** JSON in: a value becomes a handle through the guest's own JSON.parse. */
function toHandle(context, value) {
  const text = context.newString(JSON.stringify(value === undefined ? null : value));
  const json = context.getProp(context.global, "JSON");
  const parse = context.getProp(json, "parse");
  const result = context.callFunction(parse, json, text);
  for (const handle of [text, json, parse]) handle.dispose();
  return context.unwrapResult(result);
}

/** JSON out: anything that isn't plain data (functions, cycles) fails here, not later. */
function fromHandle(context, handle) {
  const json = context.getProp(context.global, "JSON");
  const stringify = context.getProp(json, "stringify");
  const result = context.callFunction(stringify, json, handle);
  json.dispose();
  stringify.dispose();
  const text = context.unwrapResult(result);
  const value = context.getString(text);
  text.dispose();
  return value === undefined || value === "undefined" ? null : JSON.parse(value);
}

function addConsole(context, logs) {
  let bytes = 0;
  const consoleObject = context.newObject();
  const log = context.newFunction("log", (...handles) => {
    const line = handles.map((handle) => {
      const value = context.dump(handle);
      return typeof value === "string" ? value : JSON.stringify(value);
    }).join(" ");
    if (logs.length < LOG_LINES && bytes < LOG_BYTES) {
      logs.push(line.slice(0, LOG_BYTES - bytes));
      bytes += line.length;
    }
  });
  for (const name of ["log", "info", "warn", "error"]) context.setProp(consoleObject, name, log);
  context.setProp(context.global, "console", consoleObject);
  log.dispose();
  consoleObject.dispose();
}

// A script that leaves a call unanswered (it didn't await it) can leave handles behind; QuickJS
// then refuses to free its runtime. The memory is the worker's, which is retired (`leaked`).
let leaked = false;
export const hasLeaked = () => leaked;
function release(context, runtime) {
  try {
    context.dispose();
    runtime.dispose();
  } catch {
    leaked = true;
  }
}

function loadMain(context, code, timer) {
  timer.enter();
  const loaded = context.evalCode(String(code), "script.js");
  timer.leave();
  if (loaded.error) throw new ScriptError(errorText(context, loaded.error));
  loaded.value.dispose();
  const main = context.getProp(context.global, "main");
  if (context.typeof(main) !== "function") {
    main.dispose();
    throw new ScriptError("the script must define a function called main");
  }
  return main;
}

/** A synchronous, pure function (formulas): no host calls, a few milliseconds, a small heap. */
export function runFunction(quickjs, code, args, { cpuMs = 100, memory = 8 * 1024 * 1024 } = {}) {
  const runtime = limited(quickjs, { memory });
  const timer = clock(cpuMs);
  runtime.setInterruptHandler(() => timer.over());
  const context = runtime.newContext();
  try {
    const main = loadMain(context, code, timer);
    const handles = args.map((value) => toHandle(context, value));
    timer.enter();
    const result = context.callFunction(main, context.undefined, ...handles);
    timer.leave();
    for (const handle of [main, ...handles]) handle.dispose();
    if (result.error) throw new ScriptError(errorText(context, result.error));
    if (context.typeof(result.value) === "object" && context.getPromiseState(result.value).type) {
      result.value.dispose();
      throw new ScriptError("a function used in formulas can't be async");
    }
    const value = fromHandle(context, result.value);
    result.value.dispose();
    return value;
  } finally {
    release(context, runtime);
  }
}

/**
 * A script run: `main(input)` may await the host's functions, given as { group: { name: true } }
 * (e.g. { records: { list: true } }) and served one at a time by `call(group, name, args)`.
 */
export async function runScript(quickjs, { code, input, cpuMs = 1000, memory = 32 * 1024 * 1024, host = {}, call }) {
  const runtime = limited(quickjs, { memory });
  const timer = clock(cpuMs);
  runtime.setInterruptHandler(() => timer.over());
  const context = runtime.newContext();
  const logs = [];
  let calls = 0;
  // Calls the script made that haven't been answered yet.
  const unanswered = new Set();
  let queue = Promise.resolve();
  let finish = null;
  let done = false;
  const finished = new Promise((resolve) => (finish = (outcome) => {
    done = true;
    resolve(outcome);
  }));
  let promise = null;

  /** Runs the script's ready work, then sees whether main() has settled or is stuck. */
  const pump = () => {
    if (done || !context.alive) return;
    timer.enter();
    const jobs = runtime.executePendingJobs();
    timer.leave();
    if (jobs.error) return finish({ error: jobs.error });
    const state = context.getPromiseState(promise);
    // A plain (not async) main's result is the same handle as `promise`, freed with it.
    if (state.type === "fulfilled") finish({ value: state.value, own: !state.notAPromise });
    else if (state.type === "rejected") finish({ error: state.error });
    else if (!unanswered.size) finish({ stuck: true });
  };

  try {
    addConsole(context, logs);
    for (const [group, names] of Object.entries(host)) {
      const object = context.newObject();
      for (const name of Object.keys(names)) {
        const fn = context.newFunction(name, (...handles) => {
          const args = handles.map((handle) => context.dump(handle));
          const deferred = context.newPromise();
          unanswered.add(deferred);
          calls += 1;
          // One call at a time per run: the next starts when the previous has answered.
          queue = queue.then(() => call(group, name, args)).then(
            (value) => {
              unanswered.delete(deferred);
              if (!context.alive) return;
              const handle = toHandle(context, value);
              deferred.resolve(handle);
              handle.dispose();
            },
            (error) => {
              unanswered.delete(deferred);
              if (!context.alive) return;
              const handle = context.newError(String(error?.message || error));
              deferred.reject(handle);
              handle.dispose();
            }
          ).catch((error) => {
            // Handing the answer over failed (it ran out of time or memory doing so): the run ends.
            if (context.alive) finish({ failure: timer.over() ? "it ran too long" : String(error?.message || error) });
          }).then(pump);
          return deferred.handle;
        });
        context.setProp(object, name, fn);
        fn.dispose();
      }
      context.setProp(context.global, group, object);
      object.dispose();
    }
    const main = loadMain(context, code, timer);
    const inputHandle = toHandle(context, input);
    timer.enter();
    const started = context.callFunction(main, context.undefined, inputHandle);
    timer.leave();
    main.dispose();
    inputHandle.dispose();
    if (started.error) throw new ScriptError(errorText(context, started.error));
    promise = started.value;
    pump();
    const outcome = await finished;
    if (outcome.stuck) throw new ScriptError("it waited for something that never happens");
    if (outcome.failure) throw new ScriptError(outcome.failure);
    if (outcome.error) throw new ScriptError(errorText(context, outcome.error));
    const value = fromHandle(context, outcome.value);
    if (outcome.own) outcome.value.dispose();
    return { value, logs, calls, cpuMs: timer.spent() };
  } catch (error) {
    if (error instanceof ScriptError) Object.assign(error, { logs, calls, cpuMs: timer.spent() });
    throw error;
  } finally {
    // Calls the script never awaited are dropped with it.
    for (const deferred of unanswered) deferred.dispose();
    promise?.dispose();
    release(context, runtime);
  }
}
