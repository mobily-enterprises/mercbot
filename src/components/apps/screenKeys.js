import { computed, inject } from "vue";

// What an app screen's parts (AppNode, AppForm) receive from the screen around them (D-35).

/** The running screen, which AppFrame (or another page running an app's screens) provides: the screen runtime of the screen shown. */
export const APP_SCREEN_KEY = "appScreen";

/** Outside an app's screen (a view's card or viewer), no screen's reads stop a view's: its signal never aborts. */
const NO_APP_SCREEN = Object.freeze({ signal: new AbortController().signal });

/**
 * The signal the reads of the screen around the component stop with (appRuntime.js stop()), before Reset or Publish
 * clears the practice copy they read (D-71) and when another screen opens: a view on it stops its own reads with it.
 * @returns {AbortSignal}
 */
export function useScreenSignal() {
  return inject(APP_SCREEN_KEY, NO_APP_SCREEN).signal;
}

/** The selector of the app's own area, where its dialogs open, which AppFrame (or another page running an app's screens) provides. */
export const APP_AREA_KEY = "appArea";

/**
 * The selector of the app's own area from the screen around the component; outside an app's area
 * there is none, so a dialog opens where Vuetify puts it.
 * @returns {import("vue").ComputedRef<string | null>}
 */
export function useAppArea() {
  return inject(APP_AREA_KEY, computed(() => null));
}

/** The form a button sits in, which AppForm provides, so the button submits the form's values. */
export const APP_FORM_KEY = "appForm";

/** A button outside any form runs its own steps; this form submits nothing. */
export const NO_APP_FORM = Object.freeze({ async submit() {} });
