import { createAppRequests } from "../../packages/integrations/src/server/appRequests.js";

// A connected account's key as integrations hands it to bots and connectors (D-96): the token, and the account's own
// fetch, made by the real pacer (appRequests.js) over turns kept in memory as plugin_account_turns keeps them. Its
// requests reach `globalThis.fetch`, a test's stand-in for the app, when they're sent; `sent` counts them, so a test sees
// every request went through the pacer. By default turns don't wait (`sleep` returns at once) and the app allows
// plenty, so a test pays no time for them.

/** An account's turns in memory: lockOrCreate runs one work at a time per account, as the row's lock does. */
export function memoryTurns() {
  const rows = new Map();
  const queues = new Map();
  return {
    rows,
    lockOrCreate(row, _options, work) {
      const id = String(row.id);
      const run = (queues.get(id) || Promise.resolve()).then(() => {
        if (!rows.has(id)) rows.set(id, { ...row });
        return work({ ...rows.get(id) }, {});
      });
      queues.set(id, run.catch(() => {}));
      return run;
    },
    async patch(id, changes) {
      rows.set(String(id), { ...rows.get(String(id)), ...changes });
    }
  };
}

/**
 * @param {string} token
 * @param {{ app?: string, limits?: { requests: number, seconds: number }, pace?: string | null, now?: () => number,
 *   sleep?: (ms: number) => Promise<unknown> }} [options]
 * @returns {{ token: string, fetch: typeof fetch, sent: number, turns: ReturnType<typeof memoryTurns> }}
 */
export function appKey(token, { app = "The app", limits = { requests: 6000, seconds: 60 }, pace = null, now, sleep = async () => {} } = {}) {
  const turns = memoryTurns();
  const requests = createAppRequests({ turns, systemContext: () => ({}), sleep, ...(now ? { now } : {}) });
  const key = { token, sent: 0, turns, fetch: null };
  key.fetch = requests.fetchFor({ id: token, pace }, { name: app, limits }, (url, init) => {
    key.sent += 1;
    return globalThis.fetch(url, init);
  });
  return key;
}

/** What connections.accessToken gives for an account: its token and its own paced fetch, as appKey makes them. */
export function accessOf(token, options) {
  const key = appKey(token, options);
  return { accessToken: token, fetch: key.fetch, key };
}
