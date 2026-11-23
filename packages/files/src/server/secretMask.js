/**
 * Hides a command's secrets in its output as it streams (D-128): each one, and the form git sends one in
 * (base64 of x-access-token:<key>), becomes ***, in what the bot reads, its run's record, its whole output and its
 * chat line. The end of each piece is held back while it could be a secret's start, until the next piece or `flush`.
 * @param {string[]} secrets
 */
export function secretMask(secrets) {
  const hidden = [...new Set(secrets.filter(Boolean).flatMap((secret) => [secret, Buffer.from(`x-access-token:${secret}`).toString("base64")]))]
    .sort((one, other) => other.length - one.length);
  const longest = Math.max(0, ...hidden.map((secret) => secret.length));
  const hide = (text) => hidden.reduce((shown, secret) => shown.split(secret).join("***"), text);
  let held = "";
  return {
    add(text) {
      if (!hidden.length) return text;
      const shown = hide(held + text);
      const keep = Math.min(shown.length, longest - 1);
      held = shown.slice(shown.length - keep);
      return shown.slice(0, shown.length - keep);
    },
    flush() {
      const rest = hide(held);
      held = "";
      return rest;
    }
  };
}
