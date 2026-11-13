// Mercbot's page helper (D-40, D-74): the first script of every page that runs scripts, before the
// page's own. It makes tabs switch, gives checklists their switches, counter and Reset, and tells the
// page around it (Mercbot, through postMessage only) the page's height, a tick to save, a link the
// person clicked and an app to open (the doorway). The page has no origin of its own and no way to
// reach Mercbot, which checks each message: that it came from this frame, and its shape. Opened on
// its own (a standalone copy, or the address in a tab of its own) it changes only the page itself.
(() => {
  const root = document.documentElement;
  root.classList.add("mb-js");
  const framed = window.parent !== window;
  const post = (message) => {
    if (framed) window.parent.postMessage({ mercbotPage: 1, ...message }, "*");
  };

  // The doorway: open app A, screen S, with up to 10 short values. Mercbot checks the person may
  // use the app and opens it in its own view; nothing comes back into the page.
  function openApp(app, screen = "", params = {}) {
    post({ kind: "open-app", app: String(app || ""), screen: String(screen || ""), params: { ...params } });
  }
  Object.defineProperty(window, "mercbot", { value: Object.freeze({ openApp }), enumerable: false });

  function tabs() {
    for (const [group, holder] of [...document.querySelectorAll("section.tabs")].entries()) {
      const panels = [...holder.children].filter((child) => child.tagName === "SECTION");
      if (!panels.length) continue;
      const bar = document.createElement("div");
      bar.className = "mb-tabbar";
      bar.setAttribute("role", "tablist");
      const buttons = panels.map((panel, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "tab");
        button.id = `mb-tab-${group}-${index}`;
        button.textContent = panel.getAttribute("title") || `Tab ${index + 1}`;
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", button.id);
        button.addEventListener("click", () => show(index));
        bar.append(button);
        return button;
      });
      const show = (shown) => {
        panels.forEach((panel, index) => panel.classList.toggle("mb-active", index === shown));
        buttons.forEach((button, index) => button.setAttribute("aria-selected", String(index === shown)));
      };
      holder.prepend(bar);
      show(0);
    }
  }

  function checklists() {
    for (const list of document.querySelectorAll("ul.checklist")) {
      const items = [...list.children].filter((child) => child.tagName === "LI");
      const count = document.createElement("span");
      const counted = () => {
        count.textContent = `${items.filter((item) => item.hasAttribute("data-done")).length} of ${items.length} done`;
      };
      const set = (changes) => {
        for (const [item, done] of changes) {
          item.toggleAttribute("data-done", done);
          item.querySelector(":scope > .mb-switch").checked = done;
        }
        counted();
        const saved = changes
          .filter(([item]) => item.dataset.tick !== undefined)
          .map(([item, done]) => ({ tick: Number(item.dataset.tick), done }));
        if (saved.length) post({ kind: "ticks", items: saved });
      };
      for (const item of items) {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.className = "mb-switch";
        box.setAttribute("role", "switch");
        box.setAttribute("aria-label", item.textContent.trim().slice(0, 120) || "Done");
        box.checked = item.hasAttribute("data-done");
        box.addEventListener("change", () => set([[item, box.checked]]));
        item.prepend(box);
      }
      const bar = document.createElement("div");
      bar.className = "mb-checklist-bar";
      const reset = document.createElement("button");
      reset.type = "button";
      reset.textContent = "Reset";
      reset.addEventListener("click", () => set(items.filter((item) => item.hasAttribute("data-done")).map((item) => [item, false])));
      bar.append(count, reset);
      list.after(bar);
      counted();
    }
  }

  // The page's height, whenever it changes, so the page around it can show all of it.
  let told = 0;
  const tellHeight = () => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (height === told) return;
    told = height;
    post({ kind: "height", height });
  };

  // Links go out only when clicked, and open outside the page; an app link goes through the doorway.
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || !framed) return;
    const target = event.target instanceof Element ? event.target : null;
    const door = target?.closest("[data-app]");
    if (door) {
      event.preventDefault();
      const params = Object.fromEntries(Object.entries(door.dataset).filter(([name]) => !["app", "screen"].includes(name)));
      openApp(door.dataset.app, door.dataset.screen, params);
      return;
    }
    const link = target?.closest("a[href]");
    if (!link) return;
    const url = new URL(link.getAttribute("href"), window.location.href);
    const here = url.origin === window.location.origin;
    // A link to a place on the page scrolls to it; nothing else on Mercbot's address opens in the page.
    if (here && url.pathname === window.location.pathname && url.hash) return;
    event.preventDefault();
    if (!here && ["http:", "https:"].includes(url.protocol)) post({ kind: "link", href: url.href });
  });

  document.addEventListener("DOMContentLoaded", () => {
    tabs();
    checklists();
    // An app's button written as <a class="app"> without an address is still a link to reach and press.
    for (const door of document.querySelectorAll("a[data-app]:not([href])")) door.setAttribute("href", "#");
    tellHeight();
    new ResizeObserver(() => window.requestAnimationFrame(tellHeight)).observe(root);
  }, { once: true });
  window.addEventListener("load", tellHeight, { once: true });
})();
