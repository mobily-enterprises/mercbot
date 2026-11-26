# Mercbot UI style: "Quiet Desk" (working name)

Mercbot's own visual style, written as rules a person or an AI can check on a screen. It is not Material Design 3,
although its colours come from JSKIT's generated Material 3 colour roles. When building or changing a screen, this
guide takes precedence over JSKIT's Material 3 guidance. It was measured from source and then on the running app at
1280 and 390px wide, light and dark (2026-11-25); where the two differed, the running app's values are written here.

Counts in brackets are how often a value occurred in the component styles (`src/components/mercbot`,
`src/components/apps`, `src/components/help`, `src/styles`) when the guide was written; they show what was usual, not a
target. Where a screen still differs from a rule, the rule holds and the screen is changed when it is next touched or
in a UI pass.

## 1. Colour

- **Roles only.** Every UI colour is a theme role written `rgb(var(--v-theme-<role>))` (or `rgba(...)` for a tint).
  The roles are generated for light and dark from one seed, `#0B6DD3` (`src/theme/index.js`, through
  `createMaterialVuetifyOptions` in `src/main.js`). No hex colour in a component.
- **The accent is the open bot.** `primary` and `on-primary` are the open bot's colour and white
  (`src/components/mercbot/accent.js` `resolveAccent`, applied by `useShellTheme.js`). For a black bot, or with the
  Accent setting on black, `primary` draws `#1C1C1C` in light and `#F5F5F5` in dark, and the person's own bubbles are
  `inverse-surface` (`#2E3036` light, `#E2E2E9` dark).
- **Outside the shell** (the sign-in pages, and any page without a home's shell) there is no open bot: `primary` is the
  seed's generated primary, `#405F90`.
- **Link blue stays put.** The `link` role is for links (a plain link takes it from `a` in `src/styles/mercbot.css`), a switch that is on and a black bot's chosen options
  (`accent.js` `choiceColor`), whatever the accent. It is generated from `#0B6DD3` and draws `#005DB7` in light and
  `#A9C7FF` in dark.
- **Content colours are content.** Bots', homes', apps', charts' and avatar art's colours come only from
  `src/theme/palettes.js`, used as they are in light and dark, and never for chrome (buttons, borders, backgrounds).
- **Surfaces.** The page is `background` (`#F9F9FF` light); the sidebar sits on `surface-container-low` (`#F3F3FA`)
  with a 1px `outline-variant` right border; panels, the bot side of bubbles and fields sit on `surface` or
  `surface-variant`, which draws a neutral grey (`#F0F0F0` light, `#1F1F1F` dark); neutral buttons and hover fills
  use `surface-container-high` (hover: `surface-container-highest`) (`src/styles/mercbot.css` `.mb-set-pill`,
  `MercbotIconButton.vue`).
- **Borders separate.** A surface is set apart by `1px solid` `outline-variant` [113]; `outline` only for a focused
  or stronger edge [6] (`MercbotChatPanel.css` `.mb-composer--focused`).
- **Filled buttons** are the pill (section 6): `neutral` on `surface-container-high`, `dark` for the main action on
  `inverse-surface` with `inverse-on-surface` text, `danger` on `error` with `on-error` text.
- **Disabled**, in every tone: the fill is `on-surface` at 12% and the text `on-surface` at 38%.
- **Secondary text** is `on-surface-variant` (hints, captions, timestamps, section titles).

## 2. Type

- **One font:** the system UI stack, `system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "DejaVu Sans",
  sans-serif`, for body text and headings alike: `src/styles/mercbot.css` sets `--v-font-body`, and sets
  `--v-font-heading` to the same stack in place of JSKIT's Roboto Flex.
- **Sizes in px, on this scale only**, set in a component's own CSS or with the scale's classes in
  `src/styles/mercbot.css` (`.mb-text-11`, `-12`, `-13`, `-14`, `-15`, `-18`, `-22`, and `.mb-text-strong` for 600).
  No Material type classes (`text-body-small`, `text-title-large`, `text-h*`, ...):
  - 11px: the smallest labels (badges, counts) [14].
  - 12px: secondary text, captions, tooltips, hints, section titles [122]; 16 to 18px line height.
  - 13px: ordinary UI text, buttons, rows [213]; with 18px line height.
  - 14px: message and reply text, 22px line height (`.mb-rich`, `src/styles/mercbot.css`) [96].
  - 15px: a chat's name in its header chip (`.mb-chip__name`, `MercbotChatPanel.css`) and list names [26].
  - 16 to 22px: page and section titles [23 in all]: 18px for a section's title, 22px for a page's. A dialog's
    title is the frame's own (section 6).
- **Weights:** 400 regular and 600 for emphasis. 700 only for headings inside a bot's reply (`.mb-rich h1..h4`,
  14px/700, the same size as its text). No 500.
