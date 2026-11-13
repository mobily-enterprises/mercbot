/**
 * A test's cleanups, run newest first whatever order the runner runs its own after-hooks in (Node 26 runs them in
 * the order they were added). Add a connection first and what uses it after; pass the stack where a helper takes the
 * test's context (appsHome), so its cleanup joins the stack too.
 * @param {{ after: (work: () => unknown) => void }} context the test's context
 * @returns {{ after: (work: () => unknown) => void }}
 */
export function cleanupStack(context) {
  const stack = [];
  context.after(async () => {
    while (stack.length) await stack.pop()();
  });
  return { after: (work) => stack.push(work) };
}
