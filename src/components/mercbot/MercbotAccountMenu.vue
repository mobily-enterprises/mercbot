<script setup>
import { computed, ref } from "vue";
import { accountApi, nanoMoney } from "./accountApi.js";
import extensions from "./extensions.js";
import { monthLabel } from "./spendingView.js";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";

// Account button plus its menu (D-16). The first row shows this month's spending (D-73), with
// a submenu leading to Settings → Spending; help opens a new tab; the support submenu also opens the shortcuts sheet and
// the about dialog (the shell shows them). A copy built on Mercbot adds its own items (extensions.js), such as another
// account and signing out: a person's own copy has neither (D-81).
const paths = usePaths();
const props = defineProps({
  displayName: { type: String, required: true },
  initials: { type: String, required: true },
  // The person's own picture, shown in place of their initials when they have one.
  picture: { type: String, default: "" },
  expandable: { type: Boolean, default: true },
  // In the sidebar footer the name gives way to the Connect apps pill while the footer is hovered,
  // unless the menu is open.
  collapsed: { type: Boolean, default: false },
  rail: { type: Boolean, default: false }
});
const emit = defineEmits(["shortcuts", "about", "settings", "usage"]);
// The items a copy built on Mercbot adds, by where they go. One not for everyone is asked whether the person sees it
// once, the first time the menu opens; one whose answer failed is asked again the next time.
const shown = ref(new Set());
const asked = new Set();
function askVisible() {
  for (const item of extensions.accountMenu) {
    if (!item.visible || asked.has(item.title)) continue;
    asked.add(item.title);
    item.visible().then(
      (yes) => {
        if (yes) shown.value = new Set([...shown.value, item.title]);
      },
      () => asked.delete(item.title)
    );
  }
}
const added = (place) => extensions.accountMenu.filter((item) => item.place === place && (!item.visible || shown.value.has(item.title)));

const menuOpen = ref(false);
const usage = ref(null);
const named = computed(() => props.expandable && (menuOpen.value || !props.collapsed));
// A picture that doesn't load (its storage is unavailable, say) gives way to the initials until the picture changes.
const brokenPicture = ref("");
const showsPicture = computed(() => Boolean(props.picture) && brokenPicture.value !== props.picture);

function setMenuOpen(value) {
  menuOpen.value = value;
  if (!value) return;
  askVisible();
  accountApi.usage().then((result) => { usage.value = result; }).catch(() => {});
}

// The row shows this month's spending (D-73), the whole home's for its owners and admins and a member's own. Its
// submenu says whose it is, or what a copy built on Mercbot adds under it (the summary's `note`, shown as needing
// attention when `attention` says so), and leads to Settings → Spending: by "See spending", and by the summary's
// `action` when a copy names one.
const useText = () => (usage.value ? nanoMoney(usage.value.monthNano) : "");
function noteText() {
  if (!usage.value) return "Checking your spending…";
  if (usage.value.note) return usage.value.note;
  return usage.value.scope === "home" ? "Everyone in this home" : "Your bots' work for you";
}
function leave(path) {
  menuOpen.value = false;
  window.open(path, "_blank", "noopener");
}

function support(event) {
  menuOpen.value = false;
  emit(event);
}

function choose(item) {
  menuOpen.value = false;
  item.run();
}
</script>

