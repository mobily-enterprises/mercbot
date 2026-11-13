// The type of the `mercbot.apps` capability, for features that require it, and of its parts.

/** @typedef {ReturnType<typeof import("./appsRuntime.js").createAppsRuntime>} Apps */
/** @typedef {ReturnType<typeof import("./anyapi.js").createAnyapi>} Anyapi */
/** @typedef {ReturnType<typeof import("./registry.js").createRegistry>} Registry */
/** @typedef {ReturnType<typeof import("./dataGate.js").createDataGate>} DataGate */
/** @typedef {ReturnType<typeof import("./practice.js").createPractices>} Practices */
/** @typedef {ReturnType<typeof import("./apps.js").createApps>} AppStore */
/** @typedef {ReturnType<typeof import("./appJobs.js").createAppJobs>} AppJobs */
/** @typedef {ReturnType<typeof import("./runtime.js").createRuntime>} AppRuntime */
/** @typedef {ReturnType<typeof import("./trial.js").createTrial>} Trial */
/** @typedef {ReturnType<typeof import("./views.js").createViews>} Views */
/** @typedef {ReturnType<typeof import("./scripts.js").createScripts>} Scripts */
/** @typedef {ReturnType<typeof import("./appsRepository.js").createAppsRepository>} AppsRepository */
/** @typedef {ReturnType<typeof import("./scriptPool.js").createScriptPool>} ScriptPool */
/** @typedef {ReturnType<typeof import("./webAccess.js").createWebAccess>} WebAccess */

export {};
