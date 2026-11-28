import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";

// A file going up as a form (a record's file or picture field, D-130; a public form's, D-140), with the session's CSRF
// token. It goes through XMLHttpRequest, which tells how much has gone (fetch can't), so the field shows a percentage.

/**
 * Sends `file` to `address` and answers the server's JSON. `onProgress(percent)` hears how much has gone up, 0 to 100.
 * Refused, it throws an Error with the server's words, its `status` and `data`; `tooBig` is the words for a 413 without
 * them (a size limit met on the way), and a lost connection has plain words of its own.
 * @param {string} address
 * @param {File} file
 * @param {{ onProgress?: (percent: number) => void, tooBig?: string }} [options]
 */
export async function uploadFile(address, file, { onProgress = () => {}, tooBig = "That file is too big to add." } = {}) {
  const form = new FormData();
  form.append("file", file, file.name);
  const session = await fetch(AUTH_PATHS.SESSION, { credentials: "include" }).then((response) => response.json()).catch(() => ({}));
  const { status, text } = await new Promise((resolve, reject) => {
    const sending = new XMLHttpRequest();
    sending.open("POST", address);
    sending.withCredentials = true;
    sending.setRequestHeader("csrf-token", String(session.csrfToken || ""));
    sending.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    sending.onload = () => resolve({ status: sending.status, text: sending.responseText });
    // The browser's own words mean nothing to the person.
    sending.onerror = () => reject(new Error("That file didn't upload: the connection was lost. Check it and try again."));
    sending.send(form);
  });
  let body = {};
  try {
    body = JSON.parse(text || "{}");
  } catch {
    body = {};
  }
  if (status < 200 || status >= 300) {
    throw Object.assign(new Error(body.error || (status === 413 ? tooBig : "That file didn't upload.")), { status, data: body });
  }
  return body;
}
