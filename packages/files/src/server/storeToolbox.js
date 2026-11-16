import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DESKTOP_GRAPHICS, toolboxRoot, toolboxStore } from "./gvisor.js";

// The bots' toolbox (D-47) on a host whose programs come from a read-only Nix store (MERCBOT_TOOLBOX_STORE, such as
// /nix) instead of Mercbot's own build (scripts/build-toolbox.sh): a small system of links into the store, made in
// MERCBOT_TOOLBOX_DIR at every start (scripts/store-toolbox.mjs, from scripts/serve.sh). Every gVisor sandbox sees the
// store read-only at the same path (gvisor.js storeMounts), so the links work inside. Only links and settings files are
// written and nothing in the toolbox's folder is started from there, but it must be where programs may run: gVisor
// mounts it again as each sandbox's system, which a host's noexec refuses in Mercbot's own user namespace.

// The browsers a computer may use, in order: the first on PATH is the toolbox's /opt/chrome/chrome.
const BROWSERS = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"];
// What a computer's sandbox runs besides the browser: the gateway's forwarder (python3) and the browser's start (sh).
const COMPUTER_PROGRAMS = ["python3", "sh"];
// What bots are told their command line has (botAgent.js, commandTools.js). The command line is offered only when all
// of it is there, so a bot is never told of a tool it doesn't have.
const COMMAND_LINE_PROGRAMS = ["bash", "tmux", "tail", "ffmpeg", "ffprobe", "convert", "tesseract", "pdftotext", "pdftoppm",
  "qpdf", "gs", "pandoc", "python3", "node", "npm", "sqlite3", "jq"];
const COMMAND_LINE_PYTHON = ["pandas", "numpy", "matplotlib", "openpyxl", "docx", "pptx"];

// Programs made for an ordinary Linux system rather than for the store (install-tools.sh's downloads: the Craft apps,
// Piper and Claude Code) start through this loader and look for their libraries in the system's own folders, which a
// store host doesn't have. nix-ld (nixpkgs' nix-ld, on PATH) stands there for them: it starts each one with the store's
// glibc loader (`ld.so` on PATH, from glibc) and the libraries in the folder it reads when nothing names another, so
// no sandbox sets anything for it, and gives the program its own environment back before it starts (nix-ld's
// trampoline), so nothing it runs inherits those libraries. The store's own programs never go through it.
const LOADER = "lib64/ld-linux-x86-64.so.2";
const LOADER_PROGRAMS = ["nix-ld", "ld.so"];
// nix-ld's default NIX_LD_LIBRARY_PATH, which holds its default NIX_LD (ld.so) too.
const NIX_LD_LIBRARIES = "run/current-system/sw/share/nix-ld/lib";
// Mesa's software drivers for the office apps' windows (lavapipe's Vulkan and Mesa's EGL): the manifest of each in
// nixpkgs' mesa (MERCBOT_TOOLBOX_MESA), which names its library at its store path, at the place the desktop sandbox
// names it.
const MESA_MANIFESTS = [
  ["share/vulkan/icd.d/lvp_icd.x86_64.json", DESKTOP_GRAPHICS.vulkan],
  ["share/glvnd/egl_vendor.d/50_mesa.json", DESKTOP_GRAPHICS.egl]
];

// Which fonts stand in for the families pages ask for most, when the store has them; a fontconfig package's own rules,
// where the store has one, say more.
const FAMILIES = [
  ["sans-serif", "Liberation Sans", "DejaVu Sans", "Noto Sans"],
  ["serif", "Liberation Serif", "DejaVu Serif", "Noto Serif"],
  ["monospace", "Liberation Mono", "DejaVu Sans Mono", "Noto Sans Mono"],
  ["Arial", "Liberation Sans"],
  ["Helvetica", "Liberation Sans"],
  ["Times New Roman", "Liberation Serif"],
  ["Courier New", "Liberation Mono"]
];

