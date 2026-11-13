/**
 * Waits until `work` settles or `ms` pass, whichever comes first, and leaves no timer behind: a
 * forgotten one kept a closed server's process alive for the whole wait (20 s on shutdown, and 20 s
 * after every reply a page waited for). Resolves with the work's value, or undefined when the time
 * ran out; rejects when the work does.
 * @template T
 * @param {Promise<T>} work
 * @param {number} ms
 * @returns {Promise<T | undefined>}
 */
export async function settledWithin(work, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Work that carries on after a request returns, such as learning a taught task. A server that is
 * shutting down gives it time to finish (D-19).
 */
export function createBackgroundWork() {
  const pending = new Set();

  /**
   * Runs `work` in the background; a failure ends it quietly.
   * @param {unknown} work
   */
  function add(work) {
    const tracked = Promise.resolve(work).catch(() => {}).finally(() => pending.delete(tracked));
    pending.add(tracked);
  }

  /**
   * Waits up to `ms` in all for the background work to finish, including the work it starts as it
   * ends (a finished reply answers a message that arrived meanwhile, or carries an open goal on):
   * waiting only for what was pending at the start let that follow-up outlive the drain.
   * @param {number} ms
   */
  async function drain(ms) {
    const deadline = Date.now() + ms;
    while (pending.size && Date.now() < deadline) {
      await settledWithin(Promise.allSettled([...pending]), deadline - Date.now());
    }
  }

  return Object.freeze({
    add,
    drain
  });
}
