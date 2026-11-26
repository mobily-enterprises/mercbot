import MercbotDialogFrame from "./components/mercbot/MercbotDialogFrame.vue";
import MercbotUiButton from "./components/mercbot/MercbotUiButton.vue";

// JSKIT's own screens (sign-in, registration, password reset, email change, sign-out, two-step sign-in and its confirm
// dialog) in Mercbot's look, through shell-web's UI kit (docs/ui-style.md, section 6): Mercbot's pills and text button,
// its dialog frame, and its type scale (section 2) for each text role. src/main.js provides it. Their fields, the Sign in
// and Register switch, the checkbox, the card and the alerts stay Vuetify's, drawn by the theme.
export const shellUi = Object.freeze({
  Button: MercbotUiButton,
  Dialog: MercbotDialogFrame,
  text: Object.freeze({
    title: "mb-text-22 mb-text-strong",
    heading: "mb-text-18 mb-text-strong",
    subheading: "mb-text-15 mb-text-strong",
    strong: "mb-text-13 mb-text-strong",
    lead: "mb-text-14",
    body: "mb-text-13",
    caption: "mb-text-12"
  })
});
