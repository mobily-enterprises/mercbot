<script setup>
import { computed, onMounted, ref, shallowRef } from "vue";
import { useDisplay } from "vuetify";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotTemplateDraft from "./MercbotTemplateDraft.vue";
import { botsApi } from "./botsApi.js";

// Settings → Templates (D-98, amended 20 November): the home's own templates, each with its tag, its line and how many
// bots use it, for everyone in the home. Its owners and admins Edit one on the draft screen, where Save warns that the
// changes reach every bot using it from its next reply, and records what changed, and by whom, in their Instructions;
// and Delete one no bot uses. Mercbot's library is in the gallery.
const emit = defineEmits(["failure", "notify"]);
const display = useDisplay();
const phone = computed(() => display.width.value < 600);

const list = ref(null);
const canManage = ref(false);
// The template being edited, as it was opened (its updatedAt goes with Save).
const editing = ref(null);
const draftScreen = ref(null);
const saving = ref(false);
const saveError = ref("");
const saveProblems = ref([]);
// A draft waiting for the warning's yes; a template waiting for Delete's; leaving a changed draft.
const pending = shallowRef(null);
const removing = shallowRef(null);
const leaving = ref(false);

async function load() {
  try {
    const read = await botsApi.homeTemplates();
    list.value = read.templates;
    canManage.value = Boolean(read.canManage);
  } catch (error) {
    list.value = [];
    emit("failure", error);
  }
}
onMounted(load);

const usedText = (count) => (count === 1 ? "Used by 1 bot" : `Used by ${count} bots`);
const reach = (count) => (count === 1 ? "Changes reach 1 bot from its next reply." : count ? `Changes reach ${count} bots from their next reply.` : "No bot uses it yet.");
const otherTags = computed(() => (list.value || []).filter((entry) => entry.id !== editing.value?.id).map((entry) => entry.tag));
const warning = computed({ get: () => Boolean(pending.value), set: (value) => { if (!value) pending.value = null; } });
const deleting = computed({ get: () => Boolean(removing.value), set: (value) => { if (!value) removing.value = null; } });

async function edit(entry) {
  try {
    saveError.value = "";
    saveProblems.value = [];
    editing.value = await botsApi.homeTemplate(entry.id);
  } catch (error) {
    emit("failure", error);
  }
}

function closeEditor() {
  if (saving.value) return;
  if (draftScreen.value?.dirty) leaving.value = true;
  else editing.value = null;
}

async function save() {
  const draft = pending.value;
  const template = editing.value;
  saving.value = true;
  saveError.value = "";
  saveProblems.value = [];
  try {
    const { template: saved } = await botsApi.editHomeTemplate(template.id, draft, template.updatedAt);
    editing.value = null;
    emit("notify", saved.usedBy ? `Saved ${saved.tag}. ${reach(saved.usedBy)}` : `Saved ${saved.tag}.`);
    await load();
  } catch (error) {
    saveProblems.value = error?.params?.problems || [];
    saveError.value = saveProblems.value.length ? "Put the template's problems right, then save it again." : error?.message || "That didn't work. Try again.";
  }
  saving.value = false;
}

async function remove() {
  const template = removing.value;
  try {
    await botsApi.deleteHomeTemplate(template.id);
    list.value = list.value.filter((entry) => entry.id !== template.id);
    emit("notify", `Deleted ${template.tag}.`);
  } catch (error) {
    emit("failure", error);
    await load();
  }
}
</script>

<template>
  <section v-if="list">
    <p class="mb-set-group">Your home's templates</p>
    <ul v-if="list.length" class="mb-set-card mb-stemp__list">
      <li v-for="entry in list" :key="entry.id" class="mb-set-row mb-stemp__row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label"><strong>{{ entry.tag }}</strong> <span class="mb-stemp__used">{{ usedText(entry.usedBy) }}</span></span>
          <span class="mb-stemp__description">{{ entry.description }}</span>
        </span>
        <span v-if="canManage" class="mb-stemp__actions">
          <button type="button" class="mb-set-pill" :aria-label="`Edit ${entry.tag}`" @click="edit(entry)">Edit</button>
          <button
            type="button"
            class="mb-set-pill"
            :aria-label="`Delete ${entry.tag}`"
            :disabled="entry.usedBy > 0"
            :title="entry.usedBy > 0 ? 'A bot uses it: change their template first.' : ''"
            @click="removing = entry"
          >
            Delete
          </button>
        </span>
      </li>
    </ul>
    <p v-else class="mb-stemp__note">None yet. Make one with Make a new template in New bot, or in a bot's Change template.</p>
    <p class="mb-stemp__note">
      {{ canManage ? "Changes to a template reach every bot that uses it from its next reply." : "Only the home's owners and admins can change or delete them." }}
      Mercbot's own templates are in the gallery.
    </p>

    <v-dialog :model-value="Boolean(editing)" width="auto" :fullscreen="phone" persistent>
      <div v-if="editing" class="mb-ctemp" :class="{ 'mb-ctemp--phone': phone }" role="dialog" :aria-label="`Edit ${editing.tag}`" @keydown.esc="closeEditor">
        <div class="mb-ctemp__head">
          <h2 class="mb-ctemp__title">Edit {{ editing.tag }}</h2>
          <span class="mb-stemp__used">{{ usedText(editing.usedBy) }}</span>
          <button type="button" class="mb-ctemp__close" aria-label="Close" :disabled="saving" @click="closeEditor"><v-icon icon="$close" :size="phone ? 18 : 14" /></button>
        </div>
        <div class="mb-ctemp__body">
          <MercbotTemplateDraft
            ref="draftScreen"
            purpose="edit"
            :start="editing"
            :template-id="editing.id"
            :home-tags="otherTags"
            save-label="Save"
            :saving="saving"
            :save-error="saveError"
            :save-problems="saveProblems"
            @save="pending = $event.draft"
          />
        </div>
      </div>
    </v-dialog>
    <MercbotConfirmDialog
      v-model="warning"
      :title="`Save ${editing?.tag}?`"
      :text="reach(editing?.usedBy || 0)"
      confirm-label="Save"
      :danger="false"
      @confirm="save"
    />
    <MercbotConfirmDialog
      v-model="deleting"
      :title="`Delete ${removing?.tag}?`"
      text="It goes from your home's templates for good. No bot uses it."
      @confirm="remove"
    />
    <MercbotConfirmDialog
      v-model="leaving"
      title="Leave without saving?"
      text="Your changes to this template are lost."
      confirm-label="Leave"
      @confirm="editing = null"
    />
  </section>
</template>

<style scoped src="./MercbotChangeTemplateDialog.css"></style>
<style scoped>
.mb-stemp__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mb-stemp__row {
  align-items: center;
  gap: 12px;
}

.mb-stemp__used,
.mb-stemp__description,
.mb-stemp__note {
  font-size: 12px;
  font-weight: 400;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-stemp__description {
  display: block;
  white-space: normal;
}

.mb-stemp__actions {
  display: flex;
  flex: none;
  gap: 6px;
}

.mb-stemp__note {
  margin-top: 12px;
  font-size: 13px;
}
</style>
