// Every client test sees what a viewer in en-US and UTC sees, whatever the host's own locale and time zone, so identical
// runs agree on every host (vite.config.mjs's test.setupFiles). The code under test keeps asking for the viewer's
// (no locale, the default time zone), as a browser answers it; this fixes only what those defaults are here.
const LOCALE = "en-US";
const PINNED = Symbol.for("mercbot.viewerDefaults");

process.env.TZ = "UTC";

if (!Intl[PINNED]) {
  Intl[PINNED] = true;
  // Intl's formatters, each made with the viewer's locale when none is named; called with or without `new`.
  for (const name of ["Collator", "DateTimeFormat", "DisplayNames", "ListFormat", "NumberFormat", "PluralRules", "RelativeTimeFormat", "Segmenter"]) {
    const Host = Intl[name];
    if (!Host) continue;
    const Pinned = function (locales, options) {
      return new Host(locales ?? LOCALE, options);
    };
    Pinned.prototype = Host.prototype;
    Pinned.supportedLocalesOf = Host.supportedLocalesOf.bind(Host);
    Intl[name] = Pinned;
  }
  // The built-ins that format in the viewer's locale: a number's, a date's, and a string's comparison.
  const methods = [
    [Number.prototype, "toLocaleString", 0],
    [BigInt.prototype, "toLocaleString", 0],
    [Date.prototype, "toLocaleString", 0],
    [Date.prototype, "toLocaleDateString", 0],
    [Date.prototype, "toLocaleTimeString", 0],
    [String.prototype, "localeCompare", 1]
  ];
  for (const [owner, name, at] of methods) {
    const host = owner[name];
    owner[name] = function (...args) {
      args[at] ??= LOCALE;
      return host.apply(this, args);
    };
  }
}
