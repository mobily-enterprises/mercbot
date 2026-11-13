// The type of the `mercbot.files` capability, for features that require it, and of its file store.

/** @typedef {ReturnType<typeof import("./filesRuntime.js").createFilesRuntime>} Files */
/** @typedef {ReturnType<typeof import("./fileStore.js").createFileStore>} FileStore */
/** @typedef {ReturnType<typeof import("./remoteMounts.js").createRemoteMounts>} RemoteMounts */
/** @typedef {ReturnType<typeof import("./driveStorage.js").createDriveStorage>} DriveStorage */
/** @typedef {ReturnType<typeof import("./shellRuns.js").createShellRuns>} ShellRuns */

export {};
