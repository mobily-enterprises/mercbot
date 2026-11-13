/**
 * What Mercbot's client code reads from the browser, each probe written once. Outside a browser, as in a test, there is
 * no window, and not every browser has every feature.
 */

/** The media query list for a query; null outside a browser or where the browser has no matchMedia. */
function pageMediaQuery(query) {
  // readable-check: allow method-probe - platform object: matchMedia exists only in a browser, and not in every one
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(query);
}

/** Whether the page matches a media query; false where the page cannot tell. */
function pageMatchesMedia(query) {
  return pageMediaQuery(query)?.matches === true;
}

/** The nearest element matching the selectors, from an event's target. */
function closestElement(target, selectors) {
  // readable-check: allow optional-call - platform object: an event's target may be the window or a text node, which have no closest()
  return target?.closest?.(selectors) || null;
}

/** Every time zone the browser can name; just UTC where it cannot list them. */
function supportedTimeZones() {
  // readable-check: allow method-probe - platform object: Intl.supportedValuesOf is missing from older browsers
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
}

/** The media devices the browser lists; none where it has no device list, as on an insecure origin. */
async function pageMediaDevices() {
  // readable-check: allow optional-call - platform object: navigator.mediaDevices exists only on secure origins, and enumerateDevices not in every browser
  return await navigator.mediaDevices?.enumerateDevices?.() || [];
}

/** The page's speech synthesis; null outside a browser or where the browser has none. */
function pageSpeechSynthesis() {
  return typeof window === "undefined" ? null : window.speechSynthesis || null;
}

/**
 * Tells `onChange(visible)` when an element scrolls in or out of view, until the returned stop is
 * called; where the browser can't tell, or outside a browser, it counts as visible.
 */
function watchElementVisible(element, onChange) {
  if (typeof IntersectionObserver === "undefined") {
    onChange(true);
    return () => {};
  }
  const observer = new IntersectionObserver((entries) => onChange(entries.some((entry) => entry.isIntersecting)));
  observer.observe(element);
  return () => observer.disconnect();
}

export { closestElement, pageMatchesMedia, watchElementVisible, pageMediaDevices, pageMediaQuery, pageSpeechSynthesis, supportedTimeZones };
