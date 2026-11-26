import { expect, openShell, test, type Page } from "./harness";

// Mercbot's one font (docs/ui-style.md, section 2), the system UI stack, for body text and headings alike, in light and
// dark. Vuetify declares the theme's font variables, --v-font-heading and --v-font-body, on every element that carries
// the theme's class (or the home's, workspace-light and -dark, made from it): <v-app>, and each dialog and menu it puts
// in the page's body. So an element with one of Material 3's type classes, which read them, computes the system font
// inside the app and in a dialog, as the page's plain text does, and not JSKIT's Roboto Flex. Screenshots of the
// shortcuts sheet, light and dark, are the output.
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const SYSTEM_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "DejaVu Sans", sans-serif';
// Brand classes (Vuetify's heading font) and plain ones (its body font), as Mercbot's screens use them (AppNode.vue,
// MercbotShortcutsDialog.vue, MercbotRoomProposal.vue, MercbotSidebarRow.vue).
const TYPE_CLASSES = ["text-headline-small", "text-title-large", "text-title-medium", "text-body-large", "text-body-medium", "text-body-small", "text-label-medium"];
const VARIABLES = ["--v-font-heading", "--v-font-body"];
const everywhere = (font: string) => Object.fromEntries([...TYPE_CLASSES, ...VARIABLES].map((name) => [name, font]));

/** The font each type class computes on an element put in `where`, and the two font variables `where` has. */
const fontsIn = (page: Page, where: string) => page.locator(where).first().evaluate((box, [classes, variables]) => {
  const probe = document.createElement("span");
  probe.textContent = "Mercbot";
  box.append(probe);
  const fonts: Record<string, string> = {};
  for (const name of classes) {
    probe.className = name;
    fonts[name] = getComputedStyle(probe).fontFamily;
  }
  probe.remove();
  for (const name of variables) fonts[name] = getComputedStyle(box).getPropertyValue(name).trim();
  return fonts;
}, [TYPE_CLASSES, VARIABLES]);

test("Material 3's type classes compute Mercbot's system font inside the app and in a dialog, light and dark", async ({ page }, testInfo) => {
  await openShell(page);
  try {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--(workspace-)?${scheme}\\b`, "u"));
      // The page's plain text: the shell inherits the font of the page itself.
      expect.soft(await page.locator(".mb-shell").evaluate((node) => getComputedStyle(node).fontFamily), `the shell's text, ${scheme}`).toBe(SYSTEM_FONT);
      expect.soft(await fontsIn(page, ".v-application"), `inside the app, ${scheme}`).toEqual(everywhere(SYSTEM_FONT));

      // The shortcuts sheet (Ctrl+/), a dialog in the page's body with the theme's class of its own; its title is
      // text-title-large.
      await page.keyboard.press("Control+/");
      const title = page.locator(".v-overlay--active .v-card-title", { hasText: /^Keyboard shortcuts$/u });
      await expect(title).toBeVisible();
      expect.soft(await title.evaluate((node) => getComputedStyle(node).fontFamily), `the shortcuts sheet's title, ${scheme}`).toBe(SYSTEM_FONT);
      expect.soft(await fontsIn(page, ".v-overlay--active .v-overlay__content"), `in a dialog, ${scheme}`).toEqual(everywhere(SYSTEM_FONT));
      await page.screenshot({ path: testInfo.outputPath(`shortcuts-${scheme}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(title).toBeHidden();
    }
  } finally {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  }
});
