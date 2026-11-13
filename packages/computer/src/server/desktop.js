import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { quote } from "./shellQuote.js";

// The bot's computer as a small desktop the person can use (D-23): our wallpaper, a translucent
// top bar with the open windows and a clock, a dock of apps centred at the bottom, and windows
// with red, yellow and green close, minimise and zoom buttons on the left. openbox draws the windows, tint2 the
// two bars, hsetroot the wallpaper. Apps open filling the space between the bars. Everything is written fresh into `dir` on every wake.
const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets");
const FONT = "Nimbus Sans";

/**
 * A system program, or the copy scripts/install-tools.sh unpacked when the system had none.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env For the tools folder and PATH.
 * @param {string} name
 */
export function program(env, name) {
  const tools = path.resolve(env.MERCBOT_TOOLS_DIR || ".tools");
  const unpacked = path.join(tools, "desktop", "usr", "bin", name);
  if (existsSync(unpacked)) return unpacked;
  return (env.PATH || "").split(":").map((dir) => path.join(dir, name)).find((candidate) => existsSync(candidate)) || null;
}

const COLOURS = { close: "#FF5F57", iconify: "#FEBC2E", max: "#28C840" };

function themerc() {
  const buttons = Object.entries(COLOURS).flatMap(([button, colour]) => [
    `window.active.button.${button}.unpressed.image.color: ${colour}`,
    `window.active.button.${button}.hover.image.color: ${colour}`,
    `window.active.button.${button}.pressed.image.color: ${colour}`
  ]);
  return `border.width: 1
padding.width: 10
padding.height: 7
window.handle.width: 0
window.client.padding.width: 0
window.client.padding.height: 0
window.active.border.color: #B4B4B8
window.inactive.border.color: #CDCDD0
window.active.title.separator.color: #D2D2D6
window.inactive.title.separator.color: #E2E2E5
window.active.title.bg: Flat Gradient Vertical
window.active.title.bg.color: #F2F2F4
window.active.title.bg.colorTo: #E4E4E7
window.inactive.title.bg: Flat Solid
window.inactive.title.bg.color: #F6F6F7
window.active.label.bg: Parentrelative
window.inactive.label.bg: Parentrelative
window.active.label.text.color: #2C2C2E
window.inactive.label.text.color: #A1A1A6
window.label.text.justify: center
window.active.button.unpressed.bg: Parentrelative
window.active.button.hover.bg: Parentrelative
window.active.button.pressed.bg: Parentrelative
window.active.button.disabled.bg: Parentrelative
window.active.button.toggled.unpressed.bg: Parentrelative
window.active.button.toggled.hover.bg: Parentrelative
window.active.button.toggled.pressed.bg: Parentrelative
window.active.button.unpressed.image.color: #8E8E93
window.active.button.hover.image.color: #8E8E93
window.active.button.pressed.image.color: #6E6E73
window.active.button.disabled.image.color: #D1D1D6
window.active.button.toggled.unpressed.image.color: #28C840
window.active.button.toggled.hover.image.color: #28C840
window.active.button.toggled.pressed.image.color: #28C840
${buttons.join("\n")}
window.inactive.button.unpressed.bg: Parentrelative
window.inactive.button.hover.bg: Parentrelative
window.inactive.button.pressed.bg: Parentrelative
window.inactive.button.disabled.bg: Parentrelative
window.inactive.button.toggled.unpressed.bg: Parentrelative
window.inactive.button.toggled.hover.bg: Parentrelative
window.inactive.button.toggled.pressed.bg: Parentrelative
window.inactive.button.unpressed.image.color: #D1D1D6
window.inactive.button.hover.image.color: #D1D1D6
window.inactive.button.pressed.image.color: #D1D1D6
window.inactive.button.disabled.image.color: #E5E5EA
window.inactive.button.toggled.unpressed.image.color: #D1D1D6
window.inactive.button.toggled.hover.image.color: #D1D1D6
window.inactive.button.toggled.pressed.image.color: #D1D1D6
window.active.handle.bg: Flat Solid
window.active.handle.bg.color: #E4E4E7
window.inactive.handle.bg: Flat Solid
window.inactive.handle.bg.color: #F6F6F7
window.active.grip.bg: Flat Solid
window.active.grip.bg.color: #E4E4E7
window.inactive.grip.bg: Flat Solid
window.inactive.grip.bg.color: #F6F6F7
menu.border.width: 1
menu.border.color: #D1D1D6
menu.separator.color: #E5E5EA
menu.separator.padding.height: 4
menu.items.bg: Flat Solid
menu.items.bg.color: #F9F9FB
menu.items.text.color: #1D1D1F
menu.items.disabled.text.color: #A1A1A6
menu.items.active.bg: Flat Solid
menu.items.active.bg.color: #2F6FE4
menu.items.active.text.color: #FFFFFF
menu.title.bg: Flat Solid
menu.title.bg.color: #F9F9FB
menu.title.text.color: #8E8E93
menu.title.text.justify: left
osd.border.width: 1
osd.border.color: #D1D1D6
osd.bg: Flat Solid
osd.bg.color: #F9F9FB
osd.label.bg: Parentrelative
osd.label.text.color: #1D1D1F
osd.hilight.bg: Flat Solid
osd.hilight.bg.color: #2F6FE4
osd.unhilight.bg: Flat Solid
osd.unhilight.bg.color: #D1D1D6
`;
}

