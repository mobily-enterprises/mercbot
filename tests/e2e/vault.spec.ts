import { MADE_UP, expect, test, type Page, type Route } from "./harness";

// Settings → Vault's Import from a CSV file and its contact form's Scan with camera and Upload a
// photo (D-17), on the Test Preview target. The photo reader's answer is made up here (the target's stand-in
// model would read any photo as one made-up contact); the import saves for real, and each test deletes what it added.
// Chromium's own stand-in camera (a moving test picture) plays the camera. Run with:
// vibe64-helper playwright --target test-app test tests/e2e/vault.spec.ts
const HOME = "/w/you";
// Any refused API call from the page, or JSKIT's error dialog, fails the test (harness.ts).
test.use({
  apiGuard: true,
  permissions: ["camera"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }
});
// The smallest PNG there is: one transparent pixel.
const PICTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function openVault(page: Page) {
  await page.goto(HOME);
  const next = page.getByRole("button", { name: "Next" });
  const shell = page.locator(".mb-shell");
  await expect(shell.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shell).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Settings: Vault");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Vault", level: 2 })).toBeVisible();
}

async function newItem(page: Page, item: string) {
  await page.getByRole("button", { name: "New item" }).click();
  await page.locator(".v-overlay--active .v-list-item").filter({ hasText: item }).click();
}

/** Deletes the Vault items whose label contains `text`, as the test leaves the data it found. */
async function deleteItems(page: Page, text: string) {
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const { items } = await (await page.request.get("/api/vault")).json();
  for (const item of items.filter((entry: { label: string }) => entry.label.includes(text))) {
    expect((await page.request.delete(`/api/vault/${item.id}`, { headers: { "csrf-token": csrfToken } })).ok()).toBe(true);
  }
}

test("a password manager's CSV file is previewed with its secrets hidden, then imported", async ({ page }, info) => {
  const stamp = `e2e${Date.now()}`;
  const file = [
    "name,url,username,password,note",
    `First,https://www.first-${stamp}.example/login,me@example.com,First-secret-1,`,
    `Second,https://second-${stamp}.example/,you,Second-secret-2,Shared account`,
    `Third,https://third-${stamp}.example/,nobody,,`
  ].join("\n");
  await openVault(page);
  await newItem(page, "Import from a CSV file");
  const dialog = page.locator('.v-overlay--active .v-card[aria-label="Import from a CSV file"]');
  await dialog.locator("input[type=file]").setInputFiles({ name: "Passwords.csv", mimeType: "text/csv", buffer: Buffer.from(file) });

  await expect(dialog.getByRole("button", { name: "Logins" })).toHaveClass(/v-btn--active/u);
  await expect(dialog.getByText("2 items will be added; 1 row can't be.")).toBeVisible();
  const preview = dialog.locator("table");
  await expect(preview.locator("thead th")).toHaveText(["Row", "Website", "Username or email", "Password", "Notes"]);
  await expect(preview.locator("tbody tr").first().locator("td")).toHaveText(["2", `first-${stamp}.example`, "me@example.com", "••••••", ""]);
  await expect(dialog).not.toContainText("Second-secret-2");
  await expect(dialog.getByText("Row 4: A login needs a website and a password.")).toBeVisible();
  await page.screenshot({ path: info.outputPath("vault-import.png") });
  // A column can be left out: the preview drops it.
  const notes = dialog.locator("label", { hasText: /^\s*Notes/u }).locator("select");
  await expect(notes).toHaveValue("4");
  await notes.selectOption({ label: "Not used" });
  await expect(preview.locator("thead th")).toHaveText(["Row", "Website", "Username or email", "Password"]);

  const imported = page.waitForResponse((response) => response.url().endsWith("/api/vault/import"));
  await dialog.getByRole("button", { name: "Import 2 items" }).click();
  expect((await imported).status()).toBe(200);
  await expect(dialog).toBeHidden();
  await page.getByRole("textbox", { name: "Search the vault" }).fill(stamp);
  await expect(page.locator(".mb-set-row__label")).toHaveText([`second-${stamp}.example`, `first-${stamp}.example`]);
  await deleteItems(page, stamp);
});

