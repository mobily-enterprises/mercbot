import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { desktopSandboxAvailable, startDesktopSandbox } from "../../packages/computer/src/server/desktopSandbox.js";
import { DESKTOP_GRAPHICS, sandboxSpec, shellAvailable } from "../../packages/files/src/server/gvisor.js";
import { makeStoreToolbox, mountedNoexec } from "../../packages/files/src/server/storeToolbox.js";

// On a host whose programs come from a read-only Nix store (MERCBOT_TOOLBOX_STORE), the bots' toolbox is a small system
// of links into the store, made at start in MERCBOT_TOOLBOX_DIR from the programs on PATH, and every gVisor sandbox
// sees the store read-only at the same path. A folder of stand-in packages plays the store here.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIMITS = { processes: 64, openFiles: 64, fileSize: 1024, processMemory: 0, scratch: "16m" };

/** A program file: a bash script that prints its name, or the body given. */
function program(file, body = `echo ${path.basename(file)}`) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
}

/**
 * A store with a browser, python3, bash, fonts and a fontconfig package's rules; a profile folder whose tmux leads into
 * the store; and a host folder whose python3 and xterm are the host's own. `extra` adds programs to the store's tools.
 */
function place(context, { browser = true, extra = [], loader = false } = {}) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "mb-store-toolbox-")));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = path.join(dir, "nix");
  const packages = path.join(store, "store");
  if (browser) program(path.join(packages, "aaa-chromium-157/bin/chromium"));
  program(path.join(packages, "bbb-python3-3.13/bin/python3"));
  program(path.join(packages, "ccc-bash-5.3/bin/bash"));
  program(path.join(packages, "ddd-tmux-3.7/bin/tmux"));
  for (const name of extra) program(path.join(packages, "eee-tools/bin", name));
  if (loader) {
    // nixpkgs' nix-ld, and glibc's bin/ld.so: a link to the glibc package's loader, as nixpkgs has it.
    program(path.join(packages, "hhh-nix-ld-2.0/bin/nix-ld"));
    program(path.join(packages, "iii-glibc-2.42/lib/ld-linux-x86-64.so.2"));
    mkdirSync(path.join(packages, "jjj-glibc-2.42-bin/bin"), { recursive: true });
    symlinkSync("../../iii-glibc-2.42/lib/ld-linux-x86-64.so.2", path.join(packages, "jjj-glibc-2.42-bin/bin/ld.so"));
  }
  mkdirSync(path.join(packages, "fff-liberation-fonts-2.1/share/fonts/truetype"), { recursive: true });
  mkdirSync(path.join(packages, "ggg-fontconfig-2.16/etc/fonts/conf.d"), { recursive: true });
  mkdirSync(path.join(store, "profile/bin"), { recursive: true });
  symlinkSync(path.join(packages, "ddd-tmux-3.7/bin/tmux"), path.join(store, "profile/bin/tmux"));
  program(path.join(dir, "host/bin/python3"));
  program(path.join(dir, "host/bin/xterm"));
  program(path.join(dir, "runsc"));
  const searchPath = [path.join(dir, "host/bin"), path.join(store, "profile/bin"), path.join(packages, "aaa-chromium-157/bin"),
    path.join(packages, "bbb-python3-3.13/bin"), path.join(packages, "ccc-bash-5.3/bin"), path.join(packages, "eee-tools/bin"),
    ...(loader ? [path.join(packages, "hhh-nix-ld-2.0/bin"), path.join(packages, "jjj-glibc-2.42-bin/bin")] : [])].join(":");
  const env = { MERCBOT_TOOLBOX_STORE: store, MERCBOT_TOOLBOX_DIR: path.join(dir, "toolbox"), MERCBOT_RUNSC: path.join(dir, "runsc"), PATH: searchPath };
  return { dir, store, packages, env, box: env.MERCBOT_TOOLBOX_DIR };
}