const inside = (file, folder) => file === folder || file.startsWith(`${folder}${path.sep}`);
const realOrNull = (file) => {
  try {
    return realpathSync(file);
  } catch {
    return null;
  }
};
const exists = (file) => {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
};
const isFolder = (file) => {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
};
const isProgram = (file) => {
  try {
    const found = statSync(file);
    return found.isFile() && (found.mode & 0o111) !== 0;
  } catch {
    return false;
  }
};

/**
 * Each program on `searchPath` whose file is in `store`, by name, the first found for each, at its real path (so the
 * link works where only the store is): a program found outside the store doesn't take its name.
 * @param {string} searchPath
 * @param {string} store
 * @returns {Map<string, string>}
 */
export function storePrograms(searchPath, store) {
  const programs = new Map();
  for (const dir of searchPath.split(":").filter(Boolean)) {
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (programs.has(name)) continue;
      const real = realOrNull(path.join(dir, name));
      if (real && inside(real, store) && isProgram(real)) programs.set(name, real);
    }
  }
  if (!programs.has("sh") && programs.has("bash")) programs.set("sh", programs.get("bash"));
  return programs;
}

/**
 * Mesa's driver manifests in `dir` (MERCBOT_TOOLBOX_MESA, Mesa's folder in the store), each at its real path with the
 * place a desktop sandbox looks for it; none without `dir`. Mesa is named on purpose, so a folder that isn't Mesa's in
 * the store stops the toolbox, naming what it lacks, rather than leave the office apps without windows.
 * @param {string} dir
 * @param {string} store
 * @returns {[string, string][]}
 */
export function mesaManifests(dir, store) {
  if (!dir) return [];
  const real = realOrNull(dir);
  if (!real || !isFolder(real) || !inside(real, store)) throw new Error(`MERCBOT_TOOLBOX_MESA names ${dir}, which isn't a folder in the store (${store}).`);
  return MESA_MANIFESTS.map(([manifest, place]) => {
    const file = realOrNull(path.join(real, manifest));
    if (!file || !inside(file, store) || !statSync(file).isFile()) throw new Error(`MERCBOT_TOOLBOX_MESA names ${dir}, which has no ${manifest}.`);
    return [file, place];
  });
}

/**
 * The libraries in `folders` (MERCBOT_TOOLBOX_LIBRARIES: folders separated by `:`, as in LD_LIBRARY_PATH), by name, the
 * first found for each, at its real path in `store`, for the programs nix-ld starts. Each folder is named on purpose, so
 * one that isn't a folder in the store stops the toolbox, naming it, rather than leave those programs without it.
 * @param {string} folders
 * @param {string} store
 * @returns {Map<string, string>}
 */
export function storeLibraries(folders, store) {
  const libraries = new Map();
  for (const dir of folders.split(":").filter(Boolean)) {
    const real = realOrNull(dir);
    if (!real || !isFolder(real) || !inside(real, store)) {
      throw new Error(`MERCBOT_TOOLBOX_LIBRARIES names ${dir}, which isn't a folder in the store (${store}).`);
    }
    for (const name of readdirSync(real).sort()) {
      if (libraries.has(name) || !/^lib.*\.so(\.\d+)*$/u.test(name)) continue;
      const file = realOrNull(path.join(real, name));
      if (file && inside(file, store) && statSync(file).isFile()) libraries.set(name, file);
    }
  }
  return libraries;
}

/**
 * The store's font folders (`share/fonts` of each package), and a fontconfig package's own rules (`etc/fonts/conf.d`:
 * which font stands in for Arial, sans-serif and the like), as a fonts.conf for the toolbox and the desktops' programs.
 * Fonts have no program on PATH, so they're found in the store, which holds only what the host was given.
 * @param {string} store
 */
