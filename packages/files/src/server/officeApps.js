import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { startMcp } from "./mcpClient.js";
import { sharedScratch, shellAvailable, toolsDir } from "./gvisor.js";
import { gvisorProcess } from "./shell.js";

// The office apps bots work with (D-20), installed by scripts/install-tools.sh. Every run is in
// the bots' gVisor sandbox (D-49), the same as their commands': no network, the toolbox, the
// apps, and only the place's folders. Nothing runs outside it: without gVisor and the toolbox
// the apps, previews and voice memos are simply unavailable.
export const APPS = {
  word: { bin: "wordcraft", label: "WordCraft", use: "documents: docx, odt, rtf, md, txt, html; saves pdf too" },
  sheet: { bin: "gridcraft", label: "GridCraft", use: "spreadsheets: xlsx, xls, ods, csv" },
  slides: { bin: "deckcraft", label: "DeckCraft", use: "presentations: pptx" },
  pdf: { bin: "pdfcraft", label: "PdfCraft", use: "PDFs: edit, fill forms, combine, split, redact, sign" }
};

// Which app turns a file into a PDF for the viewer, and how many pages it shows.
const CONVERTS = {
  docx: "word",
  doc: "word",
  odt: "word",
  rtf: "word",
  xlsx: "sheet",
  xls: "sheet",
  xlsm: "sheet",
  ods: "sheet",
  pptx: "slides"
};

// Which app reads a file's text for the bot.
const READS = {
  docx: "word",
  doc: "word",
  odt: "word",
  rtf: "word",
  html: "word",
  htm: "word",
  xlsx: "sheet",
  xls: "sheet",
  xlsm: "sheet",
  ods: "sheet",
  pptx: "slides",
  pdf: "pdf"
};

const PREVIEW_PAGES = 20;
const RESULT_LIMIT = 12000;

const READ_ONLY = ["mine", "bot", "shared"];

/**
 * `argv` in the gVisor sandbox with the place's folders (`readOnly` names folders it may only
 * read) and `out`, a scratch folder of this server's, at /out. Resolves to its output. `env` is the
 * server's.
 */
async function runSandboxed(env, dirs, argv, { out = null, readOnly = [], timeout, input = null, maxBuffer = 8 * 1024 * 1024 } = {}) {
  const box = await gvisorProcess({
    runtimeEnv: env,
    dirs,
    args: argv,
    env: ["HOME=/tmp"],
    readOnly,
    mounts: out ? [{ source: out, destination: "/out" }] : []
  });
  try {
    return await new Promise((resolve, reject) => {
      const child = execFile(box.command, box.args, { timeout, maxBuffer, killSignal: "SIGKILL" }, (error, stdout) => (
        error ? reject(error) : resolve(stdout)
      ));
      child.stdin.end(input ?? "");
    });
  } finally {
    await box.stop();
  }
}

/** Which app opens a file on the bot's desktop, or null. */
export function appFor(virtualPath) {
  const ext = path.extname(virtualPath).slice(1).toLowerCase();
  return CONVERTS[ext] || (ext === "pdf" ? "pdf" : null);
}

/**
 * An app's icon in the tools folder.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {keyof typeof APPS} app
 */
export function appIcon(env, app) {
  const bin = APPS[app].bin;
  return path.join(toolsDir(env), "apps", bin, "share", "icons", "hicolor", "256x256", "apps", `ai.storyteller.${bin}.png`);
}

const cli = (app) => `/opt/apps/${APPS[app].bin}/bin/${APPS[app].bin}-cli`;

/** The model reads text; pictures an app returns are left out. */
function resultText(result) {
  const text = (result?.content || [])
    .map((part) => (part.type === "text" ? part.text : `(${part.type} left out)`))
    .join("\n");
  return text.length > RESULT_LIMIT ? `${text.slice(0, RESULT_LIMIT)}\n… (cut short)` : text;
}

