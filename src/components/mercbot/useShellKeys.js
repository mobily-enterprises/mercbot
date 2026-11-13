import { onBeforeUnmount, onMounted, ref } from "vue";
import { matchShortcut } from "./shortcuts.js";

/**
 * The shell's keyboard. `actions` runs a shortcut's action by name,
 * `visualOrder` is the sidebar's bot order and `currentBotId` the open bot, `selectBot` and
 * `selectIndex` open a bot by id or position. `paletteOpen` is the search palette, `overlayOpen`
 * says a dialog has the keyboard, `detailsDismissable` says Escape may close the docked details
 * and `closeDetails` does it, and `releaseDictation` ends a held Ctrl+D.
 * @param {object} options
 * @param {Record<string, () => void>} options.actions
 * @param {import("vue").ComputedRef<string[]>} options.visualOrder
 * @param {() => string} options.currentBotId
 * @param {(id: string) => void} options.selectBot
 * @param {(index: number) => void} options.selectIndex
 * @param {import("vue").Ref<boolean>} options.paletteOpen
 * @param {() => boolean} options.overlayOpen
 * @param {() => boolean} options.detailsDismissable
 * @param {() => void} options.closeDetails
 * @param {() => void} options.releaseDictation
 */
export function useShellKeys({
  actions,
  visualOrder,
  currentBotId,
  selectBot,
  selectIndex,
  paletteOpen,
  overlayOpen,
  detailsDismissable,
  closeDetails,
  releaseDictation
}) {
  // Ctrl+Alt shows each bot's position; Tab moves a ring while the modifier is held.
  const positionHints = ref(false);
  const switchHighlightId = ref("");

  // Switch Bots: releasing the modifier opens the ringed bot.
  function switchBots(step) {
    const order = visualOrder.value;
    if (!order.length) return;
    const from = order.indexOf(switchHighlightId.value || currentBotId());
    switchHighlightId.value = order[(from + step + order.length) % order.length];
  }

  function onKeydown(event) {
    positionHints.value = event.ctrlKey && event.altKey;
    if (event.key === "Escape" && detailsDismissable()) {
      const typing = /^(INPUT|TEXTAREA)$/u.test(document.activeElement?.tagName || "");
      const overlay = document.querySelector(".v-overlay--active");
      if (!typing && !overlay) {
        closeDetails();
        return;
      }
    }
    const match = matchShortcut(event);
    if (!match) return;
    // Ctrl+K closes the palette as well as opening it.
    if (paletteOpen.value && match.action === "search" && event.code === "KeyK") {
      event.preventDefault();
      paletteOpen.value = false;
      return;
    }
    if (overlayOpen() && match.action !== "shortcuts") return;
    event.preventDefault();
    // Holding Ctrl+D talks until release: only the first press counts.
    if (match.action === "dictate" && event.repeat) return;
    if (match.action === "goToBot") {
      selectIndex(match.index);
    } else if (match.action === "switchBots") {
      switchBots(match.backwards ? -1 : 1);
    } else {
      actions[match.action]();
    }
  }

  function onKeyup(event) {
    if (event.code === "KeyD") releaseDictation();
    positionHints.value = event.ctrlKey && event.altKey;
    if (!positionHints.value && switchHighlightId.value) {
      selectBot(switchHighlightId.value);
      switchHighlightId.value = "";
    }
  }

  function hideHints() {
    positionHints.value = false;
    switchHighlightId.value = "";
  }

  onMounted(() => {
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("keyup", onKeyup);
    window.addEventListener("blur", hideHints);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKeydown);
    window.removeEventListener("keyup", onKeyup);
    window.removeEventListener("blur", hideHints);
  });

  return { positionHints, switchHighlightId };
}
