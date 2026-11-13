import { computed, ref } from "vue";
import { ON_IDENTITY } from "@/theme/palettes.js";
import { tileLayout } from "./botDirectory.js";

/** The picture under the pointer while a row is dragged: the bot's initial and name. */
function dragGhost(bot) {
  const ghost = document.createElement("div");
  ghost.className = "mb-drag-ghost";
  ghost.innerHTML = `<span style="background:${bot.color};color:${ON_IDENTITY}">${bot.name.slice(0, 1)}</span><b></b>`;
  ghost.querySelector("b").textContent = bot.name;
  document.body.appendChild(ghost);
  setTimeout(() => ghost.remove(), 0);
  return ghost;
}

/**
 * Drag and drop in the bot list: rows move between groups, tiles reorder with a live
 * preview. A drop emits the command for the shell.
 * @param {{
 *   model: () => import("../../types.js").SidebarModel,
 *   command: (name: string, args?: Record<string, any>) => void
 * }} options
 */
export function useBotDrag({ model, command }) {
  const draggingBotId = ref("");
  const dropGroupKey = ref("");
  const tileOrder = ref(null);
  const tiles = computed(() => {
    if (!tileOrder.value) return model().tiles;
    return tileOrder.value.map((id) => model().tiles.find((bot) => bot.id === id)).filter(Boolean);
  });
  const layout = computed(() => tileLayout(tiles.value.length));

  function startRowDrag(event, bot) {
    draggingBotId.value = bot.id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", bot.id);
    event.dataTransfer.setDragImage(dragGhost(bot), 40, 40);
  }

  function startTileDrag(event, bot) {
    draggingBotId.value = bot.id;
    tileOrder.value = model().tiles.map((tile) => tile.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", bot.id);
  }

  function overTile(target) {
    if (!tileOrder.value || target.id === draggingBotId.value) return;
    const order = tileOrder.value.filter((id) => id !== draggingBotId.value);
    order.splice(order.indexOf(target.id) + (tileOrder.value.indexOf(target.id) > tileOrder.value.indexOf(draggingBotId.value) ? 1 : 0), 0, draggingBotId.value);
    tileOrder.value = order;
  }

  function endDrag() {
    draggingBotId.value = "";
    dropGroupKey.value = "";
    tileOrder.value = null;
  }

  function dropTiles() {
    if (tileOrder.value) command("reorderPins", { botIds: tileOrder.value });
    endDrag();
  }

  function overGroup(group) {
    if (tileOrder.value) return;
    dropGroupKey.value = group.key;
  }

  function dropOnGroup(group) {
    const bot = [...model().groups.flatMap((entry) => entry.bots)].find((entry) => entry.id === draggingBotId.value);
    const sectionId = group.kind === "section" ? group.section.id : null;
    if (bot && bot.sectionId !== sectionId) command("moveBot", { botId: bot.id, sectionId });
    endDrag();
  }

  return { draggingBotId, dropGroupKey, tileOrder, tiles, layout, startRowDrag, startTileDrag, overTile, dropTiles, overGroup, dropOnGroup, endDrag };
}
