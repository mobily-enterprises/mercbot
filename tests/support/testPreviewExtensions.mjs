import { SINGLE_USER_EMAIL } from "../../packages/account/src/server/thisCopy.js";
import { loadKey } from "../../packages/single-user/src/server/key.js";

// What a copy built on Mercbot adds to its Test Preview (start-test-app.mjs) and the browser suite's fixtures
// (fixtures.mjs): the settings it needs and the stand-ins for the outside services it reaches, started before the app
// loads and given back as variables for its environment (the app's address is in APP_PUBLIC_URL once its port is
// known, after this returns), the person whose home the fixtures fill, and what it adds to that home. Mercbot itself
// adds nothing and has one person; a copy puts its own file in place of this one in its test support.

/** @returns {Promise<Record<string, string>>} */
export async function testPreviewExtensions() {
  return {};
}

/**
 * Makes the person whose home the fixtures fill, with their personal home, on the test database, and answers their
 * email. Mercbot's one person is made by its first start and gets their home when they first open it with its key, as
 * `mercbot open` does.
 * @returns {Promise<string>}
 */
export async function testPreviewOwner() {
  // Loaded only here: start-test-app.mjs imports this file before it sets the environment the server reads.
  const { startServer } = await import("../../server.js");
  const api = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const opened = await fetch(`http://127.0.0.1:${api.server.address().port}/open?key=${loadKey(process.env)}`);
    if (opened.status !== 200) throw new Error(`Opening the Test Preview with its key failed (${opened.status}): ${await opened.text()}`);
  } finally {
    await api.close();
  }
  return SINGLE_USER_EMAIL;
}

/**
 * What the fixtures add to the home they fill, once its contacts, bots and first apps are made, given the home, the
 * database, the person with their call's options and context, the Apps features and `check`, which stops on a refused
 * draft. Mercbot adds nothing.
 */
export async function testPreviewHome() {}
