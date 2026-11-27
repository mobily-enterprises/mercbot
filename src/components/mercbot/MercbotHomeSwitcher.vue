<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { currentHome } from "./homeApi.js";
import { roleLabel, useHomes } from "./homesApi.js";
import MercbotNewHomeDialog from "./MercbotNewHomeDialog.vue";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { HOME_TILES, ON_IDENTITY } from "@/theme/palettes.js";

// The home switcher (D-36), top left of the sidebar: which home you're in, the others you belong to, and Create a home,
// which opens New home (MercbotNewHomeDialog.vue: only the home's name, D-109). A home's tile is its initial in a colour
// picked from its name, so the same home always looks the same.
const paths = usePaths();
const props = defineProps({
  rail: { type: Boolean, default: false }
});

const router = useRouter();
const { homes, current, load } = useHomes();
const open = ref(false);
const newHome = ref(false);

const tileColour = (home) => HOME_TILES[[...home.name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % HOME_TILES.length];
const tileStyle = (home) => ({ background: home ? tileColour(home) : HOME_TILES[0], color: ON_IDENTITY });
const initial = (home) => (home.name.trim()[0] || "H").toUpperCase();

function setOpen(value) {
  open.value = value;
  if (value) load({ fresh: true }).catch(() => {});
}

function go(home) {
  open.value = false;
  if (home.slug !== currentHome()) router.push(paths.page("/", { params: { workspaceSlug: home.slug } }));
}

function startNewHome() {
  open.value = false;
  newHome.value = true;
}
</script>

<template>
  <v-menu
    :model-value="open"
    location="bottom start"
    :offset="6"
    :close-on-content-click="false"
    content-class="mb-popover"
    @update:model-value="setOpen"
  >
    <template #activator="{ props: menuProps }">
      <button
        v-bind="menuProps"
        type="button"
        class="mb-home"
        :class="{ 'mb-home--rail': props.rail }"
        :aria-label="current ? `Home: ${current.name}. Switch home` : 'Switch home'"
      >
        <span class="mb-home__tile" :style="tileStyle(current)">{{ current ? initial(current) : "" }}</span>
        <template v-if="!props.rail">
          <span class="mb-home__name">{{ current?.name || "" }}</span>
          <v-icon icon="$expand" size="14" class="mb-home__chevron" />
        </template>
      </button>
    </template>

    <div class="mb-home-menu">
      <p class="mb-home-menu__label">Your homes</p>
      <v-list density="compact" class="py-0">
        <v-list-item
          v-for="home in homes || []"
          :key="home.id"
          min-height="40"
          class="mb-home-menu__item px-3"
          :aria-current="home.slug === currentHome() ? 'page' : undefined"
          @click="go(home)"
        >
          <template #prepend>
            <span class="mb-home__tile mb-home__tile--small" :style="tileStyle(home)">{{ initial(home) }}</span>
          </template>
          <span class="mb-home-menu__text">
            <span class="mb-home-menu__name">{{ home.name }}</span>
            <span class="mb-home-menu__role">{{ roleLabel(home.role) }}</span>
          </span>
          <template #append>
            <v-icon v-if="home.slug === currentHome()" icon="$check" size="16" />
          </template>
        </v-list-item>
      </v-list>
      <v-divider class="my-1" />
      <v-list density="compact" class="py-0">
        <v-list-item min-height="36" class="mb-home-menu__item px-3" @click="startNewHome">
          <template #prepend><v-icon icon="$add" size="16" /></template>
          <span class="mb-home-menu__text">Create a home</span>
        </v-list-item>
      </v-list>
    </div>
  </v-menu>
  <MercbotNewHomeDialog v-model:open="newHome" />
</template>

<style scoped>
.mb-home {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  height: 30px;
  padding: 0 4px 0 2px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  cursor: pointer;
}

.mb-home:hover,
.mb-home[aria-expanded="true"] {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-home:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}

.mb-home--rail {
  padding: 0;
  width: 32px;
  justify-content: center;
}

.mb-home__tile {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}

.mb-home__tile--small {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  font-size: 12px;
}

.mb-home__name {
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-home__chevron {
  flex: none;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-home-menu {
  width: 260px;
  padding: 6px 0;
  background: rgb(var(--v-theme-surface));
}

.mb-home-menu__label {
  margin: 2px 12px 4px;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-home-menu__item :deep(.v-list-item__prepend) {
  margin-right: 10px;
}

.mb-home-menu__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 14px;
}

.mb-home-menu__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-home-menu__role {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
