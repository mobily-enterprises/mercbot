// The type of the `mercbot.integrations` capability, for features that require it, and of
// `mercbot.integrations.bridged-sign-ins`, which the integrations feature reads when a feature provides it.

/** @typedef {ReturnType<typeof import("./integrationsService.js").createIntegrationsService>} Integrations */
/** @typedef {ReturnType<typeof import("./accounts.js").createAccounts>} Accounts */
/** @typedef {ReturnType<typeof import("./oauth.js").createOAuth>} OAuthClient */
/**
 * An account that turned connected, as `connections.whenConnected` listeners are told of it: its app, its owner, and its
 * home (null for a person's own account, which reaches their own chats in every home, D-37).
 * @typedef {{ pluginId: string, userId: string, homeId: string | null }} Connection
 */
/** @typedef {(connection: Connection, txOptions: object) => Promise<(() => Promise<void>) | void>} ConnectedListener */
/**
 * The bridge connections this copy lends its registered apps' sign-ins to (`mercbot.integrations.bridged-sign-ins`), as
 * `connections.startBridgedSignIn` made them: `pluginOf` answers the app a connection is for (null when it's gone), and
 * `signedIn` keeps what a finished sign-in gave it, its tokens already sealed.
 * @typedef {{
 *   pluginOf: (connectionId: string, options: object) => Promise<string | null>,
 *   signedIn: (connectionId: string, signIn: { tokens: object, label: string | null }, options: object) => Promise<void>
 * }} BridgedSignIns
 */

export {};
