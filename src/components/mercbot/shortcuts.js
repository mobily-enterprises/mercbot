// Global shortcuts. Browser-reserved keys use our replacements (D-2). Back and forward are
// the browser's own (D-64), so the sheet lists its keys and Mercbot binds none; Ctrl+[ is the Up arrow's.
export const SHORTCUT_GROUPS = [
  {
    title: "Essentials",
    items: [
      { label: "Search", keys: [["Ctrl", "K"], ["Ctrl", "Shift", "F"]] },
      { label: "New bot", keys: [["Ctrl", "Alt", "N"]] },
      { label: "New group chat", keys: [["Ctrl", "Alt", "G"]] },
      { label: "Send message", keys: [["Enter"]], note: "Shift+Enter adds a new line" },
      { label: "Go to bot", keys: [["Ctrl", "Alt", "1…9"]] },
      { label: "Compact sidebar", keys: [["Ctrl", "B"]] },
      { label: "Settings", keys: [["Ctrl", ","]] },
      { label: "Keyboard shortcuts", keys: [["Ctrl", "/"]] }
    ]
  },
  {
    title: "Chat",
    items: [
      { label: "Focus the message box", keys: [["Ctrl", "I"]] },
      { label: "Find in chat", keys: [["Ctrl", "F"]] },
      { label: "Dictate", keys: [["Ctrl", "D"]], note: "Press to start and stop, or hold to talk" },
      { label: "Add selection to message", keys: [["Ctrl", "L"]] }
    ]
  },
  {
    title: "Navigation",
    items: [
      { label: "Previous or next bot", keys: [["Alt", "↑"], ["Alt", "↓"]] },
      { label: "Up", keys: [["Ctrl", "["]], note: "From Apps, an app, a table or Files, as the Up arrow" },
      { label: "Switch bots", keys: [["Ctrl", "Alt", "Tab"]], note: "Keep Ctrl+Alt held, press Tab to move, release to open" }
    ]
  },
  {
    title: "Panels",
    items: [
      { label: "Details", keys: [["Ctrl", "Alt", "B"]] },
      { label: "Skills", keys: [["Ctrl", "Alt", "W"]] },
      { label: "Connect apps", keys: [["Ctrl", "Shift", "M"]] }
    ]
  },
  {
    title: "Browser",
    items: [
      { label: "Zoom", keys: [["Ctrl", "="], ["Ctrl", "−"], ["Ctrl", "0"]], note: "In, out or reset" },
      { label: "Full screen", keys: [["F11"]] },
      { label: "Back or forward", keys: [["Alt", "←"], ["Alt", "→"]] }
    ]
  }
];

const BINDINGS = [
  { action: "search", ctrl: true, code: "KeyK" },
  { action: "search", ctrl: true, shift: true, code: "KeyF" },
  { action: "newBot", ctrl: true, alt: true, code: "KeyN" },
  { action: "newGroup", ctrl: true, alt: true, code: "KeyG" },
  { action: "toggleCompact", ctrl: true, code: "KeyB" },
  { action: "settings", ctrl: true, code: "Comma" },
  { action: "shortcuts", ctrl: true, code: "Slash" },
  { action: "focusComposer", ctrl: true, code: "KeyI" },
  { action: "find", ctrl: true, code: "KeyF" },
  { action: "dictate", ctrl: true, code: "KeyD" },
  { action: "addSelection", ctrl: true, code: "KeyL" },
  { action: "previousBot", alt: true, code: "ArrowUp" },
  { action: "nextBot", alt: true, code: "ArrowDown" },
  { action: "toggleDetails", ctrl: true, alt: true, code: "KeyB" },
  { action: "skills", ctrl: true, alt: true, code: "KeyW" },
  { action: "connectApps", ctrl: true, shift: true, code: "KeyM" }
];

// Returns { action, index? } for a handled key event, or null.
export function matchShortcut(event) {
  const ctrl = Boolean(event.ctrlKey || event.metaKey);
  const alt = Boolean(event.altKey);
  const shift = Boolean(event.shiftKey);
  if (event.code === "Tab" && ctrl && alt) {
    return { action: "switchBots", backwards: shift };
  }
  const digit = /^Digit([1-9])$/u.exec(event.code || "");
  if (digit && ctrl && alt && !shift) {
    return { action: "goToBot", index: Number(digit[1]) - 1 };
  }
  const binding = BINDINGS.find((entry) =>
    entry.code === event.code &&
    Boolean(entry.ctrl) === ctrl &&
    Boolean(entry.alt) === alt &&
    Boolean(entry.shift) === shift
  );
  return binding ? { action: binding.action } : null;
}

// Ctrl+[ (D-64): the shell's Up, on the pages that show its arrow. The home layout handles it, as those pages
// aren't the chat's.
export function isUpKey(event) {
  return event.code === "BracketLeft" && Boolean(event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
}