/**
 * The office apps' work for a place's files: app sessions, page pictures for the viewer, a file's
 * text, chart images and voice memos.
 * @param {object} dependencies
 * @param {import("./types.js").FileStore} dependencies.store
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 */
export function createOfficeApps({ store, env }) {
  let checked = null;
  const catalogs = new Map();

  /** Installed, with gVisor and the toolbox, checked once per server. */
  function available() {
    checked ??= (async () => {
      for (const app of Object.values(APPS)) {
        await fs.access(path.join(toolsDir(env), "apps", app.bin, "bin", `${app.bin}-cli`));
      }
      return shellAvailable(env);
    })().catch(() => false);
    return checked;
  }

  /**
   * One reply's apps for one bot: each app starts on first use and keeps its open documents
   * until the reply ends.
   */
  function session(place) {
    const running = new Map();

    async function app(name) {
      if (!APPS[name]) throw new Error(`There's no app called ${name}. Use one of: ${Object.keys(APPS).join(", ")}.`);
      if (!await available()) throw new Error("The office apps aren't available on this server.");
      const current = running.get(name);
      if (current && !current.stopped) return current;
      const dirs = await store.prepare(place);
      const box = await gvisorProcess({ runtimeEnv: env, dirs, args: [cli(name), "mcp"], env: ["HOME=/tmp"] });
      const started = startMcp(box.command, box.args);
      const close = started.close;
      started.close = () => {
        close();
        box.stop();
      };
      running.set(name, started);
      return started;
    }

    return {
      async help(name, tool) {
        if (!catalogs.has(name)) catalogs.set(name, await (await app(name)).tools());
        const tools = catalogs.get(name);
        if (!tool) return tools.map((entry) => `${entry.name}: ${String(entry.description || "").split("\n")[0]}`).join("\n");
        const entry = tools.find((candidate) => candidate.name === tool);
        if (!entry) throw new Error(`${APPS[name].label} has no tool called ${tool}.`);
        return JSON.stringify({ name: entry.name, description: entry.description, input: entry.inputSchema });
      },
      async call(name, tool, args) {
        const result = await (await app(name)).call(tool, args || {});
        return { ok: !result?.isError, text: resultText(result) };
      },
      close() {
        for (const started of running.values()) started.close();
        running.clear();
      }
    };
  }

  /**
   * The viewer's pictures of a document, spreadsheet, presentation or PDF: its first pages as
   * PNGs, made in one sandbox run (convert to PDF, then draw each page). Null for other kinds.
   */
  async function pagesOf(place, virtualPath) {
    const ext = path.extname(virtualPath).slice(1).toLowerCase();
    const converter = CONVERTS[ext];
    if ((!converter && ext !== "pdf") || !await available()) return null;
    const dirs = await store.prepare(place, { reading: true });
    const out = await sharedScratch(env, "mercbot-preview-");
    const script = [
      "set -e",
      converter ? `${cli(converter)} convert "$1" /out/file.pdf >/dev/null` : "cp \"$1\" /out/file.pdf",
      "n=1",
      `while [ $n -le ${PREVIEW_PAGES + 1} ] && ${cli("pdf")} render /out/file.pdf --page $n --dpi 110` +
        " --out /out/page-$n.png >/dev/null 2>&1; do n=$((n+1)); done"
    ].join("\n");
    try {
      await runSandboxed(env, dirs, ["/usr/bin/sh", "-c", script, "preview", virtualPath], { out, readOnly: READ_ONLY, timeout: 90000 });
      const pages = [];
      for (let n = 1; n <= PREVIEW_PAGES; n += 1) {
        const page = await fs.readFile(path.join(out, `page-${n}.png`)).catch(() => null);
        if (!page) break;
        pages.push(page);
      }
      const more = await fs.access(path.join(out, `page-${PREVIEW_PAGES + 1}.png`)).then(() => true, () => false);
      return { pages, more };
    } finally {
      await fs.rm(out, { recursive: true, force: true });
    }
  }

  /**
   * A document's text for the bot to read: Word-like files, spreadsheets (a summary of
   * the sheets, then the first sheet), presentations (slide text) and PDFs, read in the sandbox.
   */
  async function textOf(place, virtualPath) {
    const ext = path.extname(virtualPath).slice(1).toLowerCase();
    const script = {
      word: `${cli("word")} text "$1"`,
      sheet: `${cli("sheet")} info "$1"; echo; ${cli("sheet")} cat "$1"`,
      slides: `${cli("slides")} convert "$1" /out/text.txt >/dev/null && cat /out/text.txt`,
      pdf: `${cli("pdf")} text "$1"`
    }[READS[ext]];
    if (!script || !await available()) return null;
    const dirs = await store.prepare(place, { reading: true });
    const out = await sharedScratch(env, "mercbot-read-");
    try {
      return await runSandboxed(env, dirs, ["/usr/bin/sh", "-c", script, "read", virtualPath], { out, readOnly: READ_ONLY, timeout: 60000 });
    } finally {
      await fs.rm(out, { recursive: true, force: true });
    }
  }

  /**
   * A chart as a picture: drawn on a blank slide by the slides app, in the sandbox,
   * and saved as a PNG at `virtualPath` in the bot's folders.
   */
  async function chartImage(place, { title, type = "column", categories, series }, virtualPath) {
    if (!await available()) throw new Error("The office apps aren't available on this server.");
    const dirs = await store.prepare(place);
    const target = await store.resolve(place, virtualPath);
    if (!target) throw new Error("Charts go in /files/mine or /files/shared.");
    await fs.mkdir(path.dirname(target), { recursive: true });
    const out = await sharedScratch(env, "mercbot-chart-");
    // One series of columns: the highest stands out in a second colour, as its own stacked series.
    let drawn = { type, series };
    if (type === "column" && series.length === 1) {
      const values = series[0].values;
      const peak = values.indexOf(Math.max(...values));
      drawn = {
        type: "stackedColumn",
        series: [
          { name: series[0].name, values: values.map((value, index) => (index === peak ? 0 : value)) },
          { name: "Highest", values: values.map((value, index) => (index === peak ? value : 0)) }
        ]
      };
    }
    const commands = [
      `slide.layout=${JSON.stringify({ layout: "blank" })}`,
      `insert.chart=${JSON.stringify({ type: drawn.type, rect: [40, 30, 880, 480], categories, series: drawn.series })}`,
      `chart.options=${JSON.stringify({ title, dataLabels: drawn.type !== "stackedColumn", legend: series.length > 1 ? "b" : null })}`
    ];
    const deck = cli("slides");
    const script = `${deck} run --cmd "$2" --cmd "$3" --cmd "$4" --save /out/chart.deckcraft >/dev/null` +
      ` && ${deck} render /out/chart.deckcraft --scale 1.5 "$1" >/dev/null`;
    try {
      await runSandboxed(env, dirs, ["/usr/bin/sh", "-c", script, "chart", virtualPath, ...commands], { out, timeout: 90000 });
    } finally {
      await fs.rm(out, { recursive: true, force: true });
    }
    return virtualPath;
  }

  /**
   * A voice memo: the text spoken by Piper, in the sandbox, into a WAV at
   * `virtualPath`, with its length and a 40-bar waveform for the chat's audio bubble.
   */
  async function voiceMemo(place, text, virtualPath) {
    const piper = path.join(toolsDir(env), "piper");
    if (!existsSync(path.join(piper, "piper")) || !shellAvailable(env)) throw new Error("Voice memos aren't installed on this server.");
    const dirs = await store.prepare(place);
    const target = await store.resolve(place, virtualPath);
    if (!target) throw new Error("Voice memos go in /files/mine.");
    await fs.mkdir(path.dirname(target), { recursive: true });
    const box = await gvisorProcess({
      runtimeEnv: env,
      dirs,
      args: [
        "/opt/piper/piper", "--model", "/opt/piper/voice.onnx",
        "--output_file", virtualPath, "--espeak_data", "/opt/piper/espeak-ng-data"
      ],
      cwd: "/opt/piper",
      env: ["HOME=/tmp", "LD_LIBRARY_PATH=/opt/piper"],
      mounts: [{ source: piper, destination: "/opt/piper", readonly: true, exec: true }]
    });
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(box.command, box.args, { stdio: ["pipe", "ignore", "ignore"] });
        const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
        child.once("error", reject);
        child.once("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error("The voice memo couldn't be made."));
        });
        child.stdin.end(String(text));
      });
    } finally {
      await box.stop();
    }
    const wav = await fs.readFile(target);
    const rate = wav.readUInt32LE(24);
    const samples = new Int16Array(wav.buffer, wav.byteOffset + 44, Math.floor((wav.length - 44) / 2));
    const bars = 40;
    const step = Math.max(1, Math.floor(samples.length / bars));
    const peaks = Array.from({ length: bars }, (_, bar) => {
      let peak = 0;
      for (let index = bar * step; index < Math.min(samples.length, (bar + 1) * step); index += 1) {
        peak = Math.max(peak, Math.abs(samples[index]));
      }
      return peak;
    });
    const top = Math.max(1, ...peaks);
    return {
      path: virtualPath,
      seconds: Math.round((samples.length / rate) * 10) / 10,
      waveform: peaks.map((peak) => Math.round((peak / top) * 100) / 100)
    };
  }

  return Object.freeze({
    available,
    session,
    pagesOf,
    textOf,
    chartImage,
    voiceMemo
  });
}
