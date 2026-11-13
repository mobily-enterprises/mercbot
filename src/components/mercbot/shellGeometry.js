// The shell's layout rules: the sidebar, rail, chat and details columns and when each gives way (D-1).
export const SIDEBAR_MIN = 240;
export const SIDEBAR_MAX = 400;
export const SIDEBAR_COLLAPSE_X = 210;
export const RAIL_WIDTH = 88;
export const RAIL_FORCED_BELOW = 704;
export const DETAILS_MIN = 280;
export const DETAILS_MAX = 336;
export const DETAILS_CLOSE_WIDTH = 235;
export const CHAT_MIN = 424;
export const COLUMN_MAX = 960;
// Below this the window is a phone: the chat fills it, the bot list slides in as a drawer and
// the details open over the chat.
export const PHONE_BELOW = 600;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function computeShellGeometry({ viewportWidth, compact, sidebarWidth, detailsOpen, detailsWidth }) {
  if (viewportWidth < PHONE_BELOW) {
    return {
      phone: true,
      railForced: true,
      compact: false,
      sidebarWidth: Math.min(SIDEBAR_MAX, viewportWidth - 48),
      detailsVisible: false,
      detailsWidth: 0,
      chatWidth: viewportWidth,
      columnWidth: viewportWidth - 24
    };
  }
  const railForced = viewportWidth < RAIL_FORCED_BELOW;
  const isCompact = railForced || compact;
  const sidebar = isCompact ? RAIL_WIDTH : clamp(sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX);
  const detailsVisible = detailsOpen && viewportWidth - sidebar - DETAILS_MIN >= CHAT_MIN;
  const details = detailsVisible
    ? clamp(viewportWidth - sidebar - CHAT_MIN, DETAILS_MIN, clamp(detailsWidth, DETAILS_MIN, DETAILS_MAX))
    : 0;
  const chat = viewportWidth - sidebar - details;
  return {
    phone: false,
    railForced,
    compact: isCompact,
    sidebarWidth: sidebar,
    detailsVisible,
    detailsWidth: details,
    chatWidth: chat,
    columnWidth: Math.min(COLUMN_MAX, chat - 32)
  };
}