- **Overflow:** names and one-line labels truncate with an ellipsis (`overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap`), never wrap, in rows, chips, menus and headers.

## 3. Spacing and density

- **Steps of 2px**, mostly 8, 6, 4, 12 and 10: `gap` 8px [104], 6px [57], 4px [49], 12px [39], 10px [37], 2px [28].
- **Dialogs** pad 24px [9]; cards and panels 16px [6]; pills 0 14px; the header chip 0 12px 0 10px.
- **Compact rows:** sidebar rows are one line, 32px high, with a 24px avatar (`MercbotChatList.vue`), 2px apart
  (`.mb-rows`); section headers 24px high, 12px text (`MercbotChatList.css` `.mb-header`).
- **Control heights:** pill buttons 30px; the header chip and surface icon buttons 40px; the account button 36px; the
  composer at least 44px (56px as it draws with one line); switches 20px high, 36px wide (`MercbotSwitch.vue`).

## 4. Shape

- **Three radii for rectangles:** 8px small (chips, fields, tooltips, small buttons and tiles), 12px medium (popovers,
  menus, hover cards, cards, panels), 16px large (dialogs, message bubbles). A rectangle takes the radius of what it
  is, from that list; one written 10 or 14px today moves to the one its kind names.
- **Pills are half their height:** 30px pill buttons have 15px corners, the 36px account button 18px, the 40px header
  chip 20px, a 22px badge 11px, the composer half of its drawn height (`.mb-set-pill`, `.mb-account`, `.mb-chip`,
  `.mb-composer`). The person's own message bubble is a pill while it is one line (18px corners on 36px).
- **Circles** (`50%`) for avatars, badges and dots [51].
- Fixed points: the shared dialog 16px, square when full-screen on a phone (`MercbotChangeTemplateDialog.css`
  `.mb-ctemp`); popovers, menus and hover cards 12px (`src/styles/mercbot.css` `.mb-popover`, `.mb-hover-card`);
  tooltips and Vuetify chips 8px.

## 5. Depth

- **No Material elevation levels.** Two shadows only, both in `src/styles/mercbot.css`:
  - `--mb-shadow-soft` (`0 2px 8px` shadow at 8%): things that float over the chat itself: the header chip, the
    composer [10].
  - `--mb-shadow-popover` (`0 4px 12px` at 12%): tooltips, popovers, menus, hover cards, the phone's drawer [13].
- Everything else is flat and separated by its 1px `outline-variant` border or by surface tone.

## 6. Components

