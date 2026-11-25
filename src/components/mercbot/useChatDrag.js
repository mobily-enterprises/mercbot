import { computed, ref } from "vue";
import { tileLayout } from "./chatDirectory.js";

/** The picture under the pointer while a row is dragged: the chat's initial and name. */
function dragGhost(title) {
  const ghost = document.createElement("div");
  ghost.className = "mb-drag-ghost";
  ghost.innerHTML = "<span></span><b></b>";
  ghost.querySelector("span").textContent = title.slice(0, 1);
  ghost.querySelector("b").textContent = title;
  document.body.appendChild(ghost);
  setTimeout(() => ghost.remove(), 0);
  return ghost;
}

/**
 * Drag and drop in the chat list: rows move between groups, the pinned chats' tiles reorder with a live preview. The
 * everyone chat is no tile (D-135): it's Rooms' first row, never dragged. A drop emits the command for the shell.
 * @param {{
 *   model: () => import("../../types.js").SidebarModel,
 *   command: (name: string, args?: Record<string, any>) => void,
 *   titleOf: (chat: import("../../types.js").Chat) => string
 * }} options
 */
export function useChatDrag({ model, command, titleOf }) {
  const draggingChatId = ref("");
  const dropGroupKey = ref("");
  const tileOrder = ref(null);
  const tiles = computed(() => {
    if (!tileOrder.value) return model().tiles;
    return tileOrder.value.map((id) => model().tiles.find((chat) => chat.id === id)).filter(Boolean);
  });
  const layout = computed(() => tileLayout(tiles.value.length));

  function startRowDrag(event, chat) {
    draggingChatId.value = chat.id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", chat.id);
    event.dataTransfer.setDragImage(dragGhost(titleOf(chat)), 40, 40);
  }

  function startTileDrag(event, chat) {
    draggingChatId.value = chat.id;
    tileOrder.value = model().tiles.map((tile) => tile.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", chat.id);
  }

  function overTile(target) {
    if (!tileOrder.value || target.id === draggingChatId.value) return;
    const order = tileOrder.value.filter((id) => id !== draggingChatId.value);
    const after = tileOrder.value.indexOf(target.id) > tileOrder.value.indexOf(draggingChatId.value) ? 1 : 0;
    order.splice(order.indexOf(target.id) + after, 0, draggingChatId.value);
    tileOrder.value = order;
  }

  function endDrag() {
    draggingChatId.value = "";
    dropGroupKey.value = "";
    tileOrder.value = null;
  }

  function dropTiles() {
    if (tileOrder.value) command("reorderPins", { chatIds: tileOrder.value });
    endDrag();
  }

  function overGroup(group) {
    if (tileOrder.value) return;
    dropGroupKey.value = group.key;
  }

  function dropOnGroup(group) {
    const chat = model().groups.flatMap((entry) => entry.chats).find((entry) => entry.id === draggingChatId.value);
    const sectionId = group.kind === "section" ? group.section.id : null;
    if (chat && chat.sectionId !== sectionId) command("moveChat", { chatId: chat.id, sectionId });
    endDrag();
  }

  return { draggingChatId, dropGroupKey, tileOrder, tiles, layout, startRowDrag, startTileDrag, overTile, dropTiles, overGroup, dropOnGroup, endDrag };
}
