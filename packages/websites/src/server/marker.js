// Every published page carries a marker file with its publication's random id (D-84). Mercbot replaces or removes a
// folder on a website only when it holds this home's marker for that page, so it never overwrites or deletes anything
// it didn't put there, nor another page that happens to have the same name.

export const MARKER_FILE = ".mercbot-page.json";

/** The marker file of a publication, as it goes on the website. */
export const markerFile = (marker) => ({
  path: MARKER_FILE,
  type: "application/json",
  content: Buffer.from(`${JSON.stringify({ publishedBy: "Mercbot", marker })}\n`, "utf8")
});

/** The publication id a marker file's text names, or null. */
export function markerIn(text) {
  try {
    const marker = JSON.parse(String(text)).marker;
    return typeof marker === "string" ? marker : null;
  } catch {
    return null;
  }
}