test("the toolbox is made of links into the store, from the programs on PATH there, with the browser where computers look for it", (context) => {
  const { packages, env, box } = place(context);
  const made = makeStoreToolbox(env);
  assert.equal(readlinkSync(path.join(box, "usr/bin/python3")), path.join(packages, "bbb-python3-3.13/bin/python3"), "the store's python3, not the host's before it on PATH");
  assert.equal(readlinkSync(path.join(box, "usr/bin/tmux")), path.join(packages, "ddd-tmux-3.7/bin/tmux"), "a program reached through a link is linked by its real path");
  assert.equal(readlinkSync(path.join(box, "usr/bin/sh")), path.join(packages, "ccc-bash-5.3/bin/bash"), "sh is bash when the store has no sh");
  assert.equal(readlinkSync(path.join(box, "opt/chrome/chrome")), path.join(packages, "aaa-chromium-157/bin/chromium"));
  assert.equal(existsSync(path.join(box, "usr/bin/xterm")), false, "a host program isn't in the toolbox: it couldn't run where only the store is");
  assert.equal(readlinkSync(path.join(box, "bin")), "usr/bin");
  assert.ok(existsSync(path.join(box, env.MERCBOT_TOOLBOX_STORE.slice(1))), "the store's mount point");
  const fonts = readFileSync(path.join(box, "etc/fonts/fonts.conf"), "utf8");
  assert.ok(fonts.includes(`<dir>${path.join(packages, "fff-liberation-fonts-2.1/share/fonts")}</dir>`), fonts);
  assert.ok(fonts.includes(`<include ignore_missing="yes">${path.join(packages, "ggg-fontconfig-2.16/etc/fonts/conf.d")}</include>`), fonts);
  assert.match(readFileSync(path.join(box, "etc/passwd"), "utf8"), /^root:x:0:0:/u);
  assert.equal(made.computers, true);
  assert.equal(made.fonts, 1);
  assert.equal(desktopSandboxAvailable(env), true, "computers can start with it");
  // The command line is offered only with everything bots are told it has.
  assert.equal(made.commandLine, false);
  assert.ok(made.missing.commandLine.includes("ffmpeg") && made.missing.commandLine.includes("pandoc"), made.missing.commandLine.join(" "));
  assert.equal(existsSync(path.join(box, "etc/mercbot-toolbox")), false);
  assert.equal(shellAvailable(env), false);
});

test("with every tool bots are told of, and python3's modules, the command line is offered too", (context) => {
  const tools = ["tail", "ffmpeg", "ffprobe", "convert", "tesseract", "pdftotext", "pdftoppm", "qpdf", "gs", "pandoc", "node", "npm", "sqlite3", "jq",
    "git", "gh", "curl", "pip"];
  // Each tool bots are told of is needed: without git, curl or pip (D-126), or gh (D-128), there's no command line either.
  for (const left of ["git", "gh", "curl", "pip"]) {
    const { env: without } = place(context, { extra: tools.filter((name) => name !== left) });
    assert.ok(makeStoreToolbox(without).missing.commandLine.includes(left), left);
  }
  const { packages, env, box } = place(context, { extra: tools });
  // python3's stand-in imports what it's asked to only when MODULES says it can.
  program(path.join(packages, "bbb-python3-3.13/bin/python3"), '[ -n "${MODULES:-}" ] && [ "$1" = -c ] && [[ "$2" == "import pandas, numpy, matplotlib, openpyxl, docx, pptx" ]]');
  assert.equal(makeStoreToolbox(env).commandLine, false, "without python3's modules");
  assert.deepEqual(makeStoreToolbox(env).missing.commandLine, ["python3's pandas, numpy, matplotlib, openpyxl, docx, pptx"]);
  process.env.MODULES = "1";
  try {
    const made = makeStoreToolbox(env);
    assert.equal(made.commandLine, true);
    assert.deepEqual(made.missing.commandLine, []);
  } finally {
    delete process.env.MODULES;
  }
  assert.equal(readFileSync(path.join(box, "etc/mercbot-toolbox"), "utf8"), `store ${env.MERCBOT_TOOLBOX_STORE}\n`);
  assert.equal(shellAvailable(env), true);
});

