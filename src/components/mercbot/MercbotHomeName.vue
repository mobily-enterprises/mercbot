<script setup>
import { computed, ref, watch } from "vue";
import { HOME_NAME_MAX, homeNameProblem, useHomes } from "./homesApi.js";

// Settings → General's Home name (D-103): the home's owners and admins rename it here, on JSKIT's own route for a
// workspace's profile, and the sidebar and the home switcher show the new name at once; everyone else sees the name.
const props = defineProps({
  home: { type: Object, required: true },
  manages: { type: Boolean, default: false }
});
const emit = defineEmits(["failure", "notify"]);
const { rename } = useHomes();

const draft = ref(props.home.name);
const saving = ref(false);
const changed = computed(() => draft.value.trim() !== props.home.name);
const problem = computed(() => (changed.value ? homeNameProblem(draft.value) : ""));

// A name kept since (this person's, another's heard from the server, or another home's) shows here, unless a change is
// being typed.
watch(() => props.home.name, (name, before) => {
  if (draft.value.trim() === before) draft.value = name;
});

async function save() {
  if (!changed.value || problem.value || saving.value) return;
  saving.value = true;
  try {
    draft.value = (await rename(props.home.slug, draft.value)).name;
    emit("notify", "Home renamed");
  } catch (error) {
    emit("failure", error);
  } finally {
    saving.value = false;
  }
}

// Escape puts back the kept name, and closes nothing while there was a change to put back.
function putBack(event) {
  if (!changed.value) return;
  event.stopPropagation();
  draft.value = props.home.name;
}
</script>

<template>
  <div class="mb-set-row">
    <span class="mb-set-row__text">
      <span class="mb-set-row__label">Home name</span>
      <span v-if="manages" class="mb-set-row__description">Everyone in the home sees it, in the sidebar and the list of homes.</span>
      <span v-else class="mb-set-row__description">The home's owners and admins can change it.</span>
      <span v-if="problem" class="mb-home-name__problem" role="alert">{{ problem }}</span>
    </span>
    <form v-if="manages" class="mb-home-name" @submit.prevent="save" @keydown.esc="putBack">
      <input
        v-model="draft"
        class="mb-home-name__input"
        :maxlength="HOME_NAME_MAX"
        :disabled="saving"
        aria-label="Home name"
        autocomplete="off"
      >
      <button v-if="changed" type="submit" class="mb-set-pill mb-set-pill--dark" :disabled="Boolean(problem) || saving">
        {{ saving ? "Saving…" : "Save" }}
      </button>
    </form>
    <span v-else class="mb-home-name__value">{{ home.name }}</span>
  </div>
</template>

<style scoped>
.mb-home-name {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}

.mb-home-name__input {
  width: 240px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 14px;
}

.mb-home-name__input:focus {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 0;
}

.mb-home-name__value {
  max-width: 50%;
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-home-name__problem {
  font-size: 12px;
  line-height: 18px;
  color: rgb(var(--v-theme-error));
}

@media (max-width: 600px) {
  .mb-home-name__input {
    width: 160px;
  }
}
</style>
