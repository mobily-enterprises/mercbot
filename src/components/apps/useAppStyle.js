import { onBeforeUnmount, watch } from "vue";

/**
 * An app's own CSS (owner, 2026-10-30), as the server fenced it to the app's area
 * ([data-app-style="<app id>"]): one <style> in the page while the app is open.
 * @param {import("vue").WatchSource<string>} css The app's CSS, empty when it has none.
 */
export function useAppStyle(css) {
  let element = null;
  watch(css, (value) => {
    if (!value) {
      element?.remove();
      element = null;
      return;
    }
    element ??= document.head.appendChild(Object.assign(document.createElement("style"), { className: "app-style" }));
    element.textContent = value;
  }, { immediate: true });
  onBeforeUnmount(() => element?.remove());
}
