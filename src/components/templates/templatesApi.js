import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";

// The public bot template gallery and template pages: no sign-in needed.
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });

export const templatesApi = {
  gallery: () => client.request("/api/templates"),
  template: (slug) => client.request(`/api/templates/${encodeURIComponent(slug)}`)
};

/** A day (YYYY-MM-DD) in the person's own way of writing dates, the same day wherever they are. */
export const dayText = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

// A template's badge (D-43, D-79): the day its end-to-end check last passed for the template as it is now, or an
// honest "Not tested yet". The server decides which; `tested` is that day or null.
export const testedBadge = (template) => (template.tested ? `Tested ${dayText(template.tested)}` : "Not tested yet");

// What the badge means, for its tooltip and for screen readers.
export const testedMeaning = (template) => (template.tested
  ? "The Mercbot team checked this bot end to end: it asks its setup questions, creates its routines paused and sends nothing without a yes."
  : "The Mercbot team hasn't checked this bot end to end since it or Mercbot last changed.");
