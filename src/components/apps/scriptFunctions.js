import { runFunction } from "@local/apps/shared/sandbox";

// An app's formula functions in the browser (D-35, scripts): the same QuickJS sandbox as the server,
// loaded only for apps that have functions, so screens can show what the functions work out.
// readable-check: allow module-state - shared resource: every app screen on the page runs its functions in one QuickJS module, loaded once
let engine = null;

export async function browserFunctions(list) {
  if (!list?.length) return null;
  engine ||= Promise.all([import("quickjs-emscripten-core"), import("@jitl/quickjs-singlefile-browser-release-sync")])
    .then(([core, variant]) => core.newQuickJSWASMModuleFromVariant(variant.default));
  const quickjs = await engine;
  return {
    id: list.map((fn) => `${fn.name}@${fn.version}`).join(","),
    list: list.map((fn) => ({ name: fn.name, arity: fn.params.length, call: (...args) => runFunction(quickjs, fn.code, args) }))
  };
}