<template>
  <v-menu
    :model-value="menuOpen"
    location="top start"
    origin="bottom start"
    :offset="6"
    content-class="mb-popover"
    @update:model-value="setMenuOpen"
  >
    <template #activator="{ props: menuProps }">
      <button
        v-bind="menuProps"
        type="button"
        class="mb-account"
        :class="{ 'mb-account--rail': rail, 'mb-account--expanded': named }"
        :aria-label="displayName"
      >
        <img v-if="showsPicture" class="mb-account__picture" :src="picture" alt="" @error="brokenPicture = picture">
        <span v-else class="mb-account__initials">{{ initials }}</span>
        <span v-if="named" class="mb-account__name">{{ displayName }}</span>
      </button>
    </template>

    <v-list density="compact" class="mb-account-menu py-1" width="228" :prepend-gap="8">
      <v-menu open-on-hover location="end top" :offset="4" content-class="mb-popover">
        <template #activator="{ props: spendingProps }">
          <v-list-item v-bind="spendingProps" min-height="32" class="mb-account-menu__item px-3">
            <template #prepend><v-icon icon="$speed" size="14" /></template>
            <span class="mb-account-menu__text">Spending</span>
            <template #append>
              <span class="mb-account-menu__note">{{ useText() }}</span>
              <v-icon icon="$chevronRight" size="14" />
            </template>
          </v-list-item>
        </template>
        <div class="mb-spending">
          <div class="mb-spending__line">
            <span class="mb-spending__name">{{ usage ? monthLabel(usage.month, { year: false }) : "This month" }}</span>
            <span class="mb-spending__figure">{{ useText() }}</span>
          </div>
          <p class="mb-spending__note" :class="{ 'mb-spending__note--attention': usage?.note && usage.attention }">{{ noteText() }}</p>
          <v-divider class="my-1" />
          <v-list density="compact" class="py-0">
            <v-list-item v-if="usage?.action" min-height="32" class="px-3" @click="support('usage')">
              <span class="mb-account-menu__text">{{ usage.action }}</span>
            </v-list-item>
            <v-list-item min-height="32" class="px-3" @click="support('usage')">
              <span class="mb-account-menu__text">See spending</span>
            </v-list-item>
          </v-list>
        </div>
      </v-menu>
      <v-list-item v-for="item in added('menu')" :key="item.title" min-height="32" class="mb-account-menu__item px-3" @click="choose(item)">
        <template #prepend><v-icon :icon="item.icon" size="14" /></template>
        <span class="mb-account-menu__text">{{ item.title }}</span>
      </v-list-item>
      <v-menu open-on-hover location="end top" :offset="4" content-class="mb-popover">
        <template #activator="{ props: supportProps }">
          <v-list-item v-bind="supportProps" min-height="32" class="mb-account-menu__item px-3">
            <template #prepend><v-icon icon="$support" size="14" /></template>
            <span class="mb-account-menu__text">Help and support</span>
            <template #append><v-icon icon="$chevronRight" size="14" /></template>
          </v-list-item>
        </template>
        <v-list density="compact" class="mb-account-menu py-1" width="178" :prepend-gap="8">
          <v-list-item min-height="32" class="px-3" @click="leave(paths.page('/', { surface: 'help' }))">
            <template #prepend><v-icon icon="$menuBookFilled" size="14" /></template>
            <span class="mb-account-menu__text">Help centre</span>
          </v-list-item>
          <v-list-item min-height="32" class="px-3" @click="support('shortcuts')">
            <template #prepend><v-icon icon="$keyboard" size="14" /></template>
            <span class="mb-account-menu__text">Keyboard shortcuts</span>
          </v-list-item>
          <v-list-item min-height="32" class="px-3" @click="support('about')">
            <template #prepend><v-icon icon="$info" size="14" /></template>
            <span class="mb-account-menu__text">About Mercbot</span>
          </v-list-item>
          <v-list-item v-for="item in added('support')" :key="item.title" min-height="32" class="px-3" @click="choose(item)">
            <template #prepend><v-icon :icon="item.icon" size="14" /></template>
            <span class="mb-account-menu__text">{{ item.title }}</span>
          </v-list-item>
        </v-list>
      </v-menu>
      <v-list-item min-height="32" class="mb-account-menu__item px-3" @click="support('settings')">
        <template #prepend><v-icon icon="$settings" size="14" /></template>
        <span class="mb-account-menu__text">Settings</span>
      </v-list-item>
      <template v-if="added('foot').length">
        <v-divider class="my-1" />
        <v-list-item v-for="item in added('foot')" :key="item.title" min-height="32" class="mb-account-menu__item px-3" @click="choose(item)">
          <template #prepend><v-icon :icon="item.icon" size="14" /></template>
          <span class="mb-account-menu__text">{{ item.title }}</span>
        </v-list-item>
      </template>
    </v-list>
  </v-menu>
</template>

<style scoped>
.mb-account {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 36px;
  min-width: 36px;
  padding: 0;
  font: inherit;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 18px;
  background: rgb(var(--v-theme-surface-container-highest));
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}

.mb-account:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}

.mb-account--expanded {
  width: 170px;
}

.mb-account--rail {
  background: rgb(var(--v-theme-surface));
  border-color: rgb(var(--v-theme-outline-variant));
}

.mb-account__initials {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 34px;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-account__picture {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
}

.mb-account__name {
  overflow: hidden;
  padding-right: 14px;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-account-menu__text {
  font-size: 13px;
  white-space: nowrap;
}

.mb-spending {
  width: 226px;
  padding: 8px 0 4px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}

.mb-spending__line {
  display: flex;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 13px;
}

.mb-spending__figure {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-spending__note {
  margin: 2px 0 6px;
  padding: 0 12px;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-spending__note--attention {
  color: rgb(var(--v-theme-error));
}

.mb-account-menu__note {
  margin-right: 4px;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