// Alt-Tab goes to the next window, focused and raised.
const ALT_TAB = '<keybind key="A-Tab"><action name="NextWindow"><finalactions><action name="Focus"/><action name="Raise"/>' +
  '<action name="Unshade"/></finalactions></action></keybind>';

function rcXml(menuFile) {
  const font = (place, size, weight = "Normal") =>
    `<font place="${place}"><name>${FONT}</name><size>${size}</size><weight>${weight}</weight><slant>Normal</slant></font>`;
  const button = (name, action) =>
    `<context name="${name}"><mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind>` +
    `<mousebind button="Left" action="Click"><action name="${action}"/></mousebind></context>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <resistance><strength>10</strength><screen_edge_strength>20</screen_edge_strength></resistance>
  <focus><focusNew>yes</focusNew><followMouse>no</followMouse></focus>
  <placement><policy>Smart</policy><center>yes</center></placement>
  <theme>
    <name>Mercbot</name>
    <titleLayout>CIML</titleLayout>
    <keepBorder>yes</keepBorder>
    <animateIconify>yes</animateIconify>
    ${font("ActiveWindow", 10, "Bold")}
    ${font("InactiveWindow", 10, "Bold")}
    ${font("MenuHeader", 9)}
    ${font("MenuItem", 10)}
    ${font("ActiveOnScreenDisplay", 10)}
    ${font("InactiveOnScreenDisplay", 10)}
  </theme>
  <desktops><number>1</number><firstdesk>1</firstdesk><popupTime>0</popupTime></desktops>
  <resize><drawContents>yes</drawContents></resize>
  <margins><top>0</top><bottom>0</bottom><left>0</left><right>0</right></margins>
  <keyboard>
    ${ALT_TAB}
    <keybind key="A-F4"><action name="Close"/></keybind>
  </keyboard>
  <mouse>
    <dragThreshold>3</dragThreshold>
    <doubleClickTime>400</doubleClickTime>
    <context name="Frame">
      <mousebind button="A-Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind>
      <mousebind button="A-Left" action="Drag"><action name="Move"/></mousebind>
    </context>
    <context name="Titlebar">
      <mousebind button="Left" action="Drag"><action name="Move"/></mousebind>
      <mousebind button="Left" action="DoubleClick"><action name="ToggleMaximize"/></mousebind>
    </context>
    <context name="Titlebar Top Right Bottom Left TLCorner TRCorner BRCorner BLCorner">
      <mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/><action name="Unshade"/></mousebind>
    </context>
    <context name="Top"><mousebind button="Left" action="Drag"><action name="Resize"><edge>top</edge></action></mousebind></context>
    <context name="Left"><mousebind button="Left" action="Drag"><action name="Resize"><edge>left</edge></action></mousebind></context>
    <context name="Right"><mousebind button="Left" action="Drag"><action name="Resize"><edge>right</edge></action></mousebind></context>
    <context name="Bottom"><mousebind button="Left" action="Drag"><action name="Resize"><edge>bottom</edge></action></mousebind></context>
    <context name="TRCorner BRCorner TLCorner BLCorner"><mousebind button="Left" action="Drag"><action name="Resize"/></mousebind></context>
    <context name="Client">
      <mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind>
      <mousebind button="Right" action="Press"><action name="Focus"/><action name="Raise"/></mousebind>
    </context>
    ${button("Close", "Close")}
    ${button("Iconify", "Iconify")}
    ${button("Maximize", "ToggleMaximize")}
    <context name="Root">
      <mousebind button="Right" action="Press"><action name="ShowMenu"><menu>root-menu</menu></action></mousebind>
    </context>
  </mouse>
  <menu><file>${menuFile}</file><hideDelay>200</hideDelay><middle>no</middle><showIcons>yes</showIcons></menu>
  <applications>
    <application class="*" type="normal"><maximized>yes</maximized></application>
  </applications>
</openbox_config>
`;
}

