import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";
import PLACEMENT_EXTENSIONS from "./placementExtensions.js";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

export { addPlacement };

export default function getPlacements() {
  return registry.build();
}

addPlacement({
  id: "account-app.home.menu.home",
  target: "shell.primary-nav",
  kind: "link",
  surfaces: ["home"],
  order: 50,
  props: {
    label: "Home",
    surface: "home",
    scopedSuffix: "/",
    unscopedSuffix: "/",
    exact: true
  }
});

addPlacement({
  id: "auth.profile.widget",
  target: "shell.status",
  kind: "component",
  surfaces: ["*"],
  order: 1000,
  componentToken: "auth.web.profile.widget"
});

addPlacement({
  id: "users.profile.menu.settings",
  target: "auth.profile-menu",
  kind: "link",
  surfaces: ["*"],
  order: 500,
  when: (context) => context?.auth?.authenticated === true,
  props: {
    label: "Account settings",
    to: "/account"
  }
});

addPlacement({
  id: "users.account.settings.profile",
  target: "settings.sections",
  owner: "account-settings",
  kind: "component",
  surfaces: ["account"],
  order: 100,
  componentToken: "local.main.account-settings.section.profile",
  props: {
    value: "profile",
    title: "Profile",
    usesSharedRuntime: true
  }
});

addPlacement({
  id: "users.account.settings.preferences",
  target: "settings.sections",
  owner: "account-settings",
  kind: "component",
  surfaces: ["account"],
  order: 200,
  componentToken: "local.main.account-settings.section.preferences",
  props: {
    value: "preferences",
    title: "Preferences",
    usesSharedRuntime: true
  }
});

// No Notifications section: Mercbot sends no product, activity or security emails yet, so its
// switches would control nothing (they come back with the first such email).
addPlacement({
  id: "mercbot.account.settings.usage",
  target: "settings.sections",
  owner: "account-settings",
  kind: "component",
  surfaces: ["account"],
  order: 280,
  componentToken: "local.main.account-settings.section.usage",
  props: {
    value: "usage",
    title: "Spending"
  }
});

addPlacement({
  id: "mercbot.account.settings.bots",
  target: "settings.sections",
  owner: "account-settings",
  kind: "component",
  surfaces: ["account"],
  order: 250,
  componentToken: "local.main.account-settings.section.bots",
  props: {
    value: "bots",
    title: "Bots"
  }
});

// What a copy built on Mercbot adds (src/placementExtensions.js). A person's own copy (D-81) has no signing in or out.
for (const placement of PLACEMENT_EXTENSIONS) addPlacement(placement);
