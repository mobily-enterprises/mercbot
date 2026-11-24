import { HOME, connectTestDb, directChat, expect, homeApi, openShell, seedMessage, shell, test, type Page } from "./harness";

// Mercbot as an app people install from the website (D-133): the manifest and the service worker, the offline page,
// Install app and the iPhone guide, Settings → General → Notifications on a device whose push service is a stand-in,
// the offer made once after a first routine, a notification opening its chat, and sharing into a chat.

/**
 * A device whose browser can have notifications: the permission is the browser's question, answered yes, and the push
 * service a stand-in that subscribes at once. What the page shows as notifications is kept in `window.shown`.
 */
async function standInPush(page: Page, permission: "default" | "granted" = "default") {
  await page.addInitScript((start) => {
    let answer = start;
    Object.defineProperty(Notification, "permission", { get: () => answer, configurable: true });
    Notification.requestPermission = async () => {
      answer = "granted";
      return answer;
    };
    let subscription: Record<string, unknown> | null = null;
    const make = () => ({
      endpoint: "https://fcm.googleapis.com/fcm/send/e2e-device",
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/e2e-device", keys: { p256dh: `B${"x".repeat(86)}`, auth: "abcdefghijklmnop" } }),
      unsubscribe: async () => {
        subscription = null;
        return true;
      }
    });
    PushManager.prototype.getSubscription = async () => subscription as never;
    PushManager.prototype.subscribe = async () => {
      subscription = make();
      return subscription as never;
    };
    (window as unknown as { shown: unknown[] }).shown = [];
    ServiceWorkerRegistration.prototype.showNotification = async (title: string, options?: NotificationOptions) => {
      (window as unknown as { shown: unknown[] }).shown.push({ title, ...options });
    };
  }, permission);
}

/** Settings → General, at its Notifications group. */
async function openNotifications(page: Page) {
  await openShell(page, "?settings=general");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByText("Notifications on this device")).toBeVisible();
  return settings;
}

test("Mercbot installs from its address: the manifest, a service worker over the whole app, and an offline page", async ({ page, context }) => {
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "Mercbot", start_url: "/", scope: "/", display: "standalone" });
  expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose)).toEqual(["any", "any", "maskable"]);
  expect(manifest.shortcuts.map((shortcut: { name: string }) => shortcut.name)).toEqual(["New chat", "Recurring tasks", "Files"]);
  expect(manifest.share_target).toMatchObject({ action: "/share", method: "POST", enctype: "multipart/form-data" });
  expect(manifest.screenshots.map((shot: { form_factor: string }) => shot.form_factor)).toEqual(["narrow", "wide"]);
  for (const image of [...manifest.icons, ...manifest.screenshots]) expect((await page.request.get(image.src)).headers()["content-type"]).toBe("image/png");

  await openShell(page);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe("/");
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // Only the offline page and the built files are kept: never a page or the API.
  const kept = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls = (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat();
    return { names: names.sort(), urls };
  });
  expect(kept.names).toEqual(expect.arrayContaining(["mercbot-offline-v1"]));
  expect(kept.urls.filter((url) => url.startsWith("/api") || url.startsWith("/w/"))).toEqual([]);

  // Offline, a page shows Mercbot's own page. Try again there tries the page, which still can't load; back online the
  // page opens the app by itself (offline.js), with no Try again left to press.
  await context.setOffline(true);
  await page.goto(HOME).catch(() => {});
  const offline = page.getByRole("heading", { name: "You're offline" });
  await expect(offline).toBeVisible();
  const tried = page.waitForEvent("requestfailed", (request) => new URL(request.url()).pathname === HOME);
  await page.getByRole("button", { name: "Try again" }).click();
  await tried;
  await expect(offline).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator(".mb-shell")).toBeVisible();
});