function menuXml(launchers) {
  const items = launchers.map((launcher) =>
    `<item label="${launcher.label}" icon="${launcher.icon}"><action name="Execute">` +
    `<command>${launcher.script}</command></action></item>`).join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<openbox_menu xmlns="http://openbox.org/3.4/menu">
  <menu id="root-menu" label="Apps">
    ${items}
  </menu>
</openbox_menu>
`;
}

/** tint2 colours are "#RRGGBB alpha%"; the bars look through to the wallpaper (it copies it). */
function topBar() {
  return `# Background 1: the bar
rounded = 0
border_width = 0
background_color = #FFFFFF 58
border_color = #FFFFFF 0
# Background 2: the window in front
rounded = 6
border_width = 0
background_color = #000000 10
border_color = #000000 0
background_color_hover = #000000 14
# Background 3: other windows
rounded = 6
border_width = 0
background_color = #000000 0
border_color = #000000 0
background_color_hover = #000000 8

panel_items = PTC
panel_size = 100% 28
panel_margin = 0 0
panel_padding = 10 3 8
panel_background_id = 1
panel_position = top center horizontal
panel_layer = top
panel_window_name = Mercbot top bar
strut_policy = follow_size
wm_menu = 1
panel_dock = 0
disable_transparency = 0
mouse_effects = 1

button = new
button_text = Mercbot
button_font = ${FONT} Bold 10
button_font_color = #1D1D1F 100
button_padding = 6 0
button_background_id = 0
button_max_icon_size = 0

taskbar_mode = single_desktop
taskbar_padding = 6 0 4
taskbar_background_id = 0
taskbar_active_background_id = 0
taskbar_name = 0
taskbar_hide_inactive_tasks = 0
taskbar_distribute_size = 0
task_text = 1
task_icon = 1
task_centered = 0
task_maximum_size = 220 22
task_padding = 8 2 6
task_font = ${FONT} 9
task_font_color = #1D1D1F 85
task_active_font_color = #1D1D1F 100
task_iconified_font_color = #1D1D1F 50
task_icon_asb = 100 0 0
task_background_id = 3
task_active_background_id = 2
task_iconified_background_id = 3
task_tooltip = 0
mouse_left = toggle_iconify
mouse_middle = close
mouse_right = none

time1_format = %a %-d %b   %H:%M
time1_font = ${FONT} 10
clock_font_color = #1D1D1F 100
clock_padding = 8 0
clock_background_id = 0
`;
}

function dock(launchers) {
  return `# Background 1: the dock
rounded = 18
border_width = 1
background_color = #FFFFFF 30
border_color = #FFFFFF 55
# Background 2: an app's icon
rounded = 12
border_width = 0
background_color = #FFFFFF 0
border_color = #FFFFFF 0
background_color_hover = #FFFFFF 30
background_color_pressed = #FFFFFF 45
# Background 3: tooltips
rounded = 6
border_width = 1
background_color = #F9F9FB 96
border_color = #D1D1D6 100

panel_items = L
panel_size = 100% 72
panel_shrink = 1
panel_margin = 0 8
panel_padding = 10 8 6
panel_background_id = 1
panel_position = bottom center horizontal
panel_layer = top
panel_window_name = Mercbot dock
strut_policy = follow_size
wm_menu = 0
panel_dock = 0
disable_transparency = 0
mouse_effects = 1
mouse_hover_icon_asb = 100 0 12
mouse_pressed_icon_asb = 100 0 -12

launcher_padding = 0 0 6
launcher_background_id = 0
launcher_icon_background_id = 2
launcher_icon_size = 52
launcher_icon_asb = 100 0 0
launcher_tooltip = 1
startup_notifications = 0
${launchers.map((launcher) => `launcher_item_app = ${launcher.desktopFile}`).join("\n")}

tooltip_show_timeout = 0.3
tooltip_hide_timeout = 0.1
tooltip_padding = 8 4
tooltip_background_id = 3
tooltip_font = ${FONT} 10
tooltip_font_color = #1D1D1F 100
`;
}

/** `launchers`: [{id, label, icon, argv}] for the dock and the desktop's right-click menu. */
export async function startDesktop({ dir, display, env, launchers }) {
  await rm(dir, { recursive: true, force: true });
  const theme = path.join(dir, "share", "themes", "Mercbot", "openbox-3");
  await mkdir(theme, { recursive: true });
  await writeFile(path.join(theme, "themerc"), themerc());

  const placed = [];
  for (const launcher of launchers) {
    const script = path.join(dir, `launch-${launcher.id}.sh`);
    await writeFile(script, `#!/bin/sh\nexec ${launcher.argv.map(quote).join(" ")} "$@"\n`);
    await chmod(script, 0o755);
    const desktopFile = path.join(dir, `${launcher.id}.desktop`);
    await writeFile(desktopFile, `[Desktop Entry]\nType=Application\nName=${launcher.label}\nExec=${script}\nIcon=${launcher.icon}\n`);
    placed.push({ ...launcher, script, desktopFile });
  }
  await writeFile(path.join(dir, "menu.xml"), menuXml(placed));
  await writeFile(path.join(dir, "rc.xml"), rcXml(path.join(dir, "menu.xml")));
  await writeFile(path.join(dir, "top.tint2rc"), topBar());
  await writeFile(path.join(dir, "dock.tint2rc"), dock(placed));

  const desktopEnv = { ...env, DISPLAY: `:${display}`, XDG_DATA_HOME: path.join(dir, "share"), XDG_CONFIG_HOME: path.join(dir, "config") };
  const start = (command, args) => {
    const child = spawn(command, args, { env: desktopEnv, stdio: "ignore" });
    child.once("error", () => {});
    return child;
  };
  const children = [start(env.MERCBOT_OPENBOX || "openbox", ["--config-file", path.join(dir, "rc.xml")])];
  const hsetroot = program(env, "hsetroot");
  if (hsetroot) start(hsetroot, ["-cover", path.join(ASSETS, "wallpaper.png")]);
  const tint2 = program(env, "tint2");
  if (tint2) {
    // The bars copy the wallpaper to look through it, so they start once it's set.
    await new Promise((resolve) => setTimeout(resolve, 300));
    children.push(start(tint2, ["-c", path.join(dir, "top.tint2rc")]), start(tint2, ["-c", path.join(dir, "dock.tint2rc")]));
  }
  return children;
}

export const BROWSER_ICON = path.join(ASSETS, "browser.svg");
export const TERMINAL_ICON = path.join(ASSETS, "terminal.svg");
