import { computed, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import {
  DETAILS_CLOSE_WIDTH,
  DETAILS_MAX,
  DETAILS_MIN,
  SIDEBAR_COLLAPSE_X,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clamp,
  computeShellGeometry
} from "./shellGeometry.js";
import { shellPreferences } from "./shellPreferences.js";

// The shell's layout: the columns' sizes for the window, the details panel docked or
// floating, resizing either side, and the phone's bot drawer.
export function useShellLayout() {
  const display = useDisplay();
  const geometry = computed(() => computeShellGeometry({
    viewportWidth: display.width.value,
    compact: shellPreferences.compact,
    sidebarWidth: shellPreferences.sidebarWidth,
    detailsOpen: shellPreferences.detailsOpen,
    detailsWidth: shellPreferences.detailsWidth
  }));

  // Details in a window too narrow to dock it is hidden there: asking for it explicitly slides it
  // over the chat instead, so the click always shows something. A docked panel that the window
  // narrows away still hides; widening docks a floating one.
  const detailsFloating = ref(false);
  const detailsShown = computed(() => geometry.value.detailsVisible || (detailsFloating.value && shellPreferences.detailsOpen));
  watch(() => geometry.value.detailsVisible, (docked) => {
    if (docked) detailsFloating.value = false;
  });

  function showDetails() {
    shellPreferences.detailsOpen = true;
    detailsFloating.value = !geometry.value.detailsVisible;
  }

  function closeDetails() {
    shellPreferences.detailsOpen = false;
    detailsFloating.value = false;
  }

  // On a phone the bot list is a drawer over the chat, opened from the top left (D-36 UX bar).
  const drawerOpen = ref(false);
  watch(() => geometry.value.phone, (phone) => {
    if (!phone) drawerOpen.value = false;
  });

  function toggleCompact() {
    shellPreferences.compact = !shellPreferences.compact;
  }

  function resizeSidebar({ x }) {
    if (x < SIDEBAR_COLLAPSE_X) {
      shellPreferences.compact = true;
      shellPreferences.sidebarWidth = SIDEBAR_MIN;
      return;
    }
    shellPreferences.sidebarWidth = clamp(Math.round(x) + 1, SIDEBAR_MIN, SIDEBAR_MAX);
  }

  function resizeDetails({ x }) {
    const width = Math.max(512, display.width.value) - Math.round(x);
    if (width < DETAILS_CLOSE_WIDTH) {
      shellPreferences.detailsOpen = false;
      shellPreferences.detailsWidth = DETAILS_MIN;
      return;
    }
    shellPreferences.detailsWidth = clamp(width, DETAILS_MIN, DETAILS_MAX);
  }

  return { geometry, detailsShown, showDetails, closeDetails, drawerOpen, toggleCompact, resizeSidebar, resizeDetails };
}