// The page's own network and the service worker's come back a moment apart, so the reload the online event starts can
// still fail and land on the offline page again, after the event. It keeps trying until a page loads (offline.js).
test("Mercbot reconnects by itself: a reload that still can't reach Mercbot just after it's back online keeps trying until the app opens", async ({ page, context }) => {
  await openShell(page);
  await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.goto(HOME).catch(() => {});
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  // Its icon and script come from the worker's copy: the browser's own cache would ask the server first.
  await expect.poll(() => page.locator("img").evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);

  // Back online, the first load of the page still can't reach Mercbot, as when the worker's network is a moment behind.
  let refused = 0;
  await context.route((url) => url.pathname === HOME, (route) => {
    refused += 1;
    return route.abort("internetdisconnected");
  }, { times: 1 });
  await context.setOffline(false);
  await expect(page.locator(".mb-shell")).toBeVisible();
  expect(refused, "the load that couldn't reach Mercbot").toBe(1);
});

test("Install app shows the browser's own sheet, and is gone once it's used", async ({ page }) => {
  await openShell(page);
  await page.evaluate(() => {
    const offer = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => {
        (window as unknown as { prompted: boolean }).prompted = true;
      },
      userChoice: Promise.resolve({ outcome: "accepted" })
    });
    window.dispatchEvent(offer);
  });
  await page.locator(".mb-account").click();
  await page.getByText("Install app", { exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);
  await page.locator(".mb-account").click();
  await expect(page.getByText("Settings", { exact: true })).toBeVisible();
  await expect(page.getByText("Install app", { exact: true })).toHaveCount(0);
});

test.describe("on an iPhone", () => {
  test.use({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true
  });

  test("Install app shows Share → Add to Home Screen, and the banner is offered once", async ({ page }) => {
    await openShell(page);
    await page.getByRole("button", { name: "Your chats" }).first().click();
    await page.locator(".mb-account").click();
    await page.getByText("Install app", { exact: true }).click();
    const guide = page.getByRole("dialog").filter({ hasText: "Add Mercbot to your Home Screen" });
    await expect(guide).toContainText("Tap Share");
    await expect(guide).toContainText("Add to Home Screen");
    await guide.getByRole("button", { name: "Done" }).click();
    await expect(guide).toBeHidden();
    // Using Install app answered the one-time banner: it doesn't come.
    expect(await page.evaluate(() => localStorage.getItem("mercbot.installBanner"))).toBe("answered");
  });

  test("the banner on a phone comes once, a few seconds in, and Not now puts it away for good", async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("mercbot.installBanner"));
    await openShell(page);
    const banner = page.locator(".mb-app-banner").filter({ hasText: "Install Mercbot" });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await banner.getByRole("button", { name: "Not now" }).click();
    await expect(banner).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("mercbot.installBanner"))).toBe("answered");
  });

  test("Settings says notifications need Mercbot on the Home Screen, and shows how", async ({ page }) => {
    await page.addInitScript(() => {
      // Safari in a tab has no web push: only the installed app does.
      delete (window as unknown as { PushManager?: unknown }).PushManager;
    });
    const settings = await openNotifications(page);
    await expect(settings).toContainText("On an iPhone or iPad, notifications work once Mercbot is on your Home Screen.");
    await settings.getByRole("button", { name: "Show me how" }).click();
    await expect(page.getByRole("dialog").filter({ hasText: "Add Mercbot to your Home Screen" })).toBeVisible();
  });
});