- **Header chip** (`MercbotChatPanel.vue` / `.css` `.mb-chip`): the open chat's avatar, name (15px) and a one-line
  subtitle (Public or Private and who's in it) in a 40px pill on `surface`, 1px `outline-variant` border,
  `--mb-shadow-soft`, centred above the chat. Next to it, 40px circular surface icon buttons (Invite, details).
- **Pill button**: every filled button. One shared component, `MercbotPill.vue` (`tone`: `neutral`, `dark`, `danger`;
  its look is `.mb-set-pill` in `src/styles/mercbot.css`), 30px high, 0 14px padding, 15px corners, 13px/400 text,
  in three tones: `neutral` (`surface-container-high`), `dark` for the main action of a form or dialog
  (`inverse-surface` / `inverse-on-surface`) and `danger` for a destructive one (`error` / `on-error`). Disabled as in
  section 1. Its copies (`.mb-set-pill` in `src/styles/mercbot.css`, `.mb-ctemp__button`, `.mb-tdraft__button`,
  `.mb-discussion__button`, the 34px one in `MercbotPageWebsite.vue`, the outlined `.mb-chat__leave`) all use it.
- **Low-emphasis actions** are `v-btn variant="text"`. No `flat` or `tonal` `v-btn`.
- **Icon buttons** (`MercbotIconButton.vue`): circular, with a tooltip naming them; tones: `surface` (`surface` fill,
  1px `outline-variant` border), `secondary` (`surface-container-high` fill), `bare` (transparent). Sizes are Vuetify's
  (default 40, `small`, `x-small`), never a fixed height.
- **Message bubbles** (`MercbotTimeline.css`): a bot's on `surface-variant` with a 1px `outline-variant` border, 16px
  corners, 6px 12px padding, at most 560px wide; the person's own on the accent with a transparent border and 18px
  corners.
- **Composer** (`MercbotChatPanel.css` `.mb-composer`): a pill on `surface`, at least 44px high, 1px `outline-variant`
  border (`outline` when focused), `--mb-shadow-soft`; **+** at the start, the send button at the end as a filled
  circle.
- **Rich text** (`src/styles/mercbot.css` `.mb-rich`): 14px/22px, paragraphs 10px apart, quotes with a 2px
  `outline-variant` left rule, links in `on-surface` underlined in `outline-variant`.
- **Switch** (`MercbotSwitch.vue`), everywhere a setting turns on and off: a 36 by 20px track, `link` when on and
  `surface-container-highest` off, a 16px knob; focus ring as in section 10. Never Vuetify's `v-switch`.
- **Tooltip** (`MercbotTooltip.vue`, `.mb-tooltip`): 24px minimum height, 4px 8px padding, 8px corners, `surface` with
  `--mb-shadow-popover`, 12px/16px text, 50ms transition.
- **Hover card** (`.mb-hover-card`): up to 260px, 10px 12px padding, 12px corners, `surface-container`, popover shadow,
  12px text with a 13px/600 title.
- **Dialog:** the shared frame of `MercbotChangeTemplateDialog.css` (`.mb-ctemp`): a 55px head with the title (15px/600,
  18px on a phone) and close (first on a phone, last otherwise), a body, and a foot with the actions, the main one a `dark` pill; 16px corners. On a phone it fills the
  screen (`:fullscreen="phone"`); otherwise centred, at most 420 to 760px wide, and 900px for Settings. Dialogs built
  another way (a `v-card`, or a layout of their own) move onto this frame when they are next touched.
- **Lists, chips, fields, tabs, menus:** Vuetify's `v-list-item`, `v-chip` (8px corners), `v-text-field` /
  `SelectField` (outlined, `comfortable` density where set, 8px corners), `v-tabs`, `v-menu` with the `mb-popover`
  content class.
- **Icons:** `$`-named aliases (Material Symbols through JSKIT, plus `src/theme/icons.js`); 16 to 18px in buttons and
  rows, 11px for the Public or Private mark beside a name.
- **Avatars:** bots are drawn faces in their colour (`MercbotAvatar.vue`), people are initials on
  `surface-container-highest`, a chat with several members a composite of them (`MercbotChatAvatar.vue`).
- **Pinned chats** are left out of this guide until the change to the home's everyone chat lands; then they are
  row-height chips.

## 7. Shell and navigation

- **Columns** (`src/components/mercbot/shellGeometry.js`): the sidebar 240 to 400px, resizable, folding to an 88px rail
  under 704px or when compact; the chat at least 424px, its content at most 960px wide; the details panel 280 to 336px,
  docked when there is room, otherwise sliding over the chat.
- **Sidebar** (`MercbotSidebar.vue`, `MercbotChatList.vue`): the home switcher, Search, Files and Apps at the top;
  then **Rooms**, **People** and **Bots**, each a 12px `on-surface-variant` title with a **+**, folding when its title
  is clicked; the account button at the foot.
- **Phone, under 600px** (`PHONE_BELOW`): the chat fills the screen and the sidebar is a drawer from the left over a
  scrim (`scrim` at 18%), opened by the header's menu button and closed by a tap outside, a swipe toward the edge or
  choosing a chat (`MercbotDrawer.vue`, `drawerSwipe.js`).
- **Breakpoints:** one phone breakpoint, written `@media (max-width: 599px)` everywhere in CSS. Any other width comes
  only from `shellGeometry.js`'s named sizes, never a number of its own.

## 8. Motion

- **Short and plain:** 150 to 200ms for state changes [10 of 20 transitions]; tooltips 50ms; the phone drawer slides
  in and out in 200ms `cubic-bezier(0.4, 0, 0.2, 1)` (`MercbotDrawer.vue`), as Vuetify's drawers do.
- **Only `transform` and `opacity` animate** for anything that moves on screen (the drawer, previews, toasts).
- **Reduced motion is honoured:** each animation has a `@media (prefers-reduced-motion: reduce)` rule that removes it
  (8 places, e.g. `MercbotChatPanel.css`, `MercbotTimelineCards.css`, `MercbotAvatar.vue`, `MercbotDrawer.vue`).

## 9. States and feedback

- **Loading:** a `v-skeleton-loader` in the shape of what is coming [24: text, list-item-two-line, table, card,
  heading]; a control's own loading line where it has one; a spinner only where nothing has a shape yet (2, e.g. the
  sign-out card).
