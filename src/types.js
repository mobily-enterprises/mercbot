/**
 * Mercbot's client types: the values its client code hands out or receives across files.
 */

/** @typedef {ReturnType<typeof import("./components/apps/appRuntime.js").createScreenRuntime>} ScreenRuntime */

/**
 * The form a button sits in (AppForm): submitting runs the button's steps with the form's values.
 * @typedef {object} AppForm
 * @property {(steps: string) => Promise<void>} submit
 */

/** @typedef {ReturnType<typeof import("./components/mercbot/useChatMessages.js").useChatMessages>} ChatMessages */

/**
 * The chat list's layout (chatDirectory.js): pinned tiles, rows grouped by section, hidden and archived chats.
 * @typedef {ReturnType<typeof import("./components/mercbot/chatDirectory.js").buildSidebarModel>} SidebarModel
 */

/** @typedef {ReturnType<typeof import("./components/mercbot/useChatWork.js").useChatWork>} ChatWork */

/**
 * Explains a step that failed, in the shell's error feedback.
 * @typedef {(message: string, cause: unknown) => void} ReportFailure
 */

/**
 * A chat as the shell lists it (chatDirectory.js toChatRow): the server's ChatView (its kind, title, people, bots,
 * place and latest message) with the person's place in it spread onto it.
 * @typedef {Record<string, any>} Chat
 */

/**
 * A section of the person's chat list.
 * @typedef {Record<string, any>} ChatSection
 */

/**
 * A bot on the home's team, as the bots routes send it: its id, name, colour, shape, template and the rest.
 * @typedef {Record<string, any>} Bot
 */

/**
 * A message in a chat: its id, kind, role, author (a person or a bot) and body.
 * @typedef {Record<string, any>} ChatMessage
 */

/**
 * A connectable app as the integrations routes describe it: its accounts, actions and state.
 * @typedef {Record<string, any>} Plugin
 */

export {};