test("an import that stops part way adds only the rest when it's run again", async ({ page }) => {
  const stamp = `e2e${Date.now()}`;
  const file = ["Name,Email", ...Array.from({ length: 150 }, (_, index) => `Person ${index} ${stamp},p${index}@example.com`)].join("\n");
  // The second batch fails once, as when the server it reached goes away mid-import.
  let calls = 0;
  await page.route("**/api/vault/import", (route: Route) => {
    calls += 1;
    if (calls !== 2) return route.continue();
    return route.fulfill({ status: 503, contentType: "application/json", headers: { [MADE_UP]: "1" }, body: JSON.stringify({ error: "Mercbot is busy.", code: "made_up" }) });
  });
  await openVault(page);
  await newItem(page, "Import from a CSV file");
  const dialog = page.locator('.v-overlay--active .v-card[aria-label="Import from a CSV file"]');
  await dialog.locator("input[type=file]").setInputFiles({ name: "contacts.csv", mimeType: "text/csv", buffer: Buffer.from(file) });
  await dialog.getByRole("button", { name: "Import 150 items" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Added 100 items before the import stopped. Mercbot is busy. Select Import to add the others.");
  await expect(dialog.getByText("50 items will be added.")).toBeVisible();
  // The dialog scrolls rather than squeeze its preview or its message, which would hide their ends.
  const squeezed = () => dialog.locator(".mb-import__preview, [role=alert]").evaluateAll((parts) => parts.filter((part) => part.scrollHeight > part.clientHeight + 1).length);
  await expect(dialog.locator(".mb-import__preview tbody tr")).toHaveCount(5);
  await expect.poll(squeezed).toBe(0);

  await dialog.getByRole("button", { name: "Import 50 items" }).click();
  await expect(dialog).toBeHidden();
  expect(calls).toBe(3);
  await page.getByRole("textbox", { name: "Search the vault" }).fill(stamp);
  await expect(page.locator(".mb-set-row__label")).toHaveCount(150);
  await deleteItems(page, stamp);
});

test("contact details read from a photo or the camera fill the form, to be checked before saving", async ({ page }) => {
  const stamp = `e2e${Date.now()}`;
  const photos: string[] = [];
  await page.route("**/vault/read-photo", async (route: Route) => {
    const request = route.request();
    photos.push(`${request.headers()["content-type"]?.split(";")[0]} ${(request.postDataBuffer() || Buffer.alloc(0)).includes("image/jpeg") ? "jpeg" : "other"}`);
    const fields = { fullName: `Ada Lovelace ${stamp}`, email: "ada@example.com", city: "London", country: "Uruguay" };
    return route.fulfill({ status: 200, contentType: "application/json", headers: { [MADE_UP]: "1" }, body: JSON.stringify({ fields }) });
  });
  await openVault(page);
  await newItem(page, "Contact info");
  const form = page.locator("form.mb-item");
  await expect(form.getByText("Google's Gemini reads it; Mercbot doesn't keep the photo.")).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await form.getByRole("button", { name: "Upload a photo" }).click();
  await (await chooser).setFiles({ name: "card.png", mimeType: "image/png", buffer: PICTURE });
  await expect(form.getByText("Filled in from the photo. Check each detail before saving.")).toBeVisible();
  await expect(form.getByLabel("Full name")).toHaveValue(`Ada Lovelace ${stamp}`);
  await expect(form.getByLabel("City")).toHaveValue("London");
  await expect(form.getByLabel("Country")).toHaveValue("Uruguay");
  expect(photos).toEqual(["multipart/form-data jpeg"]);

  // The camera: on while its view shows, and off again once the photo is taken.
  await form.getByLabel("Full name").fill("");
  await form.getByRole("button", { name: "Scan with camera" }).click();
  const view = form.getByLabel("Camera view");
  await expect(view).toBeVisible();
  await expect.poll(() => view.evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
  await form.getByRole("button", { name: "Take photo" }).click();
  await expect(view).toBeHidden();
  await expect(form.getByLabel("Full name")).toHaveValue(`Ada Lovelace ${stamp}`);
  expect(photos).toEqual(["multipart/form-data jpeg", "multipart/form-data jpeg"]);

  const saved = page.waitForResponse((response) => response.url().endsWith("/api/vault") && response.request().method() === "POST");
  await form.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(200);
  await expect(form).toBeHidden();
  await expect(page.locator(".mb-set-row__label", { hasText: stamp })).toHaveText(`Ada Lovelace ${stamp}`);
  await deleteItems(page, stamp);
});

test("the camera is on only while its view shows, however Scan with camera is pressed", async ({ page }) => {
  // Every camera track the page starts (the real streams), to see each turned off again.
  await page.addInitScript(() => {
    const media = navigator.mediaDevices;
    const start = media.getUserMedia.bind(media);
    const tracks: MediaStreamTrack[] = [];
    Object.assign(window, { cameraTracks: tracks });
    media.getUserMedia = async (constraints) => {
      const stream = await start(constraints);
      tracks.push(...stream.getTracks());
      return stream;
    };
  });
  const states = () => page.evaluate(() => (window as unknown as { cameraTracks: MediaStreamTrack[] }).cameraTracks.map((track) => track.readyState));
  await openVault(page);
  await newItem(page, "Contact info");
  const form = page.locator("form.mb-item");
  const view = form.getByLabel("Camera view");

  // A double press starts one camera, and Cancel turns it off.
  await form.getByRole("button", { name: "Scan with camera" }).dblclick();
  await expect.poll(() => view.evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
  await expect.poll(states).toEqual(["live"]);
  await form.locator(".mb-photo").getByRole("button", { name: "Cancel" }).click();
  await expect(view).toBeHidden();
  await expect.poll(states).toEqual(["ended"]);

  // Closing the form while the camera shows turns it off too.
  await form.getByRole("button", { name: "Scan with camera" }).click();
  await expect.poll(states).toEqual(["ended", "live"]);
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await expect.poll(states).toEqual(["ended", "ended"]);
});

test("a card is never read from a photo", async ({ page }) => {
  await openVault(page);
  await newItem(page, "Card");
  const form = page.locator("form.mb-item");
  for (const name of ["Scan with camera", "Upload a photo"]) {
    const button = form.getByRole("button", { name });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("title", "Cards aren't read from photos: a card's number never goes to an AI");
  }
});
