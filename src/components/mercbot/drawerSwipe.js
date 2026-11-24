// Swiping the phone's chat drawer closed (MercbotDrawer.vue): a touch that moves this far is a swipe, not a tap.
export const SWIPE_START_PX = 10;

/**
 * Whether a swipe that ended `dragged` pixels toward the drawer's edge (negative: left) after `ms` milliseconds closes
 * the drawer, `width` pixels wide: past a third of it, or a quick flick of more than 24 pixels. Anything less springs
 * back, so a finger that only wobbles leaves the drawer open.
 * @param {{ dragged: number, width: number, ms: number }} swipe
 */
export function swipeCloses({ dragged, width, ms }) {
  const distance = -dragged;
  if (distance <= 0) return false;
  if (distance > width / 3) return true;
  return distance > 24 && distance / Math.max(ms, 1) > 0.5;
}
