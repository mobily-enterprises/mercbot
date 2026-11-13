/**
 * Mercbot's client types: the values its client code hands out or receives across files.
 */

/** @typedef {ReturnType<typeof import("./components/apps/appRuntime.js").createScreenRuntime>} ScreenRuntime */

/**
 * The form a button sits in (AppForm): submitting runs the button's steps with the form's values.
 * @typedef {object} AppForm
 * @property {(steps: string) => Promise<void>} submit
 */

/** @typedef {ReturnType<typeof import("./components/mercbot/useBotMessages.js").useBotMessages>} BotMessages */

/**
 * The bot list's layout (botDirectory.js): pinned tiles, rows grouped by section, hidden bots.
 * @typedef {ReturnType<typeof import("./components/mercbot/botDirectory.js").buildSidebarModel>} SidebarModel
 */

/** @typedef {ReturnType<typeof import("./components/mercbot/useBotWork.js").useBotWork>} BotWork */

/**
 * Explains a step that failed, in the shell's error feedback.
 * @typedef {(message: string, cause: unknown) => void} ReportFailure
 */

/**
 * A bot or group chat as the shell lists it: its id, name, colour, kind and the rest
 * the bots routes send.
 * @typedef {Record<string, any>} Bot
 */

/**
 * A sidebar section.
 * @typedef {Record<string, any>} BotSection
 */

/**
 * A message in a chat: its id, kind, role and body.
 * @typedef {Record<string, any>} ChatMessage
 */

/**
 * A connectable app as the integrations routes describe it: its accounts, actions and state.
 * @typedef {Record<string, any>} Plugin
 */

export {};