test("a new toolbox replaces the old one whole, also where the old one was a link", (context) => {
  const { dir, env, box } = place(context);
  makeStoreToolbox(env);
  writeFileSync(path.join(box, "left-over"), "");
  makeStoreToolbox(env);
  assert.equal(existsSync(path.join(box, "left-over")), false);
  rmSync(box, { recursive: true });
  mkdirSync(path.join(dir, "elsewhere"));
  symlinkSync(path.join(dir, "elsewhere"), box);
  makeStoreToolbox(env);
  assert.ok(existsSync(path.join(box, "opt/chrome/chrome")));
  assert.ok(existsSync(path.join(dir, "elsewhere")), "only the link went");
  assert.equal(existsSync(`${box}.new`) || existsSync(`${box}.old`), false);
});

test("the toolbox isn't made without a store, without its folder, or in the store", (context) => {
  const { dir, store, env } = place(context);
  assert.throws(() => makeStoreToolbox({ ...env, MERCBOT_TOOLBOX_STORE: "" }), /^Error: MERCBOT_TOOLBOX_STORE isn't set/u);
  assert.throws(() => makeStoreToolbox({ ...env, MERCBOT_TOOLBOX_STORE: path.join(dir, "nowhere") }), /which isn't a folder\.$/u);
  assert.throws(() => makeStoreToolbox({ ...env, MERCBOT_TOOLBOX_DIR: "" }), /^Error: MERCBOT_TOOLBOX_DIR isn't set/u);
  assert.throws(() => makeStoreToolbox({ ...env, MERCBOT_TOOLBOX_DIR: path.join(store, "toolbox") }), /is in the store, which is read-only\.$/u);
});

test("the start stops, saying so, when the store lacks what computers need, and says when bots have no command line", (context) => {
  const run = (env) => spawnSync(process.execPath, ["scripts/store-toolbox.mjs"], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });
  const without = place(context, { browser: false });
  const refused = run(without.env);
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr, "This host's store lacks programs Mercbot's bots' computers need. See README → Hosting requirements.\n" +
    `Not found on PATH in ${without.store}: chromium\n`);
  const unset = run({ ...without.env, MERCBOT_TOOLBOX_DIR: "" });
  assert.equal(unset.status, 1);
  assert.match(unset.stderr, /^Mercbot can't make its bots' toolbox from this host's store\. See README → Hosting requirements\.\nMERCBOT_TOOLBOX_DIR isn't set/u);
  const { env } = place(context);
  const made = run(env);
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stdout, /^Toolbox made from the store: \d+ programs, 1 font folders, 0 libraries, in .+\.\nBots have no command line on this server: the store lacks tail, ffmpeg, /u);
  assert.match(made.stdout, /\nBots' commands can't check the certificates of https sites: MERCBOT_TOOLBOX_CERTIFICATES names no root certificates in the store \(nixpkgs' cacert\)\.\n/u);
  assert.match(made.stdout, /\nThe office apps, voice memos and coding tools can't start in this toolbox, as they're made for an ordinary Linux system: the store lacks nix-ld and ld\.so on PATH\.\n$/u);
  const loaded = run(place(context, { loader: true }).env);
  assert.equal(loaded.status, 0, loaded.stderr);
  assert.doesNotMatch(loaded.stdout, /can't start in this toolbox/u);
});

test("the root certificates named are where the store's programs read them, so a command can check an https site", (context) => {
  const { dir, packages, env, box } = place(context);
  const bundle = path.join(packages, "kkk-nss-cacert-3.131/etc/ssl/certs/ca-bundle.crt");
  mkdirSync(path.dirname(bundle), { recursive: true });
  writeFileSync(bundle, "-----BEGIN CERTIFICATE-----\n");
  // Named through a link outside the store, as a host's folder of declared packages names a package.
  symlinkSync(path.join(packages, "kkk-nss-cacert-3.131"), path.join(dir, "host/cacert"));
  const made = makeStoreToolbox({ ...env, MERCBOT_TOOLBOX_CERTIFICATES: path.join(dir, "host/cacert/etc/ssl/certs/ca-bundle.crt") });
  assert.equal(made.certificates, true);
  // The one file nixpkgs' python3, curl, git, node and pip all read (nixos-26.05, measured on 2026-11-23).
  assert.equal(readlinkSync(path.join(box, "etc/ssl/certs/ca-certificates.crt")), bundle);
  const none = makeStoreToolbox(env);
  assert.equal(none.certificates, false);
  assert.equal(existsSync(path.join(box, "etc/ssl")), false, "none named, none linked");
  // A file outside the store, or a folder, is refused by name.
  writeFileSync(path.join(dir, "host/ca.pem"), "");
  for (const named of [path.join(dir, "host/ca.pem"), path.dirname(bundle), path.join(dir, "host/missing.pem")]) {
    assert.throws(() => makeStoreToolbox({ ...env, MERCBOT_TOOLBOX_CERTIFICATES: named }),
      (error) => error.message === `MERCBOT_TOOLBOX_CERTIFICATES names ${named}, which isn't a file in the store (${env.MERCBOT_TOOLBOX_STORE}).`);
  }
});

/** Library packages in `packages`: each `name` holding `files` in lib/ (a library is a file; `name -> target` a link). */
function libraries(packages, name, files) {
  for (const file of files) {
    const [entry, target] = file.split(" -> ");
    mkdirSync(path.join(packages, name, "lib"), { recursive: true });
    if (target) symlinkSync(target, path.join(packages, name, "lib", entry));
    else writeFileSync(path.join(packages, name, "lib", entry), "");
  }
  return path.join(packages, name, "lib");
}

test("programs made for an ordinary Linux system find nix-ld as their loader, with the store's ld.so and the named libraries where nix-ld looks", (context) => {
  const { dir, packages, env, box } = place(context, { loader: true });
  const alsa = libraries(packages, "kkk-alsa-lib-1.2", ["libasound.so.2.0.0", "libasound.so.2 -> libasound.so.2.0.0", "libasound.a"]);
  const gcc = libraries(packages, "lll-gcc-15-lib", ["libstdc++.so.6", "libasound.so.2", "libgcc_s.so.1"]);
  mkdirSync(path.join(gcc, "pkgconfig"));
  writeFileSync(path.join(dir, "host-libz.so.1"), "");
  symlinkSync(path.join(dir, "host-libz.so.1"), path.join(gcc, "libz.so.1"));
  const made = makeStoreToolbox({ ...env, MERCBOT_TOOLBOX_LIBRARIES: `${alsa}:${gcc}` });
  assert.equal(made.loader, true);
  assert.deepEqual(made.missing.loader, []);
  assert.equal(readlinkSync(path.join(box, "lib64/ld-linux-x86-64.so.2")), path.join(packages, "hhh-nix-ld-2.0/bin/nix-ld"), "nix-ld, where such programs ask for their loader");
  const folder = path.join(box, "run/current-system/sw/share/nix-ld/lib");
  assert.equal(readlinkSync(path.join(folder, "ld.so")), path.join(packages, "iii-glibc-2.42/lib/ld-linux-x86-64.so.2"), "glibc's loader by its real path, where nix-ld looks for it");
  assert.equal(readlinkSync(path.join(folder, "libasound.so.2")), path.join(alsa, "libasound.so.2.0.0"), "the first folder's library of a name, by its real path");
  assert.equal(readlinkSync(path.join(folder, "libstdc++.so.6")), path.join(gcc, "libstdc++.so.6"));
  assert.equal(readlinkSync(path.join(folder, "libgcc_s.so.1")), path.join(gcc, "libgcc_s.so.1"));
  assert.equal(existsSync(path.join(folder, "libasound.a")) || existsSync(path.join(folder, "pkgconfig")), false, "only shared libraries");
  assert.equal(existsSync(path.join(folder, "libz.so.1")), false, "a library whose real file is outside the store couldn't be seen in a sandbox");
  assert.equal(made.libraries, 4);
  assert.equal(readlinkSync(path.join(box, "usr/bin/nix-ld")), path.join(packages, "hhh-nix-ld-2.0/bin/nix-ld"), "both are programs on PATH as any other");
});

test("without nix-ld or ld.so on PATH such programs have no loader, and the toolbox says which is missing", (context) => {
  const { packages, env, box } = place(context, { loader: true });
  const alsa = libraries(packages, "kkk-alsa-lib-1.2", ["libasound.so.2"]);
  for (const [gone, folder] of [["nix-ld", "hhh-nix-ld-2.0/bin"], ["ld.so", "jjj-glibc-2.42-bin/bin"]]) {
    const searchPath = env.PATH.split(":").filter((dir) => dir !== path.join(packages, folder)).join(":");
    const made = makeStoreToolbox({ ...env, PATH: searchPath, MERCBOT_TOOLBOX_LIBRARIES: alsa });
    assert.equal(made.loader, false);
    assert.deepEqual(made.missing.loader, [gone]);
    assert.equal(made.libraries, 0);
    assert.equal(existsSync(path.join(box, "lib64")) || existsSync(path.join(box, "run")), false, `no loader without ${gone}`);
  }
});

test("a library folder that isn't a folder in the store stops the toolbox, naming it", (context) => {
  const { dir, packages, env } = place(context, { loader: true });
  const alsa = libraries(packages, "kkk-alsa-lib-1.2", ["libasound.so.2"]);
  mkdirSync(path.join(dir, "host/lib"));
  for (const folder of [path.join(dir, "host/lib"), path.join(packages, "nowhere/lib"), path.join(alsa, "libasound.so.2")]) {
    assert.throws(() => makeStoreToolbox({ ...env, MERCBOT_TOOLBOX_LIBRARIES: `${alsa}:${folder}` }), (error) => error.message ===
      `MERCBOT_TOOLBOX_LIBRARIES names ${folder}, which isn't a folder in the store (${env.MERCBOT_TOOLBOX_STORE}).`);
  }
});

test("Mesa's driver manifests are where a computer's desktop looks for them, from the Mesa named, which must have both", (context) => {
  const { dir, packages, env, box } = place(context);
  const mesa = path.join(packages, "mmm-mesa-26.1");
  for (const manifest of ["share/vulkan/icd.d/lvp_icd.x86_64.json", "share/glvnd/egl_vendor.d/50_mesa.json"]) {
    mkdirSync(path.dirname(path.join(mesa, manifest)), { recursive: true });
    writeFileSync(path.join(mesa, manifest), "{}");
  }
  const made = makeStoreToolbox({ ...env, MERCBOT_TOOLBOX_MESA: mesa });
  assert.equal(made.graphics, true);
  assert.equal(readlinkSync(path.join(box, DESKTOP_GRAPHICS.vulkan)), path.join(mesa, "share/vulkan/icd.d/lvp_icd.x86_64.json"), "lavapipe's Vulkan manifest");
  assert.equal(readlinkSync(path.join(box, DESKTOP_GRAPHICS.egl)), path.join(mesa, "share/glvnd/egl_vendor.d/50_mesa.json"), "Mesa's EGL vendor file");
  const none = makeStoreToolbox(env);
  assert.equal(none.graphics, false);
  assert.equal(existsSync(path.join(box, "usr/share")), false, "no Mesa named, no manifests");
  // A Mesa without either manifest, or a folder that isn't in the store, is refused by name.
  rmSync(path.join(mesa, "share/glvnd"), { recursive: true });
  mkdirSync(path.join(dir, "host/mesa"));
  for (const [named, message] of [[mesa, `MERCBOT_TOOLBOX_MESA names ${mesa}, which has no share/glvnd/egl_vendor.d/50_mesa.json.`],
    [path.join(dir, "host/mesa"), `MERCBOT_TOOLBOX_MESA names ${path.join(dir, "host/mesa")}, which isn't a folder in the store (${env.MERCBOT_TOOLBOX_STORE}).`]]) {
    assert.throws(() => makeStoreToolbox({ ...env, MERCBOT_TOOLBOX_MESA: named }), (error) => error.message === message);
  }
});

test("every sandbox sees the store read-only at the same path, its programs startable, and none without a store", (context) => {
  const { env, store } = place(context);
  const mounts = (runtimeEnv) => sandboxSpec({ runtimeEnv, args: ["/bin/true"], cwd: "/", env: [], limits: LIMITS }).mounts;
  assert.deepEqual(mounts(env).find((mount) => mount.destination === store), { destination: store, type: "bind", source: store, options: ["rbind", "ro", "nosuid", "nodev"] });
  assert.equal(mounts({ ...env, MERCBOT_TOOLBOX_STORE: "" }).some((mount) => mount.source === store), false);
  assert.equal(sandboxSpec({ runtimeEnv: env, args: ["/bin/true"], cwd: "/", env: [], limits: LIMITS }).root.path, env.MERCBOT_TOOLBOX_DIR);
});

test("a computer's sandbox sees the store too, on the toolbox made from it", async (context) => {
  const { dir, env, store } = place(context);
  // runsc's stand-in keeps the sandbox's spec when it's run. The sandbox's folders, and those of earlier servers it
  // sweeps, are in the test's own folder.
  program(env.MERCBOT_RUNSC, `while [ "$#" -gt 0 ]; do
  if [ "$1" = --bundle ]; then cp "$2/config.json" "${dir}/spec.json"; fi
  shift
done`);
  const tmpdir = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  context.after(() => {
    if (tmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = tmpdir;
  });
  const profile = path.join(dir, "profile");
  mkdirSync(profile);
  const box = await startDesktopSandbox({ runtimeEnv: env, computerId: "store", display: 199, profile, folders: null });
  try {
    const spec = JSON.parse(readFileSync(path.join(dir, "spec.json"), "utf8"));
    assert.deepEqual(spec.mounts.find((mount) => mount.destination === store), { destination: store, type: "bind", source: store, options: ["rbind", "ro", "nosuid", "nodev"] });
    assert.equal(spec.root.path, env.MERCBOT_TOOLBOX_DIR);
    // Its Vulkan loader and glvnd look for Mesa's drivers where the toolbox puts the store's (MERCBOT_TOOLBOX_MESA).
    assert.ok(spec.process.env.includes(`VK_ICD_FILENAMES=${DESKTOP_GRAPHICS.vulkan}`));
    assert.ok(spec.process.env.includes(`__EGL_VENDOR_LIBRARY_FILENAMES=${DESKTOP_GRAPHICS.egl}`));
    // Every folder keeps nosuid and nodev, and the display's socket folder noexec, which a host may have set (its /tmp).
    assert.ok(spec.mounts.filter((mount) => mount.type === "bind").every((mount) => mount.options.includes("nosuid") && mount.options.includes("nodev")));
    assert.deepEqual(spec.mounts.find((mount) => mount.destination === "/tmp/.X11-unix").options, ["rbind", "ro", "noexec", "nosuid", "nodev"]);
  } finally {
    await box.stop();
  }
});

test("a folder where the host forbids programs is told apart by the last mount above it, so the toolbox isn't made there", (context) => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "mb-store-mounts-")));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, "work dir"));
  const line = (point, options) => `36 35 0:31 / ${point.replace(/ /gu, "\\040")} ${options} shared:1 - tmpfs tmpfs rw`;
  const mountinfo = [line("/", "rw,relatime"), line(dir, "rw,nosuid,nodev,noexec,relatime"), line(path.join(dir, "work dir"), "rw,nosuid,nodev,relatime")].join("\n");
  assert.equal(mountedNoexec(path.join(dir, "toolbox"), mountinfo), true, "a folder yet to be made, under a noexec mount");
  assert.equal(mountedNoexec(path.join(dir, "work dir", "toolbox"), mountinfo), false, "a mount allowing programs inside it");
  assert.equal(mountedNoexec(dir, [line("/", "rw"), line(dir, "rw,noexec"), line(dir, "rw")].join("\n")), false, "the last mount on a point wins");
  assert.equal(mountedNoexec(`${dir}x`, mountinfo), false, "a mount point is a whole folder name");
});
