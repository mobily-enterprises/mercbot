// Signs a browser state in as the first saved Preview identity (.vibe64/preview-identities.json),
// through the app's own preview identity command (tools/preview-identity, as the Stack declares it),
// and writes it as a Playwright storage state. Mercbot's opens the copy with its key, read from the
// data folder `env` names (MERCBOT_DATA_DIR): the Test Preview's own.
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

/** The cookie a Set-Cookie header sets for `host`, as Playwright stores it, or null when it expires it. */
function storedCookie(header, host) {
  const [pair, ...attributes] = header.split(";").map((part) => part.trim());
  const separator = pair.indexOf("=");
  const attribute = (key) => attributes.find((entry) => entry.toLowerCase().startsWith(key));
  const maxAge = attribute("max-age=");
  const expiresAt = attribute("expires=");
  const now = Math.floor(Date.now() / 1000);
  let expires = -1;
  if (maxAge) expires = now + Number(maxAge.split("=")[1]);
  else if (expiresAt) expires = Math.floor(Date.parse(expiresAt.slice(8)) / 1000);
  if (expires !== -1 && expires <= now) return null;
  const sameSite = (attribute("samesite=") || "samesite=Lax").split("=")[1];
  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    domain: host,
    path: (attribute("path=") || "path=/").split("=")[1],
    expires,
    httpOnly: Boolean(attribute("httponly")),
    secure: false,
    sameSite: sameSite[0].toUpperCase() + sameSite.slice(1).toLowerCase()
  };
}

/** Signs in at `origin` and writes the storage state to `file`; returns the account's email. */
export async function signInAsPreviewOwner(origin, file, env) {
  const { identities } = JSON.parse(await readFile(".vibe64/preview-identities.json", "utf8"));
  const owner = identities.find((entry) => entry.type === "email");
  const child = spawn(process.execPath, ["tools/preview-identity"], { stdio: ["pipe", "pipe", "inherit"], env });
  child.stdin.end(JSON.stringify({
    protocol: "vibe64.preview-identity.command.v1",
    requestId: "browser-tests",
    operation: "login-as",
    subject: { kind: "selector", selector: { type: "email", value: owner.value } },
    target: { origin }
  }));
  let text = "";
  for await (const chunk of child.stdout) text += chunk;
  const result = JSON.parse(text.trim().split("\n").pop() || "{}");
  if (!result.ok) throw new Error(`Signing in as ${owner.value} at ${origin} failed: ${JSON.stringify(result)}`);
  const host = new URL(origin).hostname;
  const cookies = new Map();
  for (const header of result.setCookie) {
    const cookie = storedCookie(header, host);
    const name = header.slice(0, header.indexOf("="));
    if (cookie) cookies.set(name, cookie);
    else cookies.delete(name);
  }
  await writeFile(file, JSON.stringify({ cookies: [...cookies.values()], origins: [] }, null, 2));
  return result.identity.email;
}