function fontsConf(store) {
  const packages = isFolder(path.join(store, "store")) ? path.join(store, "store") : store;
  const folders = [];
  let rules = "";
  for (const name of readdirSync(packages).sort()) {
    if (isFolder(path.join(packages, name, "share", "fonts"))) folders.push(path.join(packages, name, "share", "fonts"));
    if (!rules && /-fontconfig-\d/u.test(name) && isFolder(path.join(packages, name, "etc", "fonts", "conf.d"))) {
      rules = path.join(packages, name, "etc", "fonts", "conf.d");
    }
  }
  const lines = [
    ...folders.map((folder) => `  <dir>${folder}</dir>`),
    ...(rules ? [`  <include ignore_missing="yes">${rules}</include>`] : []),
    ...FAMILIES.map(([family, ...prefer]) => `  <alias><family>${family}</family><prefer>${prefer.map((name) => `<family>${name}</family>`).join("")}</prefer></alias>`),
    "  <cachedir prefix=\"xdg\">fontconfig</cachedir>"
  ];
  return {
    fonts: folders.length,
    text: `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n<fontconfig>\n${lines.join("\n")}\n</fontconfig>\n`
  };
}

/**
 * Whether `folder` (or, while it doesn't exist, the folder it would be made in) is on a mount where programs can't run
 * (noexec), by `mountinfo` (this process's /proc/self/mountinfo): the last mount on the longest mount point above it.
 * @param {string} folder
 * @param {string} [mountinfo]
 */
export function mountedNoexec(folder, mountinfo) {
  let dir = path.resolve(folder);
  while (!exists(dir) && dir !== path.dirname(dir)) dir = path.dirname(dir);
  const real = realOrNull(dir) || dir;
  let text = mountinfo;
  try {
    text ??= readFileSync("/proc/self/mountinfo", "utf8");
  } catch {
    return false;
  }
  let found = null;
  for (const line of text.split("\n")) {
    const fields = line.split(" ");
    if (fields.length < 6) continue;
    const point = fields[4].replace(/\\([0-7]{3})/gu, (_, code) => String.fromCharCode(Number.parseInt(code, 8)));
    const above = point === "/" || real === point || real.startsWith(`${point}/`);
    if (above && (!found || point.length >= found.point.length)) found = { point, options: fields[5].split(",") };
  }
  return Boolean(found?.options.includes("noexec"));
}

