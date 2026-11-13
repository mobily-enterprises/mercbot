import { reactive } from "vue";

/** A screen's confirmation snackbar and the one way to show it: `notify(text, color)`. */
export function useSnackbar() {
  const snackbar = reactive({ open: false, text: "", color: undefined });
  const notify = (text, color) => Object.assign(snackbar, { open: true, text, color });
  return { snackbar, notify };
}