test.describe("notifications", () => {
  test.use({ apiGuard: true });

  test("turned on in Settings: this device is kept, a test shows, each setting saves, and the device can be removed", async ({ page }) => {
    await standInPush(page);
    const settings = await openNotifications(page);
    const api = await homeApi(page);
    const on = settings.getByRole("switch", { name: "Notifications on this device" });
    await expect(on).toHaveAttribute("aria-checked", "false");
    await on.click();
    await expect(on).toHaveAttribute("aria-checked", "true");
    await expect(settings.getByText("· This device")).toBeVisible();
    // From the keyboard, a switch shows a ring of its own, which reads in light and dark alike.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(on).toBeFocused();
    await expect(on).toHaveCSS("outline-style", "solid");
    await expect(on).toHaveCSS("outline-width", "2px");
    expect((await api.get("/push")).devices.map((device: { endpoint: string }) => device.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/e2e-device"]);

    await settings.getByRole("button", { name: "Send a test notification" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { shown: Array<{ title: string, body: string }> }).shown.map((note) => [note.title, note.body])))
      .toEqual([["Mercbot", "Notifications work on this device."]]);

    await settings.getByRole("switch", { name: "Messages and mentions" }).click();
    await settings.getByRole("switch", { name: "Show message text" }).click();
    await settings.getByRole("switch", { name: "Quiet hours" }).click();
    await expect.poll(async () => (await api.get("/push")).settings).toMatchObject({ messages: false, showText: false, quietFrom: "22:00", quietTo: "07:00" });

    await settings.getByRole("button", { name: /^Remove / }).click();
    await expect(on).toHaveAttribute("aria-checked", "false");
    expect((await api.get("/push")).devices).toEqual([]);
    await api.put("/push/settings", { messages: true, showText: true, quietFrom: null, quietTo: null });
  });

  test("offered once, just after a routine is set up, and Turn on keeps this device", async ({ page }) => {
    await standInPush(page);
    await page.addInitScript(() => localStorage.removeItem("mercbot.notificationsOffered"));
    const chat = await directChat(page, String((await (await homeApi(page)).get("/bots")).bots[0].id));
    const knex = connectTestDb();
    try {
      const home = await knex("workspaces").where({ slug: HOME.slice(3) }).first();
      await seedMessage(knex, { homeId: home.id, chatId: chat.id, kind: "event", body: { text: "Created routine", icon: "routine", detail: "Weather every morning" } });
    } finally {
      await knex.destroy();
    }
    await openShell(page, `?chat=${chat.id}`);
    const offer = page.locator(".mb-app-banner").filter({ hasText: "Get notified when it runs?" });
    await expect(offer).toBeVisible();
    await offer.getByRole("button", { name: "Turn on" }).click();
    await expect(offer).toBeHidden();
    const api = await homeApi(page);
    await expect.poll(async () => (await api.get("/push")).devices.length).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("mercbot.notificationsOffered"))).toBe("answered");
    await api.del(`/push/devices/${(await api.get("/push")).devices[0].id}`);
  });
});

test("a notification opens its chat, in the window already open", async ({ page, context }) => {
  const chat = await directChat(page, String((await (await homeApi(page)).get("/bots")).bots[0].id));
  await openShell(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  // The worker's notificationclick, as the device calls it when the person opens the notification.
  await worker.evaluate((url) => {
    const notification = { data: { url }, close: () => {} };
    const event = Object.assign(new Event("notificationclick"), { notification, waitUntil: (work: Promise<unknown>) => work });
    self.dispatchEvent(event);
  }, `${HOME}?chat=${chat.id}`);
  await expect(page).toHaveURL(new RegExp(`chat=${chat.id}`, "u"));
  await expect(shell.chat(page)).toBeVisible();
});

test("what another app shares goes to the chat chosen, in its message box", async ({ page }) => {
  const bot = (await (await homeApi(page)).get("/bots")).bots[0];
  const chat = await directChat(page, String(bot.id));
  await openShell(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // Another app's share: a form posted to /share, as the device sends it to the installed app.
  await page.evaluate(() => {
    const form = Object.assign(document.createElement("form"), { method: "POST", action: "/share", enctype: "multipart/form-data" });
    for (const [name, value] of [["title", "Dinner ideas"], ["text", "Try this"], ["url", "https://example.test/recipe"]]) {
      form.append(Object.assign(document.createElement("input"), { type: "hidden", name, value }));
    }
    const files = Object.assign(document.createElement("input"), { type: "file", name: "files" });
    const list = new DataTransfer();
    list.items.add(new File(["oak, pine"], "woods.txt", { type: "text/plain" }));
    files.files = list.files;
    form.append(files);
    document.body.append(form);
    form.submit();
  });
  const picker = page.getByRole("dialog").filter({ hasText: "Send to a chat" });
  await expect(picker).toContainText("woods.txt");
  await picker.getByRole("textbox").fill(bot.name);
  await picker.locator(".v-list-item").filter({ hasText: new RegExp(`^${bot.name}$`, "u") }).first().click();
  await expect(picker).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`chat=${chat.id}`, "u"));
  await expect(shell.composer(page)).toHaveValue("Dinner ideas\nTry this\nhttps://example.test/recipe");
  await expect(shell.chat(page)).toContainText("woods.txt");
});