- **Empty:** one short line in `on-surface-variant`, 12 to 13px, saying what would be there, with the action that adds
  it beside or under it (`MercbotChatList.css` `.mb-empty-hint`, each section's "+ ..." row).
- **Errors where they happened:** a load that failed shows a `v-alert` in place, `variant="tonal"`,
  `density="compact"`, `type="error"` / `warning` / `info` [16]; a failed action is reported through JSKIT's
  action feedback (`errorRuntime.report(... intent: "action-feedback")` in `MercbotShell.vue`), which shows a snackbar
  that doesn't move the page.
- **Refusals** show the server's own sentence (`accountApi.js` `refusedWork`, `MercbotShell.vue` `reportFailure`).

## 10. Focus and keyboard

- **Focus ring:** `outline: 2px solid` `secondary` with `outline-offset: 2px` on `:focus-visible`, always; `-2px` only
  inside a tight list where a 2px offset would be clipped. No other colour.
- Every icon-only control has a name (`MercbotIconButton.vue`'s `label`), shown as its tooltip too.

## 11. Dark mode

- Light, dark or system, system by default, in Settings → Preferences (`useShellTheme.js`); the same roles in both
  schemes. Content colours don't change; a black bot draws near-white (`accent.js` `resolveBotColor`).

## 12. Phone widths

- Under 600px: full-screen dialogs, the drawer (section 7), and the composer and header chip as on a computer.
- The app keeps clear of a notch and home bar with `env(safe-area-inset-*)` (`src/styles/mercbot.css` `.mb-shell`);
  on a touch screen at least 16px text in fields, so iPhone Safari doesn't zoom; no double-tap zoom
  (`touch-action: manipulation`); text never touches the screen's edge.

## Front page

The site's own pages for people who haven't signed in yet (a front page, an about page, a phone page and the welcome
before signing in) are a page design of their own, and may differ from the app in two ways only:

- **Display sizes:** headlines and a wordmark from 24 to 70px, beside the scale of section 2 for everything else.
- **Two page breakpoints:** `@media (max-width: 899px)` for a narrow window and the phone's `(max-width: 599px)`.

Everything else holds as in the app: roles only, 400 and 600 weights, the two shadows, the radii of section 4, the
pill for filled buttons and the `secondary` focus ring.

## UI pass method

A UI pass checks screens against this guide, never against Material 3, and changes only how they look and behave
visually, never what they do.

1. **Resolve the scope.** The whole app: every screen and dialog reachable from the shell (the sidebar, a chat, chat
   details, Settings and each of its sections, Files, Apps, Library, the account menu, the help centre and sign-in). A
   section: every screen in it. A change: the screens the changed files draw.
2. **List each screen's parts** against sections 1 to 12: colours (roles, accent, content colours), type, spacing,
   shape, depth, components, states, focus, dark mode, phone.
3. **Read the source** of each part: no hex colours; borders, shadows, radii, sizes and weights from the values above;
   components from section 6 rather than a new look-alike.
4. **Look at it.** In Preview, at 1280px and 390px, light and dark, signed in: screenshot each screen and each state
   (loading, empty, error, full), Tab through it once to see the focus ring, and compare with the rules. A computed
   style read (`getComputedStyle`) settles a size or colour; read theme roles on `.mb-shell`, where the accent applies.
5. **Fix each difference** in the component that owns it, so every screen using it follows.
6. **Check:** `npx jskit check` (its navigation rules are required; its Material 3 rules still run), `npm run lint`,
   the client tests of the changed components, and screenshots after the fix at the same widths and schemes.
7. **Report** each screen checked, what differed, what changed with its file, and the screenshots taken.