/** Whether `python3` has every module bots are told of; the store's own program, so it may run here. */
function pythonHas(python3) {
  try {
    execFileSync(python3, ["-c", `import ${COMMAND_LINE_PYTHON.join(", ")}`], { stdio: "ignore", timeout: 120000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes the toolbox in MERCBOT_TOOLBOX_DIR from the programs on PATH that are in MERCBOT_TOOLBOX_STORE: each as
 * usr/bin/<name> (bin and sbin lead there), the browser as opt/chrome/chrome, a fonts.conf with the store's fonts, and
 * the few files a system has in etc; with nix-ld and ld.so on PATH, the loader programs made for an ordinary Linux
 * system ask for, with MERCBOT_TOOLBOX_LIBRARIES' libraries where it finds them; and MERCBOT_TOOLBOX_MESA's driver
 * manifests where a desktop sandbox looks for them. The command line's stamp
 * (etc/mercbot-toolbox, shellAvailable) is written only when every tool bots are told of is there. The new toolbox
 * replaces the old one whole. Returns what it found: `computers` is false, with `missing` naming why, when bots'
 * computers can't start with it; `loader` is false, with `missing.loader`, when such programs can't start; `graphics`
 * is whether it has Mesa's drivers.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @returns {{ programs: number, fonts: number, computers: boolean, commandLine: boolean, loader: boolean, libraries: number, graphics: boolean, missing: { computers: string[], commandLine: string[], loader: string[] } }}
 */
export function makeStoreToolbox(env) {
  const store = toolboxStore(env);
  if (!store) throw new Error("MERCBOT_TOOLBOX_STORE isn't set, so there's no store to make the toolbox from.");
  if (!isFolder(store)) throw new Error(`MERCBOT_TOOLBOX_STORE is ${store}, which isn't a folder.`);
  if (!String(env.MERCBOT_TOOLBOX_DIR || "").trim()) throw new Error("MERCBOT_TOOLBOX_DIR isn't set: it names the folder the toolbox is made in.");
  const root = toolboxRoot(env);
  if (inside(root, store)) throw new Error(`MERCBOT_TOOLBOX_DIR (${root}) is in the store, which is read-only.`);
  // Nothing in the toolbox is started from its folder, but gVisor mounts it again, read-only, as each sandbox's
  // system, and in Mercbot's own user namespace the host refuses that mount on a folder where it forbids programs.
  if (mountedNoexec(path.dirname(root))) {
    throw new Error(`MERCBOT_TOOLBOX_DIR (${root}) is on a folder where this host forbids programs (noexec), where gVisor can't use it as its sandboxes' system: put it where programs may run.`);
  }
  const programs = storePrograms(String(env.PATH || ""), store);
  const libraries = storeLibraries(String(env.MERCBOT_TOOLBOX_LIBRARIES || ""), store);
  const graphics = mesaManifests(String(env.MERCBOT_TOOLBOX_MESA || "").trim(), store);
  const fresh = `${root}.new`;
  rmSync(fresh, { recursive: true, force: true });
  for (const dir of ["usr/bin", "usr/local/bin", "etc/fonts", "opt/chrome", "proc", "dev", "sys", "tmp", "root", store.slice(1)]) {
    mkdirSync(path.join(fresh, dir), { recursive: true });
  }
  symlinkSync("usr/bin", path.join(fresh, "bin"));
  symlinkSync("usr/bin", path.join(fresh, "sbin"));
  for (const [name, real] of programs) symlinkSync(real, path.join(fresh, "usr", "bin", name));
  const browser = BROWSERS.find((name) => programs.has(name));
  if (browser) symlinkSync(programs.get(browser), path.join(fresh, "opt", "chrome", "chrome"));
  const loader = LOADER_PROGRAMS.every((name) => programs.has(name));
  if (loader) {
    mkdirSync(path.join(fresh, path.dirname(LOADER)));
    symlinkSync(programs.get("nix-ld"), path.join(fresh, LOADER));
    mkdirSync(path.join(fresh, NIX_LD_LIBRARIES), { recursive: true });
    symlinkSync(programs.get("ld.so"), path.join(fresh, NIX_LD_LIBRARIES, "ld.so"));
    for (const [name, real] of libraries) symlinkSync(real, path.join(fresh, NIX_LD_LIBRARIES, name));
  }
  for (const [real, place] of graphics) {
    mkdirSync(path.join(fresh, path.dirname(place)), { recursive: true });
    symlinkSync(real, path.join(fresh, place));
  }
  const fonts = fontsConf(store);
  writeFileSync(path.join(fresh, "etc", "fonts", "fonts.conf"), fonts.text);
  writeFileSync(path.join(fresh, "etc", "passwd"), "root:x:0:0:root:/root:/bin/sh\nnobody:x:65534:65534:nobody:/nonexistent:/bin/false\n");
  writeFileSync(path.join(fresh, "etc", "group"), "root:x:0:\nnogroup:x:65534:\n");
  writeFileSync(path.join(fresh, "etc", "hosts"), "127.0.0.1 localhost\n::1 localhost\n");
  const missing = {
    computers: [...(browser ? [] : ["chromium"]), ...COMPUTER_PROGRAMS.filter((name) => !programs.has(name))],
    commandLine: COMMAND_LINE_PROGRAMS.filter((name) => !programs.has(name)),
    loader: LOADER_PROGRAMS.filter((name) => !programs.has(name))
  };
  if (!missing.commandLine.length && !pythonHas(programs.get("python3"))) {
    missing.commandLine.push(`python3's ${COMMAND_LINE_PYTHON.join(", ")}`);
  }
  const commandLine = missing.commandLine.length === 0;
  if (commandLine) writeFileSync(path.join(fresh, "etc", "mercbot-toolbox"), `store ${store}\n`);
  rmSync(`${root}.old`, { recursive: true, force: true });
  if (exists(root)) renameSync(root, `${root}.old`);
  renameSync(fresh, root);
  rmSync(`${root}.old`, { recursive: true, force: true });
  return {
    programs: programs.size,
    fonts: fonts.fonts,
    computers: missing.computers.length === 0,
    commandLine,
    loader,
    libraries: loader ? libraries.size : 0,
    graphics: graphics.length > 0,
    missing
  };
}
