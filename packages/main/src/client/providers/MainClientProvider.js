import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import AccountSettingsBotsSection from "/src/components/account/settings/AccountSettingsBotsSection.vue";
import AccountSettingsUsageSection from "/src/components/account/settings/AccountSettingsUsageSection.vue";
import AccountSettingsPreferencesSection from "/src/components/account/settings/AccountSettingsPreferencesSection.vue";
import AccountSettingsProfileSection from "/src/components/account/settings/AccountSettingsProfileSection.vue";
import MenuLinkItem from "/src/components/menus/MenuLinkItem.vue";
import SurfaceAwareMenuLinkItem from "/src/components/menus/SurfaceAwareMenuLinkItem.vue";
import TabLinkItem from "/src/components/menus/TabLinkItem.vue";

const MainClientProvider = defineProvider({
  id: "local.main.client",
  requires: {
    components: "client.components"
  },
  setup({ components }) {
    components.register("local.main.ui.menu-link-item", MenuLinkItem);
    components.register("local.main.ui.surface-aware-menu-link-item", SurfaceAwareMenuLinkItem);
    components.register("local.main.ui.tab-link-item", TabLinkItem);
    components.register("local.main.account-settings.section.profile", AccountSettingsProfileSection);
    components.register("local.main.account-settings.section.preferences", AccountSettingsPreferencesSection);
    components.register("local.main.account-settings.section.bots", AccountSettingsBotsSection);
    components.register("local.main.account-settings.section.usage", AccountSettingsUsageSection);
  }
});

export { MainClientProvider };
