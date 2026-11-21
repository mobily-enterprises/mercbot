<script setup>
import { computed, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { useRouter } from "vue-router";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { HOME_NAME_MAX, useHomes } from "./homesApi.js";
import { makeHome } from "./homeDefault.js";

// New home (D-36), from the home switcher: only the home's name (D-109). Create home makes the home, with the default
// for new bots it always started with (Mixed, D-100), which nothing here offers to change, and goes there, where it
// starts with just Mercbot, whose first conversation offers bots to start with, and Add bots adds more whenever the
// person likes. On a phone it fills the screen.
const open = defineModel("open", { type: Boolean, default: false });

const paths = usePaths();
const router = useRouter();
const { create } = useHomes();
const display = useDisplay();
const phone = computed(() => display.width.value < 600);

const name = ref("");
const busy = ref(false);
const problem = ref("");
const nameInput = ref(null);

watch(open, (value) => {
  if (!value) return;
  name.value = "";
  problem.value = "";
});

function close() {
  if (!busy.value) open.value = false;
}

/** Makes the home, then goes there. */
async function createHome() {
  const wanted = name.value.trim();
  if (!wanted || busy.value) return;
  busy.value = true;
  problem.value = "";
  try {
    const home = await makeHome(create, wanted);
    open.value = false;
    await router.push(paths.page("/", { params: { workspaceSlug: home.slug } }));
  } catch (error) {
    problem.value = error?.message || "That home couldn't be made. Try again.";
  } finally {
    busy.value = false;
  }
}

const ready = computed(() => Boolean(name.value.trim()) && !busy.value);
</script>

<template>
  <v-dialog :model-value="open" width="auto" :fullscreen="phone" :persistent="busy" @update:model-value="close" @after-enter="nameInput?.focus()">
    <div class="mb-ctemp mb-newhome" :class="{ 'mb-ctemp--phone': phone }" role="dialog" aria-label="New home">
      <div class="mb-ctemp__head">
        <h2 class="mb-ctemp__title">New home</h2>
        <button type="button" class="mb-ctemp__close" aria-label="Close" :disabled="busy" @click="close">
          <v-icon icon="$close" :size="phone ? 18 : 14" />
        </button>
      </div>

      <form class="mb-ctemp__body mb-newhome__body" @submit.prevent="createHome">
        <div class="mb-ctemp__scroll">
          <p class="mb-newhome__intro">Your home starts with Mercbot, which helps you add the bots you need.</p>
          <div class="mb-newhome__fields">
            <label class="mb-newhome__label" for="mb-newhome-name">Name your home</label>
            <input
              id="mb-newhome-name"
              ref="nameInput"
              v-model="name"
              class="mb-newhome__input"
              :maxlength="HOME_NAME_MAX"
              placeholder="For example, The Smiths"
              aria-label="Name of the new home"
            >
          </div>
        </div>
        <p v-if="problem" class="mb-ctemp__error" role="alert">{{ problem }}</p>
        <div class="mb-ctemp__foot">
          <button type="button" class="mb-ctemp__button" :disabled="busy" @click="close">Cancel</button>
          <button type="submit" class="mb-ctemp__button mb-ctemp__button--primary" :disabled="!ready">
            {{ busy ? "Creating…" : "Create home" }}
          </button>
        </div>
      </form>
    </div>
  </v-dialog>
</template>

<style scoped src="./MercbotChangeTemplateDialog.css"></style>
<style scoped>
/* Only a name: as tall as it needs, not the size of a gallery. */
.mb-newhome:not(.mb-ctemp--phone) {
  width: min(480px, calc(100vw - 48px));
  height: auto;
}

.mb-newhome__body {
  display: flex;
  flex-direction: column;
}

.mb-newhome__intro {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-newhome__fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mb-newhome__label {
  padding: 0;
  font-size: 13px;
  font-weight: 600;
}

.mb-newhome__input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 10px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 15px;
}

.mb-newhome__input:focus {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 0;
}

</style>
