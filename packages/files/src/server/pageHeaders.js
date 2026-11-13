// The headers of a page's own addresses (D-74), apart from the pages themselves so whatever else serves a page sends
// the same ones.

const PERMISSIONS =
  "accelerometer=(), bluetooth=(), camera=(), clipboard-read=(), clipboard-write=(), display-capture=(), fullscreen=(), " +
  "geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), " +
  "screen-wake-lock=(), serial=(), usb=(), xr-spatial-tracking=()";

/**
 * The headers of everything a page's address answers (D-74): only the page's own files, inline
 * styles and (with scripts) inline scripts; no requests, forms, frames or workers; sandboxed with
 * scripts only, so it has no origin of its own even opened in a tab of its own; no referrer, and no
 * camera, microphone, location or other device. A page opened on its own, outside its viewer, runs no scripts at all.
 * @param {{ scripts: boolean }} mode
 */
function pageHeaders({ scripts }) {
  const policy = [
    "default-src 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    scripts ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    scripts ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
    scripts ? "sandbox allow-scripts" : "sandbox"
  ].join("; ");
  return Object.freeze({
    "content-security-policy": policy,
    "referrer-policy": "no-referrer",
    "permissions-policy": PERMISSIONS,
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store"
  });
}

export { pageHeaders };
