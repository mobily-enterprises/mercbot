// Follows a pointer from pointerdown until release, reporting each clientX.
export function trackPointerDrag(event, onMove) {
  const handle = event.currentTarget;
  handle.setPointerCapture(event.pointerId);
  const move = (moveEvent) => onMove(moveEvent.clientX);
  const stop = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", stop);
    handle.removeEventListener("pointercancel", stop);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
}

/** Follows a panel's resize handle, emitting `resize` with each clientX as `{ x }`. */
export function emitResizeDrag(event, emit) {
  trackPointerDrag(event, (x) => emit("resize", { x }));
}
